/**
 * `agent-progress review record` end to end in an initialised scratch repository whose ticket is under review: a builder's commit, a
 * reviewer's fix, the main line moving underneath with a conflict, and a rebase resolved by hand. What matters: the record's rework parts
 * equal what `rework --since` printed before the rebase and `rework --rebased-from` printed after it, its total is their sum, the builder's
 * change is measured at the review's start, and every refusal (a word outside an enum, a missing field, no review bar) writes nothing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join }            from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                               from 'bun:test';
import { PRODUCT_NAMES }              from '../../../src/shared/constants/ProductNames.ts';
import {
  createScratchDirectory,
  gitIsAvailable,
  removeScratchDirectory,
  SCRATCH_COMMIT_IDENTITY_ARGUMENTS
}                                               from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../../Main.ts';
import { createCapturedCommandContext }       from '../../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../../testing/InitializedScratchRepository.ts';
import { storedLogTextOf }                    from '../../testing/StoredLogText.ts';

const FROZEN_NOW = new Date('2026-10-26T12:00:00Z');

const COMMIT_IDENTITY_WITHOUT_EDITOR = [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, '-c', 'core.editor=true'];

const SHARED_BEFORE = 'export function greet(): string {\n  return \'hello\';\n}\n';

const VALID_FINDINGS = {
  verdict: 'released',
  claims:  [
    { item: 'A1', result: 'holds', handoffContradicted: false },
    { item: 'A2', result: 'waived', handoffContradicted: true },
  ],
  findings: [
    {
      class:    'correctness',
      severity: 'would-ship-a-bug',
      file:     'lib/builder.ts',
      summary:  'The example value was off by one',
      evidence: 'watched-fail',
      outcome:  'fixed',
      commit:   'abc1234',
      ignored:  'an unknown key is not stored',
    },
  ],
};

interface ReworkDocument {
  reworkedCodeLines: number;
}

let repositoryDirectory = '';
let outsideDirectory    = '';

function gitOrFail(gitArguments: readonly string[]): string {
  const finished = Bun.spawnSync(['git', ...COMMIT_IDENTITY_WITHOUT_EDITOR, ...gitArguments], { cwd: repositoryDirectory, stdout: 'pipe', stderr: 'pipe' });
  const output   = `${finished.stdout.toString()}${finished.stderr.toString()}`.trim();
  if (finished.exitCode !== 0) throw new Error(`git ${gitArguments.join(' ')} failed: ${output}`);
  return output;
}

function writeRepositoryFile(relativePath: string, content: string): void {
  const absolutePath = join(repositoryDirectory, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function commitEverything(message: string): string {
  gitOrFail(['add', '--all']);
  gitOrFail(['commit', '-q', '-m', message]);
  return gitOrFail(['rev-parse', 'HEAD']);
}

async function run(commandArguments: readonly string[]): Promise<{ exitCode: number; output: string; error: string }> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandArguments, context);
  return { exitCode, output: context.outputText(), error: context.errorText() };
}

async function reworkedCodeLinesOf(commandArguments: readonly string[]): Promise<number> {
  const { exitCode, output, error } = await run(['rework', ...commandArguments, '--worktree', repositoryDirectory, '--json']);
  expect(exitCode, error).toBe(0);
  return (JSON.parse(output) as ReworkDocument).reworkedCodeLines;
}

function findingsFileWith(document: unknown): string {
  const findingsPath = join(outsideDirectory, 'findings.json');
  writeFileSync(findingsPath, JSON.stringify(document));
  return findingsPath;
}

/** The builder's branch off `main`, committed, its ticket finished into review with a review bar, and the review's start returned. */
async function buildTheTicketUnderReview(): Promise<string> {
  gitOrFail(['checkout', '-q', '-B', 'main']);
  writeRepositoryFile('lib/shared.ts', SHARED_BEFORE);
  commitEverything('Base');
  gitOrFail(['checkout', '-q', '-b', 'feature']);
  writeRepositoryFile('lib/shared.ts', SHARED_BEFORE.replace('\'hello\'', '\'hello from the builder\''));
  writeRepositoryFile('lib/builder.ts', 'export const builderValue = 1;\nexport const builderOther = 2;\n');
  const reviewStart = commitEverything('Builder');
  for (const commandArguments of [['ticket', 'add', 'Example checkout page', '--type', 'ticket'], ['ticket', 'start', '1'], ['ticket', 'finish', '1', '--start-review']]) {
    const { exitCode, error } = await run(commandArguments);
    expect(exitCode, error).toBe(0);
  }
  return reviewStart;
}

