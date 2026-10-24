/** `draft`: the filing cabinet's working records a filing session builds tickets from. `list` and `show` change nothing, so they read without the lock. */
import { DraftDocumentUtil }                           from '../../src/adapters/drafts/utils/DraftDocumentUtil.ts';
import type { Board }                                  from '../../src/lib/tracker-model/Board.ts';
import { readingBoardOf }                              from '../../src/lib/tracker-model/ReadingBoard.ts';
import { draftFilePathOf }                             from '../../src/services/tracker/DraftStore.ts';
import { requireTracker }                              from '../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace, type Workspace }            from '../../src/services/tracker/Workspace.ts';
import { OperationRefusal }                            from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }                         from '../CommandContext.ts';
import type { CommandHandler }                         from '../CommandHandler.ts';
import type { ArgumentParser }                         from '../arguments/ArgumentParser.ts';
import { OutputUtil }                                  from '../utils/OutputUtil.ts';
import { DRAFT_CHANGE_SUBCOMMANDS, draftIdArgumentOf } from './DraftChangeSubcommands.ts';
import { draftListingLineOf, draftSummaryOf }          from './DraftOutput.ts';
import { DRAFT_USAGE }                                 from './constants/DraftUsage.ts';

const READING_OPTION_NAMES = ['json'];

function readingBoardFor(context: CommandContext): { board: Board; workspace: Workspace } {
  const workspace = requireWorkspace(context.currentDirectory);
  const {
    progress, listing, epicListing, draftListing
  } = requireTracker(workspace);
  OutputUtil.reportIgnoredDraftFiles(context, draftListing.malformed);
  return { board: readingBoardOf(progress, listing.tickets, epicListing.epics, draftListing.drafts), workspace };
}

function listDrafts(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(READING_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(1, DRAFT_USAGE);
  const { board } = readingBoardFor(context);
  const drafts    = board.drafts();
  const human     = drafts.length === 0 ? 'No open drafts.' : drafts.map(draftListingLineOf).join('\n');
  OutputUtil.printEntity(commandArguments, context, drafts.map(DraftDocumentUtil.draftDocumentOf), human);
  return Promise.resolve();
}

function showDraft(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(READING_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(2, DRAFT_USAGE);
  const draftId              = draftIdArgumentOf(commandArguments, 'show');
  const { board, workspace } = readingBoardFor(context);
  const draft                = board.drafts().find((candidate) => candidate.id === draftId);
  if (draft === undefined) throw new OperationRefusal('refused', { kind: 'board-refusal', boardRefusal: { reason: 'unknown-draft', draftId } });
  const human                = `${draftSummaryOf(draft, draftFilePathOf(workspace, draftId))}\n\n${draft.request}`;
  OutputUtil.printEntity(commandArguments, context, DraftDocumentUtil.draftDocumentOf(draft), human);
  return Promise.resolve();
}

const DRAFT_SUBCOMMANDS: Readonly<Record<string, (commandArguments: ArgumentParser, context: CommandContext) => Promise<void>>> = Object.freeze({
  ...DRAFT_CHANGE_SUBCOMMANDS,
  list: listDrafts,
  show: showDraft,
});

export const draftCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];

  // `Object.hasOwn`, never a bare index: `subcommand` is argv text, and `constructor` is a truthy inherited property.
  const handler = subcommand !== undefined && Object.hasOwn(DRAFT_SUBCOMMANDS, subcommand) ? DRAFT_SUBCOMMANDS[subcommand] : undefined;
  if (handler !== undefined) return handler(commandArguments, context);

  throw new OperationRefusal(
    'refused',
    `${subcommand === undefined ? 'agent-progress draft needs a subcommand' : `"${subcommand}" is not an agent-progress draft subcommand`}.\n  Usage: ${DRAFT_USAGE}`,
  );
};
