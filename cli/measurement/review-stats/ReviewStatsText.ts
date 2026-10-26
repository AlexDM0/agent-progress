/** What `review-stats` prints for a person: one table per split, a row per figure and a column per group, `docs/cli.md` defining each figure. */
import type {
  ChangeSizeBucket,
  EscapedBugCounts,
  ReviewStatisticsGroup,
  ReviewStatisticsReport
}                                                                         from '../../../src/lib/tracker-model/ReviewStatistics.ts';
import { CHANGE_SIZE_BUCKET_MAXIMUM_CHANGED_LINES, LARGE_CHANGE_MAXIMUM_CHANGED_LINES } from '../../../src/lib/tracker-model/constants/ChangeSizeBuckets.ts';
import { REVIEW_FINDING_CLASSES, REVIEW_FINDING_SEVERITIES, REVIEW_VERDICTS }           from '../../../src/lib/tracker-model/constants/ReviewRecordVocabulary.ts';
import { OutputUtil }                                                                   from '../../utils/OutputUtil.ts';

const FIGURE_COLUMN_WIDTH_CHARACTERS = 40;

const GROUP_COLUMN_MINIMUM_WIDTH_CHARACTERS = 14;

const GROUP_COLUMN_GAP_CHARACTERS = 2;

const RATE_DECIMALS = 2;

const NO_VALUE = '-';

interface NamedGroup {
  name:       string;
  statistics: ReviewStatisticsGroup;
}

type FigureCell = (statistics: ReviewStatisticsGroup) => string;

function rateText(rate: number | null): string {
  return rate === null ? NO_VALUE : rate.toFixed(RATE_DECIMALS);
}

function tokenText(tokens: number | null): string {
  return tokens === null ? NO_VALUE : String(Math.round(tokens));
}

function shareText(share: number | null): string {
  return share === null ? NO_VALUE : `${Math.round(share * 100)}%`;
}

function escapedBugFigures(label: string, countsOf: (statistics: ReviewStatisticsGroup) => EscapedBugCounts): Array<[string, FigureCell]> {
  return [
    [`delivered, last review ${label}`, (statistics) => String(countsOf(statistics).deliveredTicketCount)],
    [`escaped bugs, last review ${label}`, (statistics) => String(countsOf(statistics).escapedBugCount)],
    [`escaped bugs per delivered, ${label}`, (statistics) => rateText(countsOf(statistics).escapedBugsPerDeliveredTicket)],
  ];
}

const FIGURES: ReadonlyArray<[string, FigureCell]> = [
  ['tickets recorded', (statistics) => String(statistics.ticketCount)],
  ['review passes', (statistics) => String(statistics.reviewPassCount)],
  ['rounds per ticket', (statistics) => rateText(statistics.roundsPerTicket)],
  ...REVIEW_VERDICTS.map((verdict): [string, FigureCell] => [`verdict ${verdict}`, (statistics) => String(statistics.verdictCounts[verdict])]),
  ...REVIEW_FINDING_CLASSES.map((findingClass): [string, FigureCell] => [
    `findings class ${findingClass}`, (statistics) => String(statistics.findingCountByClass[findingClass]),
  ]),
  ...REVIEW_FINDING_SEVERITIES.map((severity): [string, FigureCell] => [
    `findings severity ${severity}`, (statistics) => String(statistics.findingCountBySeverity[severity]),
  ]),
  ['serious findings', (statistics) => String(statistics.seriousFindingCount)],
  ['serious findings per ticket', (statistics) => rateText(statistics.seriousFindingsPerTicket)],
  ['review tokens per ticket', (statistics) => tokenText(statistics.reviewTokensPerTicket)],
  ['builder tokens per ticket', (statistics) => tokenText(statistics.builderTokensPerTicket)],
  ['review tokens per serious finding', (statistics) => tokenText(statistics.reviewTokensPerSeriousFinding)],
  ...escapedBugFigures('serious', (statistics) => statistics.afterSeriousLastReview),
  ...escapedBugFigures('clean', (statistics) => statistics.afterCleanLastReview),
  ['tickets filed from reviews', (statistics) => String(statistics.ticketsFiledFromReviewsCount)],
  ['claims', (statistics) => String(statistics.claimCount)],
  ['claims contradicting the handoff', (statistics) => shareText(statistics.handoffContradictedShare)],
  ['fix lines per ticket', (statistics) => rateText(statistics.fixLinesPerTicket)],
  ['rebase lines per ticket', (statistics) => rateText(statistics.rebaseLinesPerTicket)],
];

function changeSizeNameOf(changeSize: ChangeSizeBucket): string {
  const maximum = CHANGE_SIZE_BUCKET_MAXIMUM_CHANGED_LINES[changeSize];
  return Number.isFinite(maximum) ? `<=${maximum} lines` : `>${LARGE_CHANGE_MAXIMUM_CHANGED_LINES} lines`;
}

function tableLinesOf(title: string, groups: readonly NamedGroup[]): string[] {
  const widths = groups.map((group) => Math.max(GROUP_COLUMN_MINIMUM_WIDTH_CHARACTERS, group.name.length + GROUP_COLUMN_GAP_CHARACTERS));
  const rowOf  = (label: string, cells: readonly string[]): string => [
    OutputUtil.padColumn(label, FIGURE_COLUMN_WIDTH_CHARACTERS),
    ...cells.map((cell, i) => OutputUtil.padColumn(cell, widths[i] ?? GROUP_COLUMN_MINIMUM_WIDTH_CHARACTERS)),
  ].join('').trimEnd();
  return [
    title,
    rowOf('', groups.map((group) => group.name)),
    ...FIGURES.map(([label, cellOf]) => rowOf(label, groups.map((group) => cellOf(group.statistics)))),
  ];
}

function unrecordedLineOf(unrecordedTicketCount: number): string {
  const ticketWord = unrecordedTicketCount === 1 ? 'ticket has' : 'tickets have';
  return `${unrecordedTicketCount} ${ticketWord} no recorded review and ${unrecordedTicketCount === 1 ? 'is' : 'are'} left out.`;
}

export function noRecordedReviewsTextOf(report: ReviewStatisticsReport): string {
  return `No ticket has a recorded review yet, so there is nothing to report. ${unrecordedLineOf(report.unrecordedTicketCount)}`;
}

export function reviewStatsTextOf(report: ReviewStatisticsReport): string {
  return [
    ...tableLinesOf('All recorded tickets', [{ name: 'all', statistics: report.all }]),
    '',
    ...tableLinesOf('By ticket type', report.byType.map(({ type, statistics }) => ({ name: type, statistics }))),
    '',
    ...tableLinesOf('By builder change size', report.byChangeSize.map(({ changeSize, statistics }) => ({ name: changeSizeNameOf(changeSize), statistics }))),
    '',
    ...tableLinesOf('By builder model and effort', report.byBuilder.map(({ model, effort, statistics }) => ({ name: `${model}/${effort}`, statistics }))),
    '',
    unrecordedLineOf(report.unrecordedTicketCount),
  ].join('\n');
}