function commitTheReviewFix(): void {
  writeRepositoryFile('lib/builder.ts', 'export const builderValue = 10;\nexport const builderOther = 2;\nexport const reviewed = true;\n');
  commitEverything('Review fix');
}

function moveTheMainLineAndRebase(): void {
  gitOrFail(['checkout', '-q', 'main']);
  writeRepositoryFile('lib/shared.ts', SHARED_BEFORE.replace('\'hello\'', '\'hello from main\''));
  commitEverything('Main moves');
  gitOrFail(['checkout', '-q', 'feature']);
  const rebase = Bun.spawnSync(['git', ...COMMIT_IDENTITY_WITHOUT_EDITOR, 'rebase', '-q', 'main'], { cwd: repositoryDirectory, stdout: 'pipe', stderr: 'pipe' });
  expect(rebase.exitCode, 'the rebase stops on the conflict it was built to have').not.toBe(0);
  writeRepositoryFile('lib/shared.ts', 'export function greet(): string {\n  return \'hello from both\';\n}\n');
  gitOrFail(['add', 'lib/shared.ts']);
  gitOrFail(['rebase', '--continue']);
}

function lastLogRecord(): Record<string, unknown> {
  const lines = storedLogTextOf(repositoryDirectory).trim().split('\n');
  return JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
}

beforeEach(async () => {
  if (!gitIsAvailable()) return;
  repositoryDirectory = await createInitializedScratchRepository('review-record', ['--project', 'Example Agency'], () => FROZEN_NOW);
  outsideDirectory    = createScratchDirectory('review-record-outside');
  commitEverything('Adopt agent-progress');
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
  removeScratchDirectory(outsideDirectory);
});

