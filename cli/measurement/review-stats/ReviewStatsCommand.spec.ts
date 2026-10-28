/**
 * `agent-progress review-stats` on an initialised scratch tracker filed through the CLI: tickets of two types and two agent pairs, their
 * rows' and review bars' tokens, `review-recorded` lines written into the log, bugs naming their cause and a ticket a review filed. What
 * matters: every figure in the text and in `--json`, for every recorded ticket and for each of the three splits, equals the value worked
 * out by hand below; a ticket with two passes is one ticket; an unrecorded ticket is only counted; a tracker without records says so at
 * exit 0; and the command leaves the whole `.agent-progress/` folder, the lock folder included, byte for byte as it found it.
 *
 * The board by hand. Alpha: a ticket, opus/medium, builder row 1000 tokens, bars 300 and 200, two passes (rounds 1 and 2), 30+10 changed
 * lines, delivered, one bug and one filed ticket name it. Beta: a bug, haiku/low, row 500, bar 100, one pass, 150+50 lines, delivered,
 * two bugs name it. Delta: a ticket, haiku/low, row 2000, a bar with no tokens, one pass, 600+300 lines, pending. Gamma and the four
 * tickets naming Alpha or Beta have no record.
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  readdirSync,
  readFileSync,
  statSync
} from 'node:fs';
import { join } from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                 from 'bun:test';
import type { ReviewStatisticsGroup, ReviewStatisticsReport } from '../../../src/lib/tracker-model/ReviewStatistics.ts';
import { PRODUCT_NAMES }                                      from '../../../src/shared/constants/ProductNames.ts';
import { gitIsAvailable, removeScratchDirectory }             from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                           from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                                     from '../../Main.ts';
import { createCapturedCommandContext }                       from '../../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository }                 from '../../testing/InitializedScratchRepository.ts';
import { READY_TICKET_BODY_ARGUMENTS }                        from '../../testing/ReadyTicketFiling.ts';

const FROZEN_NOW = new Date('2026-10-26T12:00:00Z');

const FIGURE_COLUMN_WIDTH_CHARACTERS = 40;

let repositoryDirectory = '';

async function run(commandArguments: readonly string[]): Promise<{ exitCode: number; output: string; error: string }> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandArguments, context);
  return { exitCode, output: context.outputText(), error: context.errorText() };
}

async function runJson<Document>(commandArguments: readonly string[]): Promise<Document> {
  const { exitCode, output, error } = await run([...commandArguments, '--json']);
  expect(exitCode, error).toBe(0);
  return JSON.parse(output) as Document;
}

async function fileTicket(title: string, filingArguments: readonly string[]): Promise<{ id: string; task: number }> {
  const draft = await runJson<{ id: string }>(['ticket', 'add', title, ...filingArguments, ...READY_TICKET_BODY_ARGUMENTS]);
  return await runJson<{ id: string; task: number }>(['ticket', 'ready', draft.id]);
}

async function addReviewBar(ticketId: string, tokenArguments: readonly string[]): Promise<number> {
  return (await runJson<{ id: number }>(['task', 'add', `Review of ${ticketId}`, '--review-of', ticketId, ...tokenArguments])).id;
}

interface PassFixture {
  round:       number;
  verdict:     string;
  insertions:  number;
  deletions:   number;
  fixLines:    number;
  rebaseLines: number;
  claims:      Array<[item: string, handoffContradicted: boolean]>;
  findings:    Array<[findingClass: string, severity: string]>;
}

function recordPass(ticketId: string, taskId: number, pass: PassFixture): void {
  const record = {
    at:     '2026-10-26T13:00:00+01:00',
    kind:   'review-recorded',
    taskId,
    ticketId,
    fields: {
      round:                   pass.round,
      verdict:                 pass.verdict,
      reviewStartCommit:       'abc1234',
      fixReworkedCodeLines:    pass.fixLines,
      rebaseReworkedCodeLines: pass.rebaseLines,
      totalReworkedCodeLines:  pass.fixLines + pass.rebaseLines,
      builderChangedFiles:     1,
      builderInsertions:       pass.insertions,
      builderDeletions:        pass.deletions,
      claims:                  pass.claims.map(([item, handoffContradicted]) => ({ item, result: 'holds', handoffContradicted })),
      findings:                pass.findings.map(([findingClass, severity]) => ({
        class: findingClass, severity, file: 'lib/example.ts', summary: 'An example finding', evidence: 'reading', outcome: 'fixed', commit: 'def5678',
      })),
    },
  };
  appendFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'log.jsonl'), `${JSON.stringify(record)}\n`);
}

async function expectSucceeds(commandArguments: readonly string[]): Promise<void> {
  const { exitCode, error } = await run(commandArguments);
  expect(exitCode, error).toBe(0);
}

async function fileTheBoard(): Promise<void> {
  const alpha = await fileTicket('Example alpha', ['--type', 'ticket']);
  const beta  = await fileTicket('Example beta', ['--type', 'bug', '--model', 'haiku', '--effort', 'low']);
  await fileTicket('Example gamma', ['--type', 'ticket']);
  const delta = await fileTicket('Example delta', ['--type', 'ticket', '--model', 'haiku', '--effort', 'low']);

  await expectSucceeds(['task', 'update', String(alpha.task), '--tokens', '1000']);
  await expectSucceeds(['task', 'update', String(beta.task), '--tokens', '500']);
  await expectSucceeds(['task', 'update', String(delta.task), '--tokens', '2000']);
  const alphaFirstBar  = await addReviewBar(alpha.id, ['--tokens', '300']);
  const alphaSecondBar = await addReviewBar(alpha.id, ['--tokens', '200']);
  const betaBar        = await addReviewBar(beta.id, ['--tokens', '100']);
  const deltaBar       = await addReviewBar(delta.id, []);

  await expectSucceeds(['ticket', 'status', alpha.id, 'delivered']);
  await expectSucceeds(['ticket', 'status', beta.id, 'delivered']);
  await fileTicket('Example alpha regression', ['--type', 'bug', '--introduced-by', alpha.id]);
  await fileTicket('Example beta regression', ['--type', 'bug', '--introduced-by', beta.id]);
  await fileTicket('Example beta second regression', ['--type', 'bug', '--introduced-by', beta.id]);
  await fileTicket('Example alpha review finding', ['--type', 'ticket', '--found-in-review', alpha.id]);

  recordPass(alpha.id, alphaFirstBar, {
    round:       1,
    verdict:     'round-requested',
    insertions:  30,
    deletions:   10,
    fixLines:    10,
    rebaseLines: 2,
    claims:      [['A1', false], ['A2', true]],
    findings:    [['correctness', 'would-ship-a-bug'], ['test-gap', 'quality']],
  });
  recordPass(alpha.id, alphaSecondBar, {
    round:       2,
    verdict:     'released',
    insertions:  30,
    deletions:   10,
    fixLines:    4,
    rebaseLines: 0,
    claims:      [['A1', false], ['A2', false]],
    findings:    [['docs', 'nit']],
  });
  recordPass(beta.id, betaBar, {
    round:       1,
    verdict:     'released',
    insertions:  150,
    deletions:   50,
    fixLines:    0,
    rebaseLines: 6,
    claims:      [['A1', true]],
    findings:    [['acceptance-gap', 'acceptance-fails']],
  });
  recordPass(delta.id, deltaBar, {
    round:       1,
    verdict:     'does-not-hold',
    insertions:  600,
    deletions:   300,
    fixLines:    0,
    rebaseLines: 0,
    claims:      [['A1', false]],
    findings:    [],
  });
}

function countsOf<Word extends string>(words: readonly Word[], nonZero: Partial<Record<Word, number>>): Record<Word, number> {
  return Object.fromEntries(words.map((word) => [word, nonZero[word] ?? 0])) as Record<Word, number>;
}

const VERDICTS = ['released', 'round-requested', 'does-not-hold', 'not-released', 'integrated'] as const;

const CLASSES = ['correctness', 'acceptance-gap', 'test-gap', 'handoff-claim-false', 'convention', 'docs', 'rebase', 'out-of-scope'] as const;

const SEVERITIES = ['would-ship-a-bug', 'acceptance-fails', 'quality', 'nit'] as const;

const ALPHA: ReviewStatisticsGroup = {
  ticketCount:                   1,
  reviewPassCount:               2,
  roundsPerTicket:               2,
  verdictCounts:                 countsOf(VERDICTS, { 'released': 1, 'round-requested': 1 }),
  findingCountByClass:           countsOf(CLASSES, { 'correctness': 1, 'test-gap': 1, 'docs': 1 }),
  findingCountBySeverity:        countsOf(SEVERITIES, { 'would-ship-a-bug': 1, 'quality': 1, 'nit': 1 }),
  seriousFindingCount:           1,
  seriousFindingsPerTicket:      1,
  reviewTokens:                  500,
  reviewTokensPerTicket:         500,
  builderTokens:                 1000,
  builderTokensPerTicket:        1000,
  reviewTokensPerSeriousFinding: 500,
  afterSeriousLastReview:        { deliveredTicketCount: 0, escapedBugCount: 0, escapedBugsPerDeliveredTicket: null },
  afterCleanLastReview:          { deliveredTicketCount: 1, escapedBugCount: 1, escapedBugsPerDeliveredTicket: 1 },
  ticketsFiledFromReviewsCount:  1,
  claimCount:                    4,
  handoffContradictedClaimCount: 1,
  handoffContradictedShare:      0.25,
  fixLines:                      14,
  fixLinesPerTicket:             14,
  rebaseLines:                   2,
  rebaseLinesPerTicket:          2,
};

const BETA: ReviewStatisticsGroup = {
  ticketCount:                   1,
  reviewPassCount:               1,
  roundsPerTicket:               1,
  verdictCounts:                 countsOf(VERDICTS, { released: 1 }),
  findingCountByClass:           countsOf(CLASSES, { 'acceptance-gap': 1 }),
  findingCountBySeverity:        countsOf(SEVERITIES, { 'acceptance-fails': 1 }),
  seriousFindingCount:           1,
  seriousFindingsPerTicket:      1,
  reviewTokens:                  100,
  reviewTokensPerTicket:         100,
  builderTokens:                 500,
  builderTokensPerTicket:        500,
  reviewTokensPerSeriousFinding: 100,
  afterSeriousLastReview:        { deliveredTicketCount: 1, escapedBugCount: 2, escapedBugsPerDeliveredTicket: 2 },
  afterCleanLastReview:          { deliveredTicketCount: 0, escapedBugCount: 0, escapedBugsPerDeliveredTicket: null },
  ticketsFiledFromReviewsCount:  0,
  claimCount:                    1,
  handoffContradictedClaimCount: 1,
  handoffContradictedShare:      1,
  fixLines:                      0,
  fixLinesPerTicket:             0,
  rebaseLines:                   6,
  rebaseLinesPerTicket:          6,
};

const DELTA: ReviewStatisticsGroup = {
  ticketCount:                   1,
  reviewPassCount:               1,
  roundsPerTicket:               1,
  verdictCounts:                 countsOf(VERDICTS, { 'does-not-hold': 1 }),
  findingCountByClass:           countsOf(CLASSES, {}),
  findingCountBySeverity:        countsOf(SEVERITIES, {}),
  seriousFindingCount:           0,
  seriousFindingsPerTicket:      0,
  reviewTokens:                  0,
  reviewTokensPerTicket:         0,
  builderTokens:                 2000,
  builderTokensPerTicket:        2000,
  reviewTokensPerSeriousFinding: null,
  afterSeriousLastReview:        { deliveredTicketCount: 0, escapedBugCount: 0, escapedBugsPerDeliveredTicket: null },
  afterCleanLastReview:          { deliveredTicketCount: 0, escapedBugCount: 0, escapedBugsPerDeliveredTicket: null },
  ticketsFiledFromReviewsCount:  0,
  claimCount:                    1,
  handoffContradictedClaimCount: 0,
  handoffContradictedShare:      0,
  fixLines:                      0,
  fixLinesPerTicket:             0,
  rebaseLines:                   0,
  rebaseLinesPerTicket:          0,
};

/** Alpha and Delta: (2 + 1) rounds over 2 tickets, 500 review tokens over 1 serious finding, 1 of 5 claims contradicted. */
const TICKET_TYPE: ReviewStatisticsGroup = {
  ticketCount:                   2,
  reviewPassCount:               3,
  roundsPerTicket:               1.5,
  verdictCounts:                 countsOf(VERDICTS, { 'released': 1, 'round-requested': 1, 'does-not-hold': 1 }),
  findingCountByClass:           countsOf(CLASSES, { 'correctness': 1, 'test-gap': 1, 'docs': 1 }),
  findingCountBySeverity:        countsOf(SEVERITIES, { 'would-ship-a-bug': 1, 'quality': 1, 'nit': 1 }),
  seriousFindingCount:           1,
  seriousFindingsPerTicket:      0.5,
  reviewTokens:                  500,
  reviewTokensPerTicket:         250,
  builderTokens:                 3000,
  builderTokensPerTicket:        1500,
  reviewTokensPerSeriousFinding: 500,
  afterSeriousLastReview:        { deliveredTicketCount: 0, escapedBugCount: 0, escapedBugsPerDeliveredTicket: null },
  afterCleanLastReview:          { deliveredTicketCount: 1, escapedBugCount: 1, escapedBugsPerDeliveredTicket: 1 },
  ticketsFiledFromReviewsCount:  1,
  claimCount:                    5,
  handoffContradictedClaimCount: 1,
  handoffContradictedShare:      0.2,
  fixLines:                      14,
  fixLinesPerTicket:             7,
  rebaseLines:                   2,
  rebaseLinesPerTicket:          1,
};

