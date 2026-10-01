/** `epic add`, `epic edit` and `epic remove`: each one write through the pipeline, refused at exit 1 with nothing written. */
import { epicFilePathOf }         from '../../src/services/tracker/EpicStore.ts';
import { requireWorkspace }       from '../../src/services/tracker/Workspace.ts';
import { OperationRefusal }       from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }    from '../CommandContext.ts';
import { openTrackerForWriting }  from '../OpenTrackerForWriting.ts';
import { suppliedMarkdownBodyOf } from '../SuppliedMarkdownBody.ts';
import type { ArgumentParser }    from '../arguments/ArgumentParser.ts';
import { OutputUtil }             from '../utils/OutputUtil.ts';
import { epicDocumentWithBodyOf } from './EpicOutput.ts';
import { EPIC_USAGE }             from './constants/EpicUsage.ts';

const ADD_OPTION_NAMES    = ['body', 'body-file', 'at', 'json'];
const EDIT_OPTION_NAMES   = ['title', 'append', 'body', 'body-file', 'at', 'json'];
const REMOVE_OPTION_NAMES = ['at', 'json'];

function refuseBothBodyOptions(commandArguments: ArgumentParser, subcommand: string): void {
  if (commandArguments.option('body') !== undefined && commandArguments.option('body-file') !== undefined) {
    throw new OperationRefusal('refused', `agent-progress epic ${subcommand} takes --body or --body-file, not both.\n  Usage: ${EPIC_USAGE}`);
  }
}

async function addEpic(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ADD_OPTION_NAMES, EPIC_USAGE);
  commandArguments.rejectExtraPositionals(3, EPIC_USAGE);
  const [, key, title] = commandArguments.positionals();
  if (key === undefined || title === undefined || title.trim() === '') {
    throw new OperationRefusal('refused', `agent-progress epic add needs a key and a title.\n  Usage: ${EPIC_USAGE}`);
  }
  refuseBothBodyOptions(commandArguments, 'add');

  // Read before the lock: `--body-file -` waits on a pipe the caller may hold open indefinitely.
  requireWorkspace(context.currentDirectory);
  const body = await suppliedMarkdownBodyOf(commandArguments, context) ?? '';

  const added = await openTrackerForWriting(commandArguments, context, (change) => {
    const filePath = epicFilePathOf(change.workspace, key);
    // A malformed file is no epic to the Board, so without this the new epic would overwrite whatever hand edit broke it.
    if (change.malformedEpics.some((malformed) => malformed.filePath === filePath)) {
      throw new OperationRefusal('refused', `${filePath} already exists but cannot be read as an epic, so it is not overwritten. Nothing was written; repair or delete it first.`);
    }
    return change.board.addEpic({
      key, title, body, filePath
    }, change.at);
  });
  const { frontmatter } = added.epic;
  OutputUtil.printEntity(
    commandArguments,
    context,
    {
      key: frontmatter.key, title: frontmatter.title, slot: frontmatter.slot, filePath: added.epic.filePath, body: added.epic.body
    },
    `${OutputUtil.loggedSentencesOf(added.logged)}\n  ${added.epic.filePath}`,
  );
}

async function editEpic(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(EDIT_OPTION_NAMES, EPIC_USAGE);
  commandArguments.rejectExtraPositionals(2, EPIC_USAGE);
  const key = commandArguments.positionals()[1];
  if (key === undefined) throw new OperationRefusal('refused', `agent-progress epic edit needs an epic key.\n  Usage: ${EPIC_USAGE}`);
  refuseBothBodyOptions(commandArguments, 'edit');
  const title   = commandArguments.option('title');
  const appends = commandArguments.flag('append');
  if (title?.trim() === '') throw new OperationRefusal('refused', `agent-progress epic edit was given an empty --title.\n  Usage: ${EPIC_USAGE}`);

  requireWorkspace(context.currentDirectory);
  const text = await suppliedMarkdownBodyOf(commandArguments, context);
  if (title === undefined && text === undefined) {
    throw new OperationRefusal('refused', `agent-progress epic edit needs --title, --body or --body-file.\n  Usage: ${EPIC_USAGE}`);
  }
  if (text !== undefined && !appends && text.trim() === '') {
    throw new OperationRefusal('refused', 'An empty body would erase the epic\'s description, so it is refused; to add to the description, pass --append.');
  }

  const edited = await openTrackerForWriting(commandArguments, context, (change) => {
    const result = change.board.editEpic(key, {
      ...(title === undefined ? {} : { title }),
      ...(text === undefined ? {} : { body: { text, appends } }),
    }, change.at);
    return { ...result, rollup: change.board.epicRollupOf(result.epic) };
  });
  const sentence = edited.changed ? OutputUtil.loggedSentencesOf(edited.logged) : `Epic ${key} unchanged: nothing to write`;
  OutputUtil.printEntity(commandArguments, context, epicDocumentWithBodyOf(edited.epic, edited.rollup), `${sentence}\n  ${edited.epic.filePath}`);
}

async function removeEpic(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(REMOVE_OPTION_NAMES, EPIC_USAGE);
  commandArguments.rejectExtraPositionals(2, EPIC_USAGE);
  const key = commandArguments.positionals()[1];
  if (key === undefined) throw new OperationRefusal('refused', `agent-progress epic remove needs an epic key.\n  Usage: ${EPIC_USAGE}`);

  const removed = await openTrackerForWriting(commandArguments, context, (change) => change.board.removeEpic(key, change.at));
  OutputUtil.printEntity(commandArguments, context, { key, removed: true, filePath: removed.epic.filePath }, OutputUtil.loggedSentencesOf(removed.logged));
}

export const EPIC_CHANGE_SUBCOMMANDS = { add: addEpic, edit: editEpic, remove: removeEpic } as const;
