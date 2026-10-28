/** The filing cabinet's kinds of the control contract, `epic-add` and the mutating `draft-*` kinds, each applied in a `writeTracker` hold. */
import type { ControlCommandOf as CommandOf } from '../../shared/@types/ControlCommand.ts';
import { OperationRefusal }                   from '../../shared/OperationRefusal.ts';
import { draftFilePathOf }                    from '../tracker/DraftStore.ts';
import { epicFilePathOf }                     from '../tracker/EpicStore.ts';
import type { TrackerChange }                 from '../tracker/TrackerPipeline.ts';

function addEpic(command: CommandOf<'epic-add'>, change: TrackerChange) {
  const filePath = epicFilePathOf(change.workspace, command.key);
  // A malformed file is no epic to the Board, so without this the new epic would overwrite whatever hand edit broke it.
  if (change.malformedEpics.some((malformed) => malformed.filePath === filePath)) {
    throw new OperationRefusal('refused', { kind: 'unreadable-file-in-the-way', filePath, record: 'epic' });
  }
  return change.board.addEpic({
    key: command.key, title: command.title, body: command.bodyText, filePath
  }, change.at);
}

function openDraft(command: CommandOf<'draft-open'>, change: TrackerChange) {
  const result   = change.board.openDraft({ title: command.title, request: command.request, owner: command.owner }, change.at);
  const filePath = draftFilePathOf(change.workspace, result.draft.id);
  // A malformed file is no draft to the Board, so without this the new draft would overwrite whatever hand edit broke it.
  if (change.malformedDrafts.some((malformed) => malformed.filePath === filePath)) {
    throw new OperationRefusal('refused', { kind: 'unreadable-file-in-the-way', filePath, record: 'draft' });
  }
  return result;
}

export const FILING_CONTROLS = {
  'epic-add':    addEpic,
  'draft-open':  openDraft,
  'draft-claim': (command: CommandOf<'draft-claim'>, change: TrackerChange) => change.board.claimDraft(
    command.draftId,
    { owner: command.owner, forces: command.forces },
    change.at,
  ),
  'draft-release': (command: CommandOf<'draft-release'>, change: TrackerChange) => change.board.releaseDraft(command.draftId, change.at),
  'draft-note':    (command: CommandOf<'draft-note'>, change: TrackerChange) => change.board.addDraftNote(
    command.draftId,
    { text: command.text, kind: command.noteKind },
    change.at,
  ),
  'draft-ask':     (command: CommandOf<'draft-ask'>, change: TrackerChange) => change.board.askDraftQuestion(command.draftId, command.asking, change.at),
  'draft-answer':  (command: CommandOf<'draft-answer'>, change: TrackerChange) => change.board.answerDraftQuestion(command.draftId, command.questionId, command.answer, change.at),
  'draft-drop':    (command: CommandOf<'draft-drop'>, change: TrackerChange) => change.board.dropDraftItem(command.draftId, command.itemId, change.at),
  'draft-close':   (command: CommandOf<'draft-close'>, change: TrackerChange) => change.board.closeDraft(command.draftId, command.ticketReferences, change.at),
  'draft-abandon': (command: CommandOf<'draft-abandon'>, change: TrackerChange) => change.board.abandonDraft(command.draftId, command.reason, change.at),
} as const;
