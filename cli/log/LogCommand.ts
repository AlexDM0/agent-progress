import { OperationRefusal }                   from '../../lib/platform/OperationRefusal';
import { appendLogEntry }                     from '../../lib/progress/ProgressStore';
import { openTrackerForWriting, printEntity } from '../CommandSupport';
import type { CommandHandler }                from '../CommandTable';

const USAGE = 'agent-progress log "<text>" [--at <when>]';

const KNOWN_OPTION_NAMES = ['at', 'json'];

export const logCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);

  // Joined from every positional, so an unquoted sentence is recorded whole rather than truncated to its first word.
  const text = commandArguments.joinedPositionalsFrom(0);
  if (text === undefined || text.trim() === '') {
    throw new OperationRefusal('refused', `agent-progress log needs something to record.\n  Usage: ${USAGE}`);
  }

  const entry = await openTrackerForWriting(commandArguments, context, (change) => {
    appendLogEntry(change.progress, change.at, text);
    return { at: change.at, text };
  });

  printEntity(commandArguments, context, entry, `Logged: ${entry.text}`);
};
