/**
 * A red handoff's handover, written in the job's folder as the same session is resumed to fix it: `gate-failure.md` for the agent to read
 * instead of rerunning the gate, and the facts its resume message is worded from, which a fresh session taking over reads again.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';

export const RED_HANDOFF_FILES = {
  handover: 'gate-failure.md',
  facts:    'red-handoff.json',
} as const;

export const HANDOVER_OUTPUT_LIMITS = {
  HEAD_LINES: 40,
  TAIL_LINES: 40,
  BYTES:      8192,
} as const;

/** What went red, and which resume of how many fixes it: the resume message and a fresh session's first message are worded from it. */
export interface RedHandoffFacts {
  /** `gate` for a red gate, `customs` for a refused Customs check (a dirty worktree, no commit, missing or stale gate claims). */
  kind:                'gate' | 'customs';
  /** The gate's name, or the Customs check's id. */
  name:                string;
  /** The gate's shell line; `null` for a Customs check. */
  command:             string | null;
  fixCommand:          string | null;
  commit:              string;
  exitCode:            number | null;
  handoverPath:        string;
  /** The gate's whole output; `null` for a Customs check. */
  fullLogPath:         string | null;
  resume:              number;
  resumesAllowed:      number;
  /** The host instance that went red: the resume's calls are counted from the next one. A fresh session taking over stores 0. */
  interruptedInstance: number;
  callBudget:          number;
}

const OMISSION_MARK = (omittedLines: number): string => `[… ${omittedLines} lines omitted …]`;
/** Room kept for the omission mark and a character a byte cut splits, so the excerpt stays inside its bytes. */
const BYTE_CUT_MARGIN = 64;

function bytesOf(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function firstBytesOf(text: string, byteCount: number): string {
  return Buffer.from(text, 'utf8').subarray(0, byteCount).toString('utf8').replace(/�$/u, '');
}

function lastBytesOf(text: string, byteCount: number): string {
  const bytes = Buffer.from(text, 'utf8');
  return bytes.subarray(Math.max(0, bytes.length - byteCount)).toString('utf8').replace(/^�/u, '');
}

/** The output's first and last lines with a mark for what lies between, cut to at most the byte limit, head and tail alike. */
function outputExcerptOf(output: string): string {
  const lines = output.replace(/\n$/, '').split('\n');
  const { HEAD_LINES, TAIL_LINES, BYTES } = HANDOVER_OUTPUT_LIMITS;
  const omittedLines = lines.length - HEAD_LINES - TAIL_LINES;
  const head = omittedLines > 0 ? lines.slice(0, HEAD_LINES).join('\n') : lines.join('\n');
  const tail = omittedLines > 0 ? lines.slice(-TAIL_LINES).join('\n') : '';
  const whole = omittedLines > 0 ? `${head}\n${OMISSION_MARK(omittedLines)}\n${tail}` : head;
  if (bytesOf(whole) <= BYTES) return whole;
  const halfBytes = Math.floor((BYTES - BYTE_CUT_MARGIN) / 2);
  const cutTail = tail === '' ? head : tail;
  return `${firstBytesOf(head, halfBytes)}\n[… cut to ${BYTES} bytes …]\n${lastBytesOf(cutTail, halfBytes)}`;
}

function handoverTextOf(facts: Readonly<RedHandoffFacts>, output: string): string {
  const what = facts.kind === 'gate' ? `Gate \`${facts.name}\`` : `Customs check ${facts.name}`;
  return [
    `# ${what} is red`,
    '',
    `- Gate: ${facts.kind === 'gate' ? facts.name : '-'}`,
    `- Customs check: ${facts.kind === 'customs' ? facts.name : '-'}`,
    `- Command: ${facts.command === null ? '-' : `\`${facts.command}\``}`,
    `- Fix command: ${facts.fixCommand === null ? '-' : `\`${facts.fixCommand}\``}`,
    `- Commit: ${facts.commit}`,
    `- Exit code: ${facts.exitCode === null ? '-' : String(facts.exitCode)}`,
    `- Full log: ${facts.fullLogPath ?? '-'}`,
    '',
    `## Output (first ${HANDOVER_OUTPUT_LIMITS.HEAD_LINES} and last ${HANDOVER_OUTPUT_LIMITS.TAIL_LINES} lines, at most ${HANDOVER_OUTPUT_LIMITS.BYTES} bytes)`,
    '',
    '```',
    outputExcerptOf(output),
    '```',
    '',
  ].join('\n');
}

function handoverPathOf(jobFolder: string): string {
  return join(jobFolder, RED_HANDOFF_FILES.handover);
}

/** Written before the job is interrupted, so the resume that reads the facts always finds the handover beside them. */
function writeRedHandoff(jobFolder: string, facts: Readonly<RedHandoffFacts>, output: string): void {
  writeFileAtomically(facts.handoverPath, handoverTextOf(facts, output));
  writeFileAtomically(join(jobFolder, RED_HANDOFF_FILES.facts), `${JSON.stringify(facts, null, 2)}\n`);
}

/** A fresh session taking over a red handoff keeps the facts in its own folder, so its calls count against the resume budget. */
function adoptRedHandoff(jobFolder: string, facts: Readonly<RedHandoffFacts>): void {
  if (redHandoffFactsOf(jobFolder) === null) writeFileAtomically(join(jobFolder, RED_HANDOFF_FILES.facts), `${JSON.stringify(facts, null, 2)}\n`);
}

/** `null` for a job that never went red, or whose facts file cannot be read. */
function redHandoffFactsOf(jobFolder: string): RedHandoffFacts | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(jobFolder, RED_HANDOFF_FILES.facts), 'utf8'));
    return typeof parsed === 'object' && parsed !== null && Object.hasOwn(parsed, 'handoverPath') ? parsed as RedHandoffFacts : null;
  } catch {
    return null;
  }
}

export const RedHandoff = Object.freeze({
  outputExcerptOf,
  handoverTextOf,
  handoverPathOf,
  writeRedHandoff,
  adoptRedHandoff,
  redHandoffFactsOf,
});
