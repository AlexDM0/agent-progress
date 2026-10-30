/**
 * Files a ticket the way one meant to be built is filed: `ticket add`, the sections `ticket ready` asks for appended to the filed body when
 * it lacks them, then `ticket ready`, so a spec of a later move starts from a `pending` ticket with its row rather than a draft.
 */
import { appendFileSync, readFileSync } from 'node:fs';

const ACCEPTANCE_SECTION    = '\n## Acceptance\n\nA1. The example holds.\n';
const BRIEF_SECTION         = '\n## Brief\n\nBuild the example as Alex Example asked.\n';
const NUMBERED_ITEM_PATTERN = /^A\d+\./m;
const BRIEF_HEADING_PATTERN = /^## Brief[ \t]*$/m;
const FILED_TICKET_PATTERN  = /(\/[^\s"]*\/tickets\/(\d+)-[^/\s"]*\.md)/;

/** `ticket add` arguments giving a ticket the numbered Acceptance and the Brief `ticket ready` asks for, for a setup listing its commands. */
export const READY_TICKET_BODY_ARGUMENTS = ['--body', `${ACCEPTANCE_SECTION}${BRIEF_SECTION}`.trimStart()] as const;

export interface FiledTicketFile {
  id:       string;
  filePath: string;
}

/** The ticket a `ticket add` output names by its file path, in human output and `--json` alike. */
export function filedTicketFileOf(addOutput: string): FiledTicketFile {
  const filedTicket = FILED_TICKET_PATTERN.exec(addOutput);
  if (filedTicket?.[1] === undefined || filedTicket[2] === undefined) {
    throw new Error(`No filed ticket file is named in the ticket add output: ${addOutput}`);
  }
  return { id: filedTicket[2], filePath: filedTicket[1] };
}

/** Appends a numbered Acceptance and a Brief to a filed ticket that lacks them, below everything it already holds. */
export function completeForReadiness(filePath: string): void {
  const storedText = readFileSync(filePath, 'utf8');
  const missingSections = [
    ...(NUMBERED_ITEM_PATTERN.test(storedText) ? [] : [ACCEPTANCE_SECTION]),
    ...(BRIEF_HEADING_PATTERN.test(storedText) ? [] : [BRIEF_SECTION]),
  ].join('');
  if (missingSections !== '') appendFileSync(filePath, missingSections);
}

/** Runs `ticket add` and `ticket ready` through the spec's own Overseer, which fails the spec on a non-zero exit; resolves to the filing's result. */
export async function fileReadyTicketThrough<Result>(
  runCommand: (commandLineArguments: readonly string[]) => Promise<Result>,
  outputOf: (result: Result) => string,
  addArguments: readonly string[],
): Promise<Result> {
  const filing      = await runCommand(addArguments);
  const filedTicket = filedTicketFileOf(outputOf(filing));
  completeForReadiness(filedTicket.filePath);
  await runCommand(['ticket', 'ready', filedTicket.id]);
  return filing;
}

/** `fileReadyTicketThrough` for an Overseer resolving to the captured command context. */
export async function fileReadyTicket<Context extends { outputText: () => string }>(
  runCommand: (commandLineArguments: readonly string[]) => Promise<Context>,
  addArguments: readonly string[],
): Promise<Context> {
  return await fileReadyTicketThrough(runCommand, (context) => context.outputText(), addArguments);
}