/** Beta and Delta: 100 review tokens over 2 tickets, 2500 builder tokens, 1 of 2 claims contradicted, 6 rebase lines over 2. */
const HAIKU_LOW: ReviewStatisticsGroup = {
  ticketCount:                   2,
  reviewPassCount:               2,
  roundsPerTicket:               1,
  verdictCounts:                 countsOf(VERDICTS, { 'released': 1, 'does-not-hold': 1 }),
  findingCountByClass:           countsOf(CLASSES, { 'acceptance-gap': 1 }),
  findingCountBySeverity:        countsOf(SEVERITIES, { 'acceptance-fails': 1 }),
  seriousFindingCount:           1,
  seriousFindingsPerTicket:      0.5,
  reviewTokens:                  100,
  reviewTokensPerTicket:         50,
  builderTokens:                 2500,
  builderTokensPerTicket:        1250,
  reviewTokensPerSeriousFinding: 100,
  afterSeriousLastReview:        { deliveredTicketCount: 1, escapedBugCount: 2, escapedBugsPerDeliveredTicket: 2 },
  afterCleanLastReview:          { deliveredTicketCount: 0, escapedBugCount: 0, escapedBugsPerDeliveredTicket: null },
  ticketsFiledFromReviewsCount:  0,
  claimCount:                    2,
  handoffContradictedClaimCount: 1,
  handoffContradictedShare:      0.5,
  fixLines:                      0,
  fixLinesPerTicket:             0,
  rebaseLines:                   6,
  rebaseLinesPerTicket:          3,
};