describeWhenGitIsPresent('recording a review pass', () => {
  test('one review-recorded line names the bar, the round, the verdict, the claims, the findings, the rework and the builder change', async () => {
    const reviewStart = await buildTheTicketUnderReview();
    commitTheReviewFix();

    const { exitCode, output, error } = await run([
      'review', 'record', '1', '--worktree', repositoryDirectory, '--since', reviewStart, '--findings-file', findingsFileWith(VALID_FINDINGS),
    ]);
    expect(exitCode, error).toBe(0);
    expect(output).toContain('reworkedLines: 3');

    const record = lastLogRecord();
    expect(record).toMatchObject({ kind: 'review-recorded', ticketId: '001', taskId: 2 });
    expect(record['fields']).toEqual({
      round:                   1,
      verdict:                 'released',
      reviewStartCommit:       reviewStart,
      fixReworkedCodeLines:    3,
      rebaseReworkedCodeLines: 0,
      totalReworkedCodeLines:  3,
      builderChangedFiles:     2,
      builderInsertions:       3,
      builderDeletions:        1,
      claims:                  VALID_FINDINGS.claims,
      findings:                [{
        class:    'correctness',
        severity: 'would-ship-a-bug',
        file:     'lib/builder.ts',
        summary:  'The example value was off by one',
        evidence: 'watched-fail',
        outcome:  'fixed',
        commit:   'abc1234',
      }],
    });
    expect((await run(['status'])).exitCode, 'the log holding the new kind still reads').toBe(0);
  });

  test('the fix and rebase parts equal what rework --since printed before the rebase and rework --rebased-from after it', async () => {
    const reviewStart = await buildTheTicketUnderReview();
    commitTheReviewFix();
    const fixCount         = await reworkedCodeLinesOf(['--since', reviewStart]);
    const preRebaseTip     = gitOrFail(['rev-parse', 'HEAD']);
    moveTheMainLineAndRebase();
    const rebaseCount      = await reworkedCodeLinesOf(['--rebased-from', preRebaseTip, '--main', 'main']);
    expect(rebaseCount, 'the hand resolution is counted').toBeGreaterThan(0);

    const { exitCode, output, error } = await run([
      'review',
      'record',
      '1',
      '--worktree',
      repositoryDirectory,
      '--since',
      reviewStart,
      '--rebased-from',
      preRebaseTip,
      '--main',
      'main',
      '--findings-file',
      findingsFileWith(VALID_FINDINGS),
      '--json',
    ]);
    expect(exitCode, error).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ reworkedLines: fixCount + rebaseCount });
    expect(lastLogRecord()['fields']).toMatchObject({
      fixReworkedCodeLines:    fixCount,
      rebaseReworkedCodeLines: rebaseCount,
      totalReworkedCodeLines:  fixCount + rebaseCount,
      builderChangedFiles:     2,
    });
  });

  const REFUSED_FINDINGS: readonly (readonly [string, unknown, string])[] = [
    ['a severity outside the enum', { ...VALID_FINDINGS, findings: [{ ...VALID_FINDINGS.findings[0], severity: 'major' }] }, 'findings[0].severity is "major"'],
    ['a verdict outside the enum', { ...VALID_FINDINGS, verdict: 'approved' }, 'verdict is "approved"'],
    ['a claim result outside the enum', { ...VALID_FINDINGS, claims: [{ item: 'A1', result: 'maybe', handoffContradicted: false }] }, 'claims[0].result is "maybe"'],
    ['a class outside the enum', { ...VALID_FINDINGS, findings: [{ ...VALID_FINDINGS.findings[0], class: 'style' }] }, 'findings[0].class is "style"'],
    ['a missing claims list', { verdict: 'released', findings: [] }, 'claims is not a list'],
    ['a fixed finding without its commit', { ...VALID_FINDINGS, findings: [{ ...VALID_FINDINGS.findings[0], commit: undefined }] }, 'findings[0].commit is not'],
    ['a filed finding without its ticket', { ...VALID_FINDINGS, findings: [{ ...VALID_FINDINGS.findings[0], outcome: 'filed' }] }, 'findings[0].filedTicketId is not'],
    ['a claim without handoffContradicted', { ...VALID_FINDINGS, claims: [{ item: 'A1', result: 'holds' }] }, 'claims[0].handoffContradicted is not'],
  ];

  for (const [named, findings, reasonText] of REFUSED_FINDINGS) {
    test(`a findings file with ${named} is refused at exit 1 and leaves log.jsonl byte-identical`, async () => {
      const reviewStart = await buildTheTicketUnderReview();
      const logBefore   = storedLogTextOf(repositoryDirectory);
      const { exitCode, error } = await run(['review', 'record', '1', '--worktree', repositoryDirectory, '--since', reviewStart, '--findings-file', findingsFileWith(findings)]);
      expect(exitCode).toBe(1);
      expect(error).toContain(reasonText);
      expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
    });
  }

  test('a ticket with no in-progress review bar is refused at exit 1 and leaves log.jsonl byte-identical', async () => {
    const reviewStart = await buildTheTicketUnderReview();
    expect((await run(['ticket', 'add', 'Example cart', '--type', 'ticket'])).exitCode).toBe(0);
    const logBefore = storedLogTextOf(repositoryDirectory);
    const { exitCode, error } = await run([
      'review', 'record', '2', '--worktree', repositoryDirectory, '--since', reviewStart, '--findings-file', findingsFileWith(VALID_FINDINGS),
    ]);
    expect(exitCode).toBe(1);
    expect(error).toContain('Ticket #002 has no in-progress review bar');
    expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
  });

  test('a --bar that is not a row id is refused with the usage', async () => {
    const reviewStart = await buildTheTicketUnderReview();
    const { exitCode, error } = await run([
      'review', 'record', '1', '--worktree', repositoryDirectory, '--since', reviewStart, '--findings-file', findingsFileWith(VALID_FINDINGS), '--bar', 'first',
    ]);
    expect(exitCode).toBe(1);
    expect(error).toContain('--bar "first" is not a row id');
  });

  test('a word other than record, or a missing --since, is refused with the usage', async () => {
    const wrongSubcommand = await run(['review', 'start', '1']);
    expect(wrongSubcommand.exitCode).toBe(1);
    expect(wrongSubcommand.error).toContain(`${PRODUCT_NAMES.PROGRAM} review takes the subcommand record and was given "start"`);
    const missingSince = await run(['review', 'record', '1', '--worktree', repositoryDirectory, '--findings-file', '-']);
    expect(missingSince.exitCode).toBe(1);
    expect(missingSince.error).toContain('needs --since');
  });
});

