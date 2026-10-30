/**
 * The sequence every mutating command follows, written once and all inside the lock: read the tracker into a Board, mutate, write the progress
 * file, then the pipeline when a `gate` verb changed it, then the tickets the Board changed, then the epics it changed or removed, then the
 * drafts, then log.jsonl, then render from disk, so no older render lands last and the progress file is never behind the tickets. The
 * writes commit through the hold journal, fenced against a takeover of the lock.
 */
import { createDraftFileWriter }                           from '../../adapters/drafts/DraftFileWriter.ts';
import { createEpicFileWriter }                            from '../../adapters/epics/EpicFileWriter.ts';
import type { JournaledFile }                              from '../../adapters/hold-journal/HoldJournalIngestion.ts';
import { createLogFileWriter }                             from '../../adapters/log/LogFileWriter.ts';
import { createLogRecordCollector }                        from '../../adapters/log/LogRecordCollector.ts';
import { PipelineFile }                                    from '../../adapters/pipeline/PipelineFile.ts';
import { createProgressFileWriter }                        from '../../adapters/progress/ProgressFileWriter.ts';
import { createTicketFileWriter }                          from '../../adapters/tickets/TicketFileWriter.ts';
import type { LogRecord }                                  from '../../lib/tracker-model/@types/LogRecord.ts';
import { Board }                                           from '../../lib/tracker-model/Board.ts';
import { refusalIsBoardRefusal }                           from '../../lib/tracker-model/BoardRefusal.ts';
import { createLogger }                                    from '../../lib/tracker-model/Logger.ts';
import { OperationRefusal }                                from '../../shared/OperationRefusal.ts';
import type { RenderState }                                from '../render/RenderState.ts';
import { renderDashboard, type DashboardRenderOutcome }    from './DashboardRendering.ts';
import { draftFilePathOf, type MalformedDraftFile }        from './DraftStore.ts';
import { everyEpicFilePathIn, type MalformedEpicFile }     from './EpicStore.ts';
import { commitHold }                                      from './HoldJournal.ts';
import { everyTicketFilePathIn, type MalformedTicketFile } from './TicketStore.ts';
import { withLock }                                        from './TrackerLock.ts';
import { requireTracker, type TrackerContents }            from './TrackerReader.ts';
import type { Workspace }                                  from './Workspace.ts';

export interface TrackerChange {
  board:                          Board;
  workspace:                      Workspace;
  at:                             string;
  malformedTickets:               readonly MalformedTicketFile[];
  malformedEpics:                 readonly MalformedEpicFile[];
  malformedDrafts:                readonly MalformedDraftFile[];
  /** Why the stored `pipeline.json` could not be read; `null` when it was, or none is stored. */
  malformedPipelineReason:        string | null;
  /** How many entries the log held when it was read, before anything this invocation logged. */
  storedLogEntryCount:            number;
  /** The log as it was read, before anything this invocation logged. */
  storedLogRecords:               readonly LogRecord[];
  /** `clear --all`: after the progress file and the changed tickets, before the render, epic files too; the callback gets the ticket file count. */
  deleteAllTicketFilesAfterwards: (onDeleted: (deletedTicketCount: number) => void) => void;
}

export interface TrackerWriteRequest<MutationResult> {
  workspace:         Workspace;
  /** Already resolved by the caller; the Board stamps and logs with it. */
  at:                string;
  /** The caller's clock: the lock's records and the page's generated stamp. */
  now:               () => Date;
  renderState:       RenderState;
  mutate:            (change: TrackerChange) => MutationResult | Promise<MutationResult>;
  /** Called after each file the hold writes; the step a spec interrupts to cut the hold short. */
  afterFileWritten?: (filePath: string) => void;
}

export interface TrackerWritten<MutationResult> {
  result:        MutationResult;
  /** The Board just written; only this invocation holds it, so reading it after the lock is released reads what was written. */
  board:         Board;
  renderOutcome: DashboardRenderOutcome;
}

interface OpenBoard {
  contents:           TrackerContents;
  logRecordCollector: ReturnType<typeof createLogRecordCollector>;
  board:              Board;
}

function openBoard(contents: TrackerContents): OpenBoard {
  const logRecordCollector = createLogRecordCollector(contents.storedLog);
  const board              = new Board({
    progress:         contents.progress,
    tickets:          contents.listing.tickets,
    epics:            contents.epicListing.epics,
    drafts:           contents.draftListing.drafts,
    logger:           createLogger(logRecordCollector.collect),
    storedLogRecords: contents.storedLog.records,
    pipeline:         contents.pipelineReading.verdict === 'readable' ? contents.pipelineReading.pipeline : null,
  });
  return { contents, logRecordCollector, board };
}

