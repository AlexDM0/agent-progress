/** `draft open`, `claim`, `release`, `close` and `abandon`: each one write through the pipeline, refused at exit 1 with nothing written. */
import { readFileSync } from 'node:fs';
import { resolve }      from 'node:path';

import { DraftDocumentUtil }     from '../../src/adapters/drafts/utils/DraftDocumentUtil.ts';
import { DraftIdUtil }           from '../../src/lib/tracker-model/utils/DraftIdUtil.ts';
import { draftFilePathOf }       from '../../src/services/tracker/DraftStore.ts';
import { requireWorkspace }      from '../../src/services/tracker/Workspace.ts';
import { OperationRefusal }      from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }   from '../CommandContext.ts';
import { openTrackerForWriting } from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }   from '../arguments/ArgumentParser.ts';
import { OutputUtil }            from '../utils/OutputUtil.ts';
import { DRAFT_USAGE }           from './constants/DraftUsage.ts';

const OPEN_OPTION_NAMES    = ['owner', 'request', 'request-file', 'json'];
const CLAIM_OPTION_NAMES   = ['owner', 'force', 'json'];
const RELEASE_OPTION_NAMES = ['json'];
const CLOSE_OPTION_NAMES   = ['tickets', 'json'];
const ABANDON_OPTION_NAMES = ['reason', 'json'];

const STANDARD_INPUT_MARKER = '-';

const TICKET_LIST_SEPARATOR_PATTERN = /[\s,]+/;

export function refusalOf(text: string): OperationRefusal {
  return new OperationRefusal('refused', `${text}\n  Usage: ${DRAFT_USAGE}`);
}

/** The draft id a subcommand names as its first argument, refused when missing or not a draft id. */
export function draftIdArgumentOf(commandArguments: ArgumentParser, subcommand: string): string {
  const draftId = commandArguments.positionals()[1];
  if (draftId === undefined) throw refusalOf(`agent-progress draft ${subcommand} needs a draft id.`);
  if (DraftIdUtil.draftNumberOf(draftId) === null) throw refusalOf(`"${draftId}" is not a draft id: a draft id is D and a number, such as D1.`);
  return draftId;
}

function requiredOwnerOf(commandArguments: ArgumentParser, subcommand: string): string {
  const owner = commandArguments.option('owner');
  if (owner === undefined || owner.trim() === '') throw refusalOf(`agent-progress draft ${subcommand} needs --owner <who>.`);
  return owner;
}

/** Read before the lock, as `--body-file -` is: standard input may be held open by the caller indefinitely. Kept byte for byte. */
async function suppliedRequestOf(commandArguments: ArgumentParser, context: CommandContext): Promise<string> {
  const written     = commandArguments.option('request');
  const requestFile = commandArguments.option('request-file');
  if (written !== undefined && requestFile !== undefined) throw refusalOf('agent-progress draft open takes --request or --request-file, not both.');
  if (written !== undefined) return written;
  if (requestFile === undefined) return '';
  if (requestFile === STANDARD_INPUT_MARKER) return context.readStandardInput();
  try {
    return readFileSync(resolve(context.currentDirectory, requestFile), 'utf8');
  } catch (problem) {
    throw new OperationRefusal('refused', `--request-file ${requestFile} could not be read: ${problem instanceof Error ? problem.message : String(problem)}`);
  }
}

async function openDraft(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(OPEN_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(2, DRAFT_USAGE);
  const title = commandArguments.positionals()[1];
  if (title === undefined || title.trim() === '') throw refusalOf('agent-progress draft open needs a title.');
  const owner = requiredOwnerOf(commandArguments, 'open');

  requireWorkspace(context.currentDirectory);
  const request = await suppliedRequestOf(commandArguments, context);

  const opened = await openTrackerForWriting(commandArguments, context, (change) => {
    const result   = change.board.openDraft({ title, request, owner }, change.at);
    const filePath = draftFilePathOf(change.workspace, result.draft.id);
    // A malformed file is no draft to the Board, so without this the new draft would overwrite whatever hand edit broke it.
    if (change.malformedDrafts.some((malformed) => malformed.filePath === filePath)) {
      throw new OperationRefusal('refused', `${filePath} already exists but cannot be read as a draft, so it is not overwritten. Nothing was written; repair or delete it first.`);
    }
    return result;
  });
  OutputUtil.printEntity(commandArguments, context, DraftDocumentUtil.draftDocumentOf(opened.draft), opened.draft.id);
}

async function claimDraft(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(CLAIM_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(2, DRAFT_USAGE);
  const draftId = draftIdArgumentOf(commandArguments, 'claim');
  const owner   = requiredOwnerOf(commandArguments, 'claim');
  const forces  = commandArguments.flag('force');

  const claimed  = await openTrackerForWriting(commandArguments, context, (change) => change.board.claimDraft(draftId, { owner, forces }, change.at));
  const sentence = claimed.changed ? OutputUtil.loggedSentencesOf(claimed.logged) : `Draft ${draftId} already claimed by ${owner}: nothing to write`;
  OutputUtil.printEntity(commandArguments, context, DraftDocumentUtil.draftDocumentOf(claimed.draft), sentence);
}

async function releaseDraft(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(RELEASE_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(2, DRAFT_USAGE);
  const draftId = draftIdArgumentOf(commandArguments, 'release');

  const released = await openTrackerForWriting(commandArguments, context, (change) => change.board.releaseDraft(draftId, change.at));
  const sentence = released.changed ? OutputUtil.loggedSentencesOf(released.logged) : `Draft ${draftId} is not claimed: nothing to write`;
  OutputUtil.printEntity(commandArguments, context, DraftDocumentUtil.draftDocumentOf(released.draft), sentence);
}

async function closeDraft(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(CLOSE_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(2, DRAFT_USAGE);
  const draftId          = draftIdArgumentOf(commandArguments, 'close');
  const ticketReferences = (commandArguments.option('tickets') ?? '').split(TICKET_LIST_SEPARATOR_PATTERN).filter((reference) => reference !== '');
  if (ticketReferences.length === 0) throw refusalOf('agent-progress draft close needs --tickets <ids>, the tickets filed from the draft.');

  const closed    = await openTrackerForWriting(commandArguments, context, (change) => change.board.closeDraft(draftId, ticketReferences, change.at));
  const ticketIds = closed.logged.flatMap((record) => (record.kind === 'draft-closed' ? record.fields.ticketIds : []));
  OutputUtil.printEntity(commandArguments, context, { id: draftId, closed: true, ticketIds }, OutputUtil.loggedSentencesOf(closed.logged));
}

async function abandonDraft(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ABANDON_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(2, DRAFT_USAGE);
  const draftId = draftIdArgumentOf(commandArguments, 'abandon');
  const reason  = commandArguments.option('reason');
  if (reason === undefined || reason.trim() === '') throw refusalOf('agent-progress draft abandon needs --reason <text>, which the log keeps.');

  const abandoned = await openTrackerForWriting(commandArguments, context, (change) => change.board.abandonDraft(draftId, reason, change.at));
  OutputUtil.printEntity(commandArguments, context, { id: draftId, abandoned: true, reason }, OutputUtil.loggedSentencesOf(abandoned.logged));
}

export const DRAFT_CHANGE_SUBCOMMANDS = {
  open: openDraft, claim: claimDraft, release: releaseDraft, close: closeDraft, abandon: abandonDraft
} as const;