/**
 * Tickets 001 and 002 claimed as one bundle, built on the branch and finished, 001's finish starting the bundle's one review bar (row 3);
 * 003 is built and reviewed on its own bar (row 5), outside the bundle. Returns the review's start.
 */
async function buildABundleUnderReview(): Promise<string> {
  const reviewStart = await buildTheBranchOnly();
  for (const commandArguments of [
    ['ticket', 'add', 'Example checkout page', '--type', 'ticket'],
    ['ticket', 'add', 'Example cart', '--type', 'ticket'],
    ['ticket', 'claim', '1', '2'],
    ['ticket', 'finish', '1', '--start-review'],
    ['ticket', 'finish', '2'],
    ['ticket', 'add', 'Example invoice', '--type', 'ticket'],
    ['ticket', 'start', '3'],
    ['ticket', 'finish', '3', '--start-review'],
  ]) {
    const { exitCode, error } = await run(commandArguments);
    expect(exitCode, `${commandArguments.join(' ')}: ${error}`).toBe(0);
  }
  return reviewStart;
}

async function buildTheBranchOnly(): Promise<string> {
  gitOrFail(['checkout', '-q', '-B', 'main']);
  writeRepositoryFile('lib/shared.ts', SHARED_BEFORE);
  commitEverything('Base');
  gitOrFail(['checkout', '-q', '-b', 'feature']);
  writeRepositoryFile('lib/builder.ts', 'export const builderValue = 1;\n');
  return commitEverything('Builder');
}

describeWhenGitIsPresent('recording a bundle review on its one bar with --bar', () => {
  test('both tickets of the bundle get their own review-recorded line on the bundle\'s bar, at its round', async () => {
    const reviewStart = await buildABundleUnderReview();
    for (const ticketId of ['1', '2']) {
      const { exitCode, error } = await run([
        'review', 'record', ticketId, '--worktree', repositoryDirectory, '--since', reviewStart, '--findings-file', findingsFileWith(VALID_FINDINGS), '--bar', '3',
      ]);
      expect(exitCode, error).toBe(0);
    }
    const recorded = storedLogTextOf(repositoryDirectory).trim().split('\n')
      .map((line) => JSON.parse(line) as { kind: string; taskId?: number; ticketId?: string; fields?: { round?: number } })
      .filter((record) => record.kind === 'review-recorded')
      .map((record) => [record.ticketId, record.taskId, record.fields?.round]);
    expect(recorded).toEqual([['001', 3, 1], ['002', 3, 1]]);
  });

  const WRONG_BARS: readonly (readonly [string, string, string, string])[] = [
    ['the ticket\'s own row, which is no review bar', '2', '2', 'Row #2 is not an in-progress review bar'],
    ['a row the board does not hold', '2', '99', 'Row #99 is not an in-progress review bar'],
    ['the review bar of a ticket outside the bundle', '2', '5', 'Review bar #5 reviews ticket #003, which was not claimed with ticket #002'],
    ['the bundle\'s bar, for a ticket outside the bundle', '3', '3', 'Review bar #3 reviews ticket #001, which was not claimed with ticket #003'],
  ];

  for (const [named, ticketId, barTaskId, reasonText] of WRONG_BARS) {
    test(`--bar naming ${named} is refused at exit 1 and leaves log.jsonl byte-identical`, async () => {
      const reviewStart = await buildABundleUnderReview();
      const logBefore   = storedLogTextOf(repositoryDirectory);
      const { exitCode, error } = await run([
        'review', 'record', ticketId, '--worktree', repositoryDirectory, '--since', reviewStart, '--findings-file', findingsFileWith(VALID_FINDINGS), '--bar', barTaskId,
      ]);
      expect(exitCode).toBe(1);
      expect(error).toContain(reasonText);
      expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
    });
  }
});
