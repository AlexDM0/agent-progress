/**
 * The sequence every mutating command follows, written once and all inside the lock: read the tracker into a Board, mutate, write the progress
 * file, then the tickets the Board changed, then log.jsonl, then render from disk, so no older render lands last and the progress file is never
 * behind the tickets. A log carried over from an older progress file is copied first, so its notes are on disk before that file stops holding them.
 */
import { createLogFileWriter }                          from '../../adapters/log/LogFileWriter.ts';
import { createLogRecordCollector }                     from '../../adapters/log/LogRecordCollector.ts';
import { createProgressFileWriter }                     from '../../adapters/progress/ProgressFileWriter.ts';
import { createTicketFileWriter }                       from '../../adapters/tickets/TicketFileWriter.ts';
import type { Ticket }                                  from '../../lib/tracker-model/@types/Ticket.ts';
import { Board }                                        from '../../lib/tracker-model/Board.ts';
import { refusalIsBoardRefusal }                        from '../../lib/tracker-model/BoardRefusal.ts';
import { createLogger }                                 from '../../lib/tracker-model/Logger.ts';
import { OperationRefusal }                             from '../../shared/OperationRefusal.ts';
import type { RenderState }                             from '../render/RenderState.ts';
import { renderDashboard, type DashboardRenderOutcome } from './DashboardRendering.ts';
import { deleteAllTickets, type MalformedTicketFile }   from './TicketStore.ts';
import { withLock }                                     from './TrackerLock.ts';
import { requireTracker, type TrackerContents }         from './TrackerReader.ts';
import type { Workspace }                               from './Workspace.ts';

export interface TrackerChange {
  board:                          Board;
  workspace:                      Workspace;
  at:                             string;
  malformedTickets:               readonly MalformedTicketFile[];
  /** How many entries the log held when it was read, before anything this invocation logged. */
  storedLogEntryCount:            number;
  /** `clear --all`: after the progress file and the changed tickets, before the render; the callback gets the deleted file count. */
  deleteAllTicketFilesAfterwards: (onDeleted: (deletedTicketCount: number) => void) => void;
}

export interface TrackerWriteRequest<MutationResult> {
  workspace:   Workspace;
  /** Already resolved by the caller; the Board stamps and logs with it. */
  at:          string;
  /** The caller's clock: the lock's records and the page's generated stamp. */
  now:         () => Date;
  renderState: RenderState;
  mutate:      (change: TrackerChange) => MutationResult | Promise<MutationResult>;
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
  const board              = new Board({ progress: contents.progress, tickets: contents.listing.tickets, logger: createLogger(logRecordCollector.collect) });
  return { contents, logRecordCollector, board };
}

/** `extraTickets` are written as well as the ones the Board changed, once each; a mutation hands in none. */
function writeBoard(
  workspace: Workspace,
  openedBoard: OpenBoard,
  writes: { extraTickets: readonly Ticket[]; deletionCallbacks: readonly ((deletedTicketCount: number) => void)[] },
): void {
  const { contents, logRecordCollector, board } = openedBoard;
  const logRecordsToWrite = logRecordCollector.recordsToWrite();
  const logFileWriter     = createLogFileWriter(workspace.logFilePath);
  // A log line never describes an unstored change, so the log goes last; a log carried over from an older file is copied first, before it is lost.
  if (contents.storedLog.logFileMustBeRewritten) logFileWriter.write(contents.storedLog.records);

  createProgressFileWriter(workspace.progressFilePath).write(contents.progress);
  const ticketsToWrite = new Map<string, Ticket>();
  for (const ticket of [...board.changedTickets(), ...writes.extraTickets]) {
    if (!ticketsToWrite.has(ticket.filePath)) ticketsToWrite.set(ticket.filePath, ticket);
  }
  const ticketFileWriter = createTicketFileWriter();
  for (const ticket of ticketsToWrite.values()) ticketFileWriter.write(ticket);
  for (const onDeleted of writes.deletionCallbacks) onDeleted(deleteAllTickets(workspace));

  if (logRecordsToWrite !== null) logFileWriter.write(logRecordsToWrite);
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
    workspace, at, now, renderState, mutate
  } = request;

  return withLock(workspace, async () => {
    const openedBoard = openBoard(requireTracker(workspace));

    const deletionCallbacks: ((deletedTicketCount: number) => void)[] = [];
    const result = await mutateWrappingBoardRefusals(mutate, {
      at,
      board:                          openedBoard.board,
      workspace,
      malformedTickets:               openedBoard.contents.listing.malformed,
      storedLogEntryCount:            openedBoard.contents.storedLog.records.length,
      deleteAllTicketFilesAfterwards: (onDeleted) => { deletionCallbacks.push(onDeleted); },
    });

    writeBoard(workspace, openedBoard, { extraTickets: [], deletionCallbacks });
    const renderOutcome = await renderDashboard(workspace, now(), renderState);
    return { result, board: openedBoard.board, renderOutcome };
  }, now);
}

/**
 * Writes a tracker read under the lock back through the write half with nothing changed and nothing logged, plus `extraTickets` besides the
 * ones the Board changed.
 */
export function writeTrackerUnchanged(workspace: Workspace, contents: TrackerContents, extraTickets: readonly Ticket[]): void {
  writeBoard(workspace, openBoard(contents), { extraTickets, deletionCallbacks: [] });
}
