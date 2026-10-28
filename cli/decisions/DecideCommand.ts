/** User's answer to an open decision: option letters per question, or `-- <text>` for a one-question decision; the first answer wins. */
import type { DecisionAnswerForm } from '../../src/lib/tracker-model/@types/Decision.ts';
import { ControlService }          from '../../src/services/control/ControlService.ts';
import type { ControlCommandOf }   from '../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }        from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }           from '../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }     from '../CommandHandler.ts';
import { openTrackerForWriting }   from '../OpenTrackerForWriting.ts';
import { relayWhenUnderJob }       from '../RelayUnderJob.ts';
import { OutputUtil }              from '../utils/OutputUtil.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} decide <decision> <letters>... | -- <text> [--json]`;

const OPTION_LETTERS_PATTERN = /^[a-z]+$/;

function refuseUsage(problem: string): never {
  throw new OperationRefusal('refused', `${problem}\n  Usage: ${USAGE}`);
}

/** Letters before the separator, or text after it, never both. */
function answerFormOf(choices: readonly string[], text: string): DecisionAnswerForm {
  if (choices.length > 0 && text !== '') refuseUsage('Answer with option letters or with free text after --, not both.');
  if (text !== '') return { form: 'text', text };
  if (choices.length === 0) refuseUsage('Name an option letter for each question, or give free text after --.');
  const malformed = choices.find((choice) => !OPTION_LETTERS_PATTERN.test(choice));
  if (malformed !== undefined) refuseUsage(`"${malformed}" is not a choice of option letters, as b or ac.`);
  return { form: 'letters', choices };
}

export const decideCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['json'], USAGE);
  const [decisionId, ...choices] = commandArguments.positionalsBeforeSeparator();
  if (decisionId === undefined) refuseUsage('Name the decision to answer, as E7.');
  const text = commandArguments.positionals().slice(1 + choices.length).join(' ').trim();

  const command: ControlCommandOf<'decision-answer'> = { kind: 'decision-answer', decisionId: decisionId.toUpperCase(), answer: answerFormOf(choices, text) };
  await relayWhenUnderJob(context, command);
  const { answer, logged } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
  OutputUtil.printEntity(commandArguments, context, { decisionId: command.decisionId, answer }, OutputUtil.loggedSentencesOf(logged));
};
