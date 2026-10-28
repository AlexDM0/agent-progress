/** The open decisions for User, in opening order, each question with its options lettered as `decide` takes them. Read-only, no lock. */
import type { Decision }       from '../../src/lib/tracker-model/@types/Decision.ts';
import { requireProgressFile } from '../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }    from '../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }       from '../../src/shared/constants/ProductNames.ts';
import type { CommandHandler } from '../CommandHandler.ts';
import { OutputUtil }          from '../utils/OutputUtil.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} decisions [--json]`;

const FIRST_OPTION_LETTER_CODE = 'a'.charCodeAt(0);

function decisionTextOf(decision: Readonly<Decision>): string {
  const tickets = decision.ticketIds.length === 0 ? '' : ` on #${decision.ticketIds.join(', #')}`;
  const job     = decision.jobId === null ? '' : `, job ${decision.jobId}`;
  const heading = `${decision.id} ${decision.kind}${tickets} (asked by ${decision.askedBy}${job}, ${decision.openedAt})`;
  const questionLines = decision.questions.flatMap((question, i) => [
    `  ${i + 1}. [${question.header}] ${question.question}${question.multiSelect ? ' (several letters)' : ''}`,
    ...question.options.map((option, optionIndex) => `     ${String.fromCharCode(FIRST_OPTION_LETTER_CODE + optionIndex)}. ${option.label}`
      + `${option.description === '' ? '' : `: ${option.description}`}`),
  ]);
  return [heading, ...(decision.context === '' ? [] : [`  ${decision.context}`]), ...questionLines].join('\n');
}

export const decisionsCommand: CommandHandler = (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['json'], USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);
  const decisions = requireProgressFile(requireWorkspace(context.currentDirectory)).decisions ?? [];
  const text = decisions.length === 0 ? 'No decision is open.' : decisions.map(decisionTextOf).join('\n\n');
  OutputUtil.printEntity(commandArguments, context, { decisions }, text);
  return Promise.resolve();
};
