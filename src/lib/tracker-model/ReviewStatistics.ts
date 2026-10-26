/**
 * What the recorded review passes add up to: each ticket with a `review-recorded` record joined to its own row's and review bars' tokens,
 * its type, its resolved agent pair, the bugs naming it in `introducedBy` and the tickets naming it in `foundInReview`, then summed over
 * every recorded ticket and split by ticket type, builder change size and builder pair. A ratio over nothing is null, never zero.
 */
import type { LogRecord }                                                from './@types/LogRecord.ts';
import type { ReviewFindingClass, ReviewFindingSeverity, ReviewVerdict } from './@types/ReviewRecord.ts';
import type {
  AgentEffort,
  AgentModel,
  Ticket,
  TicketType
} from './@types/Ticket.ts';
import type { BoardRecords }                                                  from './BoardRecords.ts';
import type { ReviewBars }                                                    from './ReviewBars.ts';
import { CHANGE_SIZE_BUCKET_MAXIMUM_CHANGED_LINES, CHANGE_SIZE_BUCKETS }      from './constants/ChangeSizeBuckets.ts';
import { REVIEW_FINDING_CLASSES, REVIEW_FINDING_SEVERITIES, REVIEW_VERDICTS } from './constants/ReviewRecordVocabulary.ts';
import { TicketDefaultsUtil }                                                 from './utils/TicketDefaultsUtil.ts';

export type ChangeSizeBucket = typeof CHANGE_SIZE_BUCKETS[number];

type ReviewRecordedEntry = Extract<LogRecord, { kind: 'review-recorded' }>;

/** Delivered tickets whose last review pass did or did not have a serious finding, and the bugs filed against them. */
export interface EscapedBugCounts {
  deliveredTicketCount:          number;
  escapedBugCount:               number;
  escapedBugsPerDeliveredTicket: number | null;
}

export interface ReviewStatisticsGroup {
  ticketCount:                   number;
  reviewPassCount:               number;
  roundsPerTicket:               number;
  verdictCounts:                 Record<ReviewVerdict, number>;
  findingCountByClass:           Record<ReviewFindingClass, number>;
  findingCountBySeverity:        Record<ReviewFindingSeverity, number>;
  seriousFindingCount:           number;
  seriousFindingsPerTicket:      number;
  reviewTokens:                  number;
  reviewTokensPerTicket:         number;
  builderTokens:                 number;
  builderTokensPerTicket:        number;
  reviewTokensPerSeriousFinding: number | null;
  afterSeriousLastReview:        EscapedBugCounts;
  afterCleanLastReview:          EscapedBugCounts;
  ticketsFiledFromReviewsCount:  number;
  claimCount:                    number;
  handoffContradictedClaimCount: number;
  handoffContradictedShare:      number | null;
  fixLines:                      number;
  fixLinesPerTicket:             number;
  rebaseLines:                   number;
  rebaseLinesPerTicket:          number;
}

export interface ReviewStatisticsReport {
  recordedTicketCount:   number;
  unrecordedTicketCount: number;
  all:                   ReviewStatisticsGroup;
  byType:                Array<{ type: TicketType; statistics: ReviewStatisticsGroup }>;
  byChangeSize:          Array<{ changeSize: ChangeSizeBucket; statistics: ReviewStatisticsGroup }>;
  byBuilder:             Array<{ model: AgentModel; effort: AgentEffort; statistics: ReviewStatisticsGroup }>;
}

/** One recorded ticket with everything joined; its change size is the builder's change its first recorded pass measured. */
interface RecordedTicket {
  ticket:                  Readonly<Ticket>;
  passes:                  readonly ReviewRecordedEntry[];
  changeSize:              ChangeSizeBucket;
  reviewTokens:            number;
  builderTokens:           number;
  escapedBugCount:         number;
  ticketsFiledFromReviews: number;
  lastReviewWasSerious:    boolean;
}

const SERIOUS_FINDING_SEVERITIES: readonly ReviewFindingSeverity[] = ['would-ship-a-bug', 'acceptance-fails'];

export class ReviewStatistics {
  constructor(
    private readonly records: BoardRecords,
    private readonly reviewBars: ReviewBars,
  ) {}

