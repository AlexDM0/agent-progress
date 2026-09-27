import { TrackerReadingWordingUtil }   from '../../src/adapters/utils/TrackerReadingWordingUtil.ts';
import type { DashboardRenderOutcome } from '../../src/services/tracker/DashboardRendering.ts';
import { LIMITS }                      from '../../src/shared/constants/Limits.ts';
import type { CommandContext }         from '../CommandContext.ts';
import type { ArgumentParser }         from '../arguments/ArgumentParser.ts';

function padColumn(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text.padEnd(width);
}

function ignoredTicketFileText(malformed: { filePath: string; line: number; reason: string }): string {
  const place = malformed.line > 0 ? ` (line ${malformed.line})` : '';
  return `Ticket file ignored: ${malformed.filePath}${place}: ${malformed.reason}`;
}

function reportIgnoredTicketFiles(context: CommandContext, malformedTickets: readonly { filePath: string; line: number; reason: string }[]): void {
  for (const malformed of malformedTickets) context.standardError(ignoredTicketFileText(malformed));
}

function printEntity(commandArguments: ArgumentParser, context: CommandContext, entity: unknown, humanLine: string): void {
  if (commandArguments.flag('json')) {
    context.standardOutput(JSON.stringify(entity, null, LIMITS.JSON_INDENT_SPACES));
    return;
  }
  context.standardOutput(humanLine);
}

/** The human line and the Next line under it, or the entity alone under `--json`, which a script parses and must never find a trailing sentence in. */
function printEntityThenNextLine(commandArguments: ArgumentParser, context: CommandContext, entity: unknown, humanLine: string, nextLine: string): void {
  printEntity(commandArguments, context, entity, `${humanLine}\n${nextLine}`);
}

/** The store is already written by the time this runs, so none of these fail the command: exit 0, reason on standard error. */
function reportRenderProblems(context: CommandContext, outcome: DashboardRenderOutcome): void {
  if (outcome.verdict === 'unreadable') {
    context.standardError(`The dashboard was not regenerated: ${TrackerReadingWordingUtil.renderReasonOf(outcome.reading)}`);
    return;
  }
  if (outcome.verdict === 'rendered-without-page-script') {
    context.standardError(`The dashboard was written without its page script, so the chart is not interactive: ${outcome.reason}`);
  }
  reportIgnoredTicketFiles(context, outcome.malformedTickets);
}

export const OutputUtil = {
  padColumn,
  printEntity,
  printEntityThenNextLine,
  ignoredTicketFileText,
  reportIgnoredTicketFiles,
  reportRenderProblems,
} as const;