/** All three: 4 rounds over 3 tickets, 600 review tokens over 2 serious findings, 2 of 6 claims contradicted, 14 fix lines over 3. */
const ALL: ReviewStatisticsGroup = {
  ticketCount:         3,
  reviewPassCount:     4,
  roundsPerTicket:     4 / 3,
  verdictCounts:       countsOf(VERDICTS, { 'released': 2, 'round-requested': 1, 'does-not-hold': 1 }),
  findingCountByClass: countsOf(CLASSES, {
    'correctness': 1, 'acceptance-gap': 1, 'test-gap': 1, 'docs': 1
  }),
  findingCountBySeverity: countsOf(SEVERITIES, {
    'would-ship-a-bug': 1, 'acceptance-fails': 1, 'quality': 1, 'nit': 1
  }),
  seriousFindingCount:           2,
  seriousFindingsPerTicket:      2 / 3,
  reviewTokens:                  600,
  reviewTokensPerTicket:         200,
  builderTokens:                 3500,
  builderTokensPerTicket:        3500 / 3,
  reviewTokensPerSeriousFinding: 300,
  afterSeriousLastReview:        { deliveredTicketCount: 1, escapedBugCount: 2, escapedBugsPerDeliveredTicket: 2 },
  afterCleanLastReview:          { deliveredTicketCount: 1, escapedBugCount: 1, escapedBugsPerDeliveredTicket: 1 },
  ticketsFiledFromReviewsCount:  1,
  claimCount:                    6,
  handoffContradictedClaimCount: 2,
  handoffContradictedShare:      2 / 6,
  fixLines:                      14,
  fixLinesPerTicket:             14 / 3,
  rebaseLines:                   8,
  rebaseLinesPerTicket:          8 / 3,
};

