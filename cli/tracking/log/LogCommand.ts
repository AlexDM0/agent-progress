import { OperationRefusal }      from '../../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }         from '../../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }   from '../../CommandHandler.ts';
import { openTrackerForWriting } from '../../OpenTrackerForWriting.ts';
import { OutputUtil }            from '../../utils/OutputUtil.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} log "<text>" [--at <when>]`;

const KNOWN_OPTION_NAMES = ['at', 'json'];

export const logCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);

  // Joined from every positional, so an unquoted sentence is recorded whole rather than truncated to its first word.
  const text = commandArguments.joinedPositionalsFrom(0);
  if (text === undefined || text.trim() === '') {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} log needs something to record.\n  Usage: ${USAGE}`);
  }

  const entry = await openTrackerForWriting(commandArguments, context, (change) => {
    change.board.recordNote(text, change.at);
    return { at: change.at, text };
  });

  OutputUtil.printEntity(commandArguments, context, entry, `Logged: ${entry.text}`);
};