  /** Records naming a ticket the board does not hold are left out, as they belong to no ticket to report. */
  reviewStatisticsOf(logRecords: readonly LogRecord[]): ReviewStatisticsReport {
    const passesByTicketId = new Map<string, ReviewRecordedEntry[]>();
    for (const logRecord of logRecords) {
      if (logRecord.kind !== 'review-recorded') continue;
      const passes = passesByTicketId.get(logRecord.ticketId) ?? [];
      passes.push(logRecord);
      passesByTicketId.set(logRecord.ticketId, passes);
    }

    const recordedTickets = this.records.ticketRecords.flatMap((ticket) => {
      const passes = passesByTicketId.get(ticket.frontmatter.id);
      return passes === undefined ? [] : [this.recordedTicketOf(ticket, passes)];
    });

    const builderKeyOf = (recorded: RecordedTicket): string => `${builderModelOf(recorded)}/${builderEffortOf(recorded)}`;
    return {
      recordedTicketCount:   recordedTickets.length,
      unrecordedTicketCount: this.records.ticketRecords.length - recordedTickets.length,
      all:                   groupStatisticsOf(recordedTickets),
      byType:                groupsBy(recordedTickets, (recorded) => recorded.ticket.frontmatter.type)
        .map(([type, members]) => ({ type, statistics: groupStatisticsOf(members) })),
      byChangeSize: CHANGE_SIZE_BUCKETS
        .map((changeSize) => ({ changeSize, members: recordedTickets.filter((recorded) => recorded.changeSize === changeSize) }))
        .filter(({ members }) => members.length > 0)
        .map(({ changeSize, members }) => ({ changeSize, statistics: groupStatisticsOf(members) })),
      byBuilder: groupsBy(recordedTickets, builderKeyOf).map(([, members]) => {
        const [firstMember] = members;
        if (firstMember === undefined) throw new Error('A builder group is never empty.');
        return { model: builderModelOf(firstMember), effort: builderEffortOf(firstMember), statistics: groupStatisticsOf(members) };
      }),
    };
  }

  private recordedTicketOf(ticket: Readonly<Ticket>, passes: readonly ReviewRecordedEntry[]): RecordedTicket {
    const ticketId   = ticket.frontmatter.id;
    const firstPass  = passes[0];
    const lastPass   = passes.at(-1);
    const ownRow     = this.records.linkedTaskRecordOf(ticket) ?? this.records.progress.tasks.find((task) => task.ticket === ticketId);
    const changedLines = firstPass === undefined ? 0 : firstPass.fields.builderInsertions + firstPass.fields.builderDeletions;
    return {
      ticket,
      passes,
      changeSize:      changeSizeBucketOf(changedLines),
      reviewTokens:    sumOf(this.reviewBars.reviewBarRecordsOf(ticketId).map((reviewBar) => reviewBar.tokens ?? 0)),
      builderTokens:   ownRow?.tokens ?? 0,
      escapedBugCount: this.records.ticketRecords
        .filter((candidate) => candidate.frontmatter.type === 'bug' && candidate.frontmatter.introducedBy === ticketId).length,
      ticketsFiledFromReviews: this.records.ticketRecords.filter((candidate) => candidate.frontmatter.foundInReview === ticketId).length,
      lastReviewWasSerious:    lastPass !== undefined && seriousFindingCountOf(lastPass) > 0,
    };
  }
}

function changeSizeBucketOf(changedLines: number): ChangeSizeBucket {
  return CHANGE_SIZE_BUCKETS.find((bucket) => changedLines <= CHANGE_SIZE_BUCKET_MAXIMUM_CHANGED_LINES[bucket]) ?? 'oversized';
}

function builderModelOf(recorded: RecordedTicket): AgentModel {
  return TicketDefaultsUtil.agentModelOf(recorded.ticket.frontmatter);
}

function builderEffortOf(recorded: RecordedTicket): AgentEffort {
  return TicketDefaultsUtil.agentEffortOf(recorded.ticket.frontmatter);
}