/**
 * The text column of each group above, figure by figure as the tables print them: counts, verdicts, classes, severities, serious
 * findings, tokens, the serious and the clean escapes, filed tickets, claims and the contradicted share, fix and rebase lines; written as
 * one line split on its spaces only to keep the rows short.
 */
const ALPHA_CELLS     = '1 2 2.00 1 1 0 0 0 1 0 1 0 0 1 0 0 1 0 1 1 1 1.00 500 1000 500 0 0 - 1 1 1.00 1 4 25% 14.00 2.00'.split(' ');
const BETA_CELLS      = '1 1 1.00 1 0 0 0 0 0 1 0 0 0 0 0 0 0 1 0 0 1 1.00 100 500 100 1 2 2.00 0 0 - 0 1 100% 0.00 6.00'.split(' ');
const DELTA_CELLS     = '1 1 1.00 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.00 0 2000 - 0 0 - 0 0 - 0 1 0% 0.00 0.00'.split(' ');
const TICKET_CELLS    = '2 3 1.50 1 1 1 0 0 1 0 1 0 0 1 0 0 1 0 1 1 1 0.50 250 1500 500 0 0 - 1 1 1.00 1 5 20% 7.00 1.00'.split(' ');
const HAIKU_LOW_CELLS = '2 2 1.00 1 0 1 0 0 0 1 0 0 0 0 0 0 0 1 0 0 1 0.50 50 1250 100 1 2 2.00 0 0 - 0 2 50% 0.00 3.00'.split(' ');
const ALL_CELLS       = '3 4 1.33 2 1 1 0 0 1 1 1 0 0 1 0 0 1 1 1 1 2 0.67 200 1167 300 1 2 2.00 1 1 1.00 1 6 33% 4.67 2.67'.split(' ');

