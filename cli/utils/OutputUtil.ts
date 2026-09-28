import { LogUtil }                        from '../../src/adapters/utils/LogUtil.ts';
import { TrackerReadingWordingUtil }      from '../../src/adapters/utils/TrackerReadingWordingUtil.ts';
import type { LogRecord }                 from '../../src/lib/tracker-model/@types/LogRecord.ts';
import type { DashboardRenderOutcome }    from '../../src/services/tracker/DashboardRendering.ts';
import type { MalformedTicketFile }       from '../../src/services/tracker/TicketStore.ts';
import { JsonTextUtil }                   from '../../src/shared/utils/JsonTextUtil.ts';
import type { CommandContext }            from '../CommandContext.ts';
import type { ArgumentParser }            from '../arguments/ArgumentParser.ts';
import { SHORT_COMMIT_LENGTH_CHARACTERS } from '../constants/GitDefaults.ts';

function padColumn(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text.padEnd(width);
}

function ignoredTicketFileText(malformed: MalformedTicketFile): string {
  const place = malformed.line > 0 ? ` (line ${malformed.line})` : '';
  return `Ticket file ignored: ${malformed.filePath}${place}: ${malformed.reason}`;
}

function reportIgnoredTicketFiles(context: CommandContext, malformedTickets: readonly MalformedTicketFile[]): void {
  for (const malformed of malformedTickets) context.standardError(ignoredTicketFileText(malformed));
}

function loggedSentencesOf(logged: readonly LogRecord[]): string {
  return logged.map((record) => LogUtil.sentenceOf(record)).join('\n');
}

function printEntity(commandArguments: ArgumentParser, context: CommandContext, entity: unknown, humanLine: string): void {
  if (commandArguments.flag('json')) {
    context.standardOutput(JsonTextUtil.indentedTextOf(entity));
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

/** A commit printed in a sentence, cut to its first characters as git abbreviates; a text already that short is kept whole. */
function shortCommitOf(commit: string): string {
  return commit.slice(0, SHORT_COMMIT_LENGTH_CHARACTERS);
}

export const OutputUtil = {
  padColumn,
  shortCommitOf,
  loggedSentencesOf,
  printEntity,
  printEntityThenNextLine,
  ignoredTicketFileText,
  reportIgnoredTicketFiles,
  reportRenderProblems,
} as const;