interface PlannedHold {
  files:              JournaledFile[];
  deletedTicketCount: number;
}

/** Every file the hold writes, in the order it writes them; a log line never describes an unstored change, so the log goes last. */
function plannedHoldOf(workspace: Workspace, openedBoard: OpenBoard, deletesEveryTicketFile: boolean): PlannedHold {
  const { contents, logRecordCollector, board } = openedBoard;
  const written = (filePath: string, fileContents: string): JournaledFile => ({ kind: 'written', filePath, contents: fileContents });
  const removed = (filePath: string): JournaledFile => ({ kind: 'removed', filePath });

  const files: JournaledFile[] = [written(workspace.progressFilePath, createProgressFileWriter(workspace.progressFilePath).contentsOf(contents.progress))];
  const changedPipeline = board.pipelineChanged() ? board.pipeline() : null;
  if (changedPipeline !== null) files.push(written(workspace.pipelineFilePath, PipelineFile.contentsOf(changedPipeline)));
  const ticketFileWriter = createTicketFileWriter();
  for (const ticket of board.changedTickets()) files.push(written(ticket.filePath, ticketFileWriter.contentsOf(ticket)));
  const epicFileWriter = createEpicFileWriter();
  for (const epic of board.changedEpics()) files.push(written(epic.filePath, epicFileWriter.contentsOf(epic)));
  for (const epic of board.removedEpics()) files.push(removed(epic.filePath));
  const draftFileWriter = createDraftFileWriter((draftId) => draftFilePathOf(workspace, draftId));
  for (const draft of board.changedDrafts()) files.push(written(draftFilePathOf(workspace, draft.id), draftFileWriter.contentsOf(draft)));
  for (const draft of board.removedDrafts()) files.push(removed(draftFilePathOf(workspace, draft.id)));
  const deletedTicketFilePaths = deletesEveryTicketFile ? everyTicketFilePathIn(workspace) : [];
  files.push(...deletedTicketFilePaths.map(removed));
  if (deletesEveryTicketFile) files.push(...everyEpicFilePathIn(workspace).map(removed));

  const logRecordsToWrite = logRecordCollector.recordsToWrite();
  if (logRecordsToWrite !== null) files.push(written(workspace.logFilePath, createLogFileWriter(workspace.logFilePath).contentsOf(logRecordsToWrite)));
  return { files, deletedTicketCount: deletedTicketFilePaths.length };
}

/** A Board refusal is one the caller can act on, wrapped with its detail for the command line to word; nothing has been written when it is thrown. */
async function mutateWrappingBoardRefusals<MutationResult>(
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
  change: TrackerChange,
): Promise<MutationResult> {
  try {
    return await mutate(change);
  } catch (error) {
    if (refusalIsBoardRefusal(error)) throw new OperationRefusal('refused', { kind: 'board-refusal', boardRefusal: error.detail });
    throw error;
  }
}

export function writeTracker<MutationResult>(request: TrackerWriteRequest<MutationResult>): Promise<TrackerWritten<MutationResult>> {
  const {
    workspace, at, now, renderState, mutate, afterFileWritten
  } = request;

  return withLock(workspace, async (hold) => {
    const openedBoard = openBoard(requireTracker(workspace));

    const deletionCallbacks: ((deletedTicketCount: number) => void)[] = [];
    const result = await mutateWrappingBoardRefusals(mutate, {
      at,
      board:                          openedBoard.board,
      workspace,
      malformedTickets:               openedBoard.contents.listing.malformed,
      malformedEpics:                 openedBoard.contents.epicListing.malformed,
      malformedDrafts:                openedBoard.contents.draftListing.malformed,
      malformedPipelineReason:        openedBoard.contents.pipelineReading.verdict === 'malformed' ? openedBoard.contents.pipelineReading.reason : null,
      storedLogEntryCount:            openedBoard.contents.storedLog.records.length,
      storedLogRecords:               openedBoard.contents.storedLog.records,
      deleteAllTicketFilesAfterwards: (onDeleted) => { deletionCallbacks.push(onDeleted); },
    });

    const plannedHold = plannedHoldOf(workspace, openedBoard, deletionCallbacks.length > 0);
    commitHold(workspace, plannedHold.files, hold, afterFileWritten);
    for (const onDeleted of deletionCallbacks) onDeleted(plannedHold.deletedTicketCount);
    const renderOutcome = await renderDashboard(workspace, now(), renderState);
    return { result, board: openedBoard.board, renderOutcome };
  }, now);
}