/** Each table: its title, its header cells, and each figure row's cells split on the column gaps. */
function tablesOf(text: string): Array<{ title: string; header: string[]; columns: string[][] }> {
  return text.split('\n\n').slice(0, -1).map((block) => {
    const [title = '', headerLine = '', ...figureLines] = block.split('\n');
    const cellsOf = (line: string): string[] => line.slice(FIGURE_COLUMN_WIDTH_CHARACTERS).trim().split(/\s{2,}/);
    const rows    = figureLines.map(cellsOf);
    const header  = cellsOf(headerLine);
    return { title, header, columns: header.map((_name, i) => rows.map((row) => row[i] ?? '')) };
  });
}

function trackerFolderSnapshot(): Record<string, string> {
  const trackerDirectory = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER);
  return Object.fromEntries(readdirSync(trackerDirectory, { recursive: true, encoding: 'utf8' })
    .filter((relativePath) => statSync(join(trackerDirectory, relativePath)).isFile())
    .sort()
    .map((relativePath) => [relativePath, createHash('sha256').update(readFileSync(join(trackerDirectory, relativePath))).digest('hex')]));
}

beforeEach(async () => {
  if (!gitIsAvailable()) return;
  repositoryDirectory = await createInitializedScratchRepository('review-stats', ['--project', 'Example Agency'], () => FROZEN_NOW);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('review-stats', () => {
  test('a tracker without a recorded review says so at exit 0, counting its tickets apart', async () => {
    await fileTicket('Example alpha', ['--type', 'ticket']);

    const { exitCode, output, error } = await run(['review-stats']);

    expect(exitCode, error).toBe(0);
    expect(output).toBe('No ticket has a recorded review yet, so there is nothing to report. 1 ticket has no recorded review and is left out.');
  });

  test('--json prints the hand-computed figures for all recorded tickets and for each split, unrecorded tickets only counted', async () => {
    await fileTheBoard();

    const report = await runJson<ReviewStatisticsReport>(['review-stats']);

    expect(report).toEqual({
      recordedTicketCount:   3,
      unrecordedTicketCount: 5,
      all:                   ALL,
      byType:                [{ type: 'ticket', statistics: TICKET_TYPE }, { type: 'bug', statistics: BETA }],
      byChangeSize:          [{ changeSize: 'small', statistics: ALPHA }, { changeSize: 'medium', statistics: BETA }, { changeSize: 'oversized', statistics: DELTA }],
      byBuilder:             [{ model: 'opus', effort: 'medium', statistics: ALPHA }, { model: 'haiku', effort: 'low', statistics: HAIKU_LOW }],
    });
  });

  test('the text prints the same hand-computed figures in each table, then the unrecorded count', async () => {
    await fileTheBoard();

    const { exitCode, output, error } = await run(['review-stats']);

    expect(exitCode, error).toBe(0);
    expect(tablesOf(output)).toEqual([
      { title: 'All recorded tickets', header: ['all'], columns: [ALL_CELLS] },
      { title: 'By ticket type', header: ['ticket', 'bug'], columns: [TICKET_CELLS, BETA_CELLS] },
      { title: 'By builder change size', header: ['<=50 lines', '<=200 lines', '>750 lines'], columns: [ALPHA_CELLS, BETA_CELLS, DELTA_CELLS] },
      { title: 'By builder model and effort', header: ['opus/medium', 'haiku/low'], columns: [ALPHA_CELLS, HAIKU_LOW_CELLS] },
    ]);
    expect(output.split('\n').at(-1)).toBe('5 tickets have no recorded review and are left out.');
  });

  test('it takes no lock and leaves every tracker file, progress.json, log.jsonl and progress.html among them, byte-identical', async () => {
    await fileTheBoard();
    const before = trackerFolderSnapshot();

    await expectSucceeds(['review-stats']);
    await expectSucceeds(['review-stats', '--json']);

    expect(Object.keys(before)).toEqual(expect.arrayContaining(['progress.json', 'log.jsonl', 'progress.html']));
    expect(trackerFolderSnapshot()).toEqual(before);
  });
});