/** Groups in the order their first member appears, which is the board's ticket order. */
function groupsBy<Key>(recordedTickets: readonly RecordedTicket[], keyOf: (recorded: RecordedTicket) => Key): Array<[Key, RecordedTicket[]]> {
  const groups = new Map<Key, RecordedTicket[]>();
  for (const recorded of recordedTickets) {
    const key = keyOf(recorded);
    groups.set(key, [...groups.get(key) ?? [], recorded]);
  }
  return [...groups.entries()];
}

function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function ratioOf(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function zeroCountsOf<Word extends string>(words: readonly Word[]): Record<Word, number> {
  return Object.fromEntries(words.map((word) => [word, 0])) as Record<Word, number>;
}

function seriousFindingCountOf(pass: ReviewRecordedEntry): number {
  return pass.fields.findings.filter((finding) => SERIOUS_FINDING_SEVERITIES.includes(finding.severity)).length;
}

function escapedBugCountsOf(deliveredTickets: readonly RecordedTicket[]): EscapedBugCounts {
  const escapedBugCount = sumOf(deliveredTickets.map((recorded) => recorded.escapedBugCount));
  return {
    deliveredTicketCount:          deliveredTickets.length,
    escapedBugCount,
    escapedBugsPerDeliveredTicket: ratioOf(escapedBugCount, deliveredTickets.length),
  };
}

function groupStatisticsOf(members: readonly RecordedTicket[]): ReviewStatisticsGroup {
  const passes                 = members.flatMap((recorded) => recorded.passes);
  const claims                 = passes.flatMap((pass) => pass.fields.claims);
  const findings               = passes.flatMap((pass) => pass.fields.findings);
  const verdictCounts          = zeroCountsOf(REVIEW_VERDICTS);
  const findingCountByClass    = zeroCountsOf(REVIEW_FINDING_CLASSES);
  const findingCountBySeverity = zeroCountsOf(REVIEW_FINDING_SEVERITIES);
  for (const pass of passes) verdictCounts[pass.fields.verdict]++;
  for (const finding of findings) {
    findingCountByClass[finding.class]++;
    findingCountBySeverity[finding.severity]++;
  }

  const ticketCount                   = members.length;
  const perTicket                     = (total: number): number => ratioOf(total, ticketCount) ?? 0;
  const roundCount                    = sumOf(members.map((recorded) => new Set(recorded.passes.map((pass) => pass.fields.round)).size));
  const seriousFindingCount           = sumOf(passes.map(seriousFindingCountOf));
  const reviewTokens                  = sumOf(members.map((recorded) => recorded.reviewTokens));
  const builderTokens                 = sumOf(members.map((recorded) => recorded.builderTokens));
  const handoffContradictedClaimCount = claims.filter((claim) => claim.handoffContradicted).length;
  const fixLines                      = sumOf(passes.map((pass) => pass.fields.fixReworkedCodeLines));
  const rebaseLines                   = sumOf(passes.map((pass) => pass.fields.rebaseReworkedCodeLines));
  const deliveredTickets              = members.filter((recorded) => recorded.ticket.frontmatter.status === 'delivered');
  return {
    ticketCount,
    reviewPassCount:               passes.length,
    roundsPerTicket:               perTicket(roundCount),
    verdictCounts,
    findingCountByClass,
    findingCountBySeverity,
    seriousFindingCount,
    seriousFindingsPerTicket:      perTicket(seriousFindingCount),
    reviewTokens,
    reviewTokensPerTicket:         perTicket(reviewTokens),
    builderTokens,
    builderTokensPerTicket:        perTicket(builderTokens),
    reviewTokensPerSeriousFinding: ratioOf(reviewTokens, seriousFindingCount),
    afterSeriousLastReview:        escapedBugCountsOf(deliveredTickets.filter((recorded) => recorded.lastReviewWasSerious)),
    afterCleanLastReview:          escapedBugCountsOf(deliveredTickets.filter((recorded) => !recorded.lastReviewWasSerious)),
    ticketsFiledFromReviewsCount:  sumOf(members.map((recorded) => recorded.ticketsFiledFromReviews)),
    claimCount:                    claims.length,
    handoffContradictedClaimCount,
    handoffContradictedShare:      ratioOf(handoffContradictedClaimCount, claims.length),
    fixLines,
    fixLinesPerTicket:             perTicket(fixLines),
    rebaseLines,
    rebaseLinesPerTicket:          perTicket(rebaseLines),
  };
}
