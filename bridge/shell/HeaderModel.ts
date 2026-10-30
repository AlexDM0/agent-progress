/**
 * The header's model, pure: the Overseer's state and which of Pause, Resume and Restart it offers, the new-code notice, concurrency,
 * usage, the header statistics, the open notices and the warnings (owner answer Q34): every incident default, a failed Baton pass with its
 * step and error, and an Assistant that cannot come up. Warnings are derived from the notices and the Overseer's facts, never stored.
 */
import { PRODUCT_NAMES } from '../../src/shared/constants/ProductNames.ts';
import type {
  BoardStateDocument,
  NoticeDocument,
  OverseerFactsDocument,
  UsageDocument
} from '../@types/BoardStateDocument.ts';

export type PauseControl = 'pause' | 'resume' | null;

export interface HeaderStatistic {
  readonly figure: string;
  readonly label:  string;
}

export interface HeaderModel {
  readonly stateToken:       OverseerFactsDocument['state'] | 'connecting';
  readonly stateText:        string;
  readonly pauseControl:     PauseControl;
  /** Only with new code on disk, and never during a Baton pass: Restart is the checked pass by hand, never automatic. */
  readonly restartOffered:   boolean;
  readonly stopOffered:      boolean;
  readonly newCodeNotice:    string | null;
  readonly concurrencyLimit: number | null;
  readonly usageText:        string;
  readonly statistics:       readonly HeaderStatistic[];
  readonly notices:          readonly string[];
  readonly warnings:         readonly string[];
}

const STATE_TEXT: Readonly<Record<OverseerFactsDocument['state'], string>> = {
  'serving':                'serving',
  'held-by-install-change': 'held for an install change',
  'passing-baton':          'handing over',
  'down':                   'down',
};

const DEFAULT_CAUSE_TEXT: Readonly<Record<string, string>> = {
  'turn-closed':  'its delivery turn closed',
  'turn-budget':  'the turn budget ran out',
  'no-assistant': 'no Assistant was up',
};

const NO_ASSISTANT_CAUSE = 'no-assistant';

const INCIDENT_DEFAULTED = 'incident-defaulted';

const NEW_CODE = 'new-code';

const CALENDAR_DATE_LENGTH = 10;

const CLOCK_SLICE = { start: 11, end: 16 } as const;

const TOKENS_PER_THOUSAND = 1000;

function factOf(notice: NoticeDocument, fact: string): string {
  const value = notice[fact];
  if (Array.isArray(value)) return value.map(String).join(', ');
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function noticeTextOf(notice: NoticeDocument): string {
  switch (notice.kind) {
    case 'install-version-changed':
      return `the install version changed, so launches are held: run \`${PRODUCT_NAMES.PROGRAM} update\``;
    case 'claude-md-block-committed':
      return `launches onto ${factOf(notice, 'target')} wait: commit the CLAUDE.md change \`update\` made`;
    case 'attribution-found':
      return `ticket #${factOf(notice, 'ticketId')} carries an AI attribution`;
    case 'rounds-not-converging':
      return `ticket #${factOf(notice, 'ticketId')}'s review rounds are not converging`;
    case 'dirty-main-checkout':
      return factOf(notice, 'blockingFiles') === ''
        ? `landings on ${factOf(notice, 'target')} wait: the main checkout is not on ${factOf(notice, 'target')}`
        : `landings on ${factOf(notice, 'target')} wait: the main checkout's changes to ${factOf(notice, 'blockingFiles')} block the fast-forward`;
    case 'cleanup-declined':
      return `git declined the ${factOf(notice, 'cleanup')} cleanup of ${factOf(notice, 'groupBranch')}: ${factOf(notice, 'reason')}`;
    default:
      return notice.kind;
  }
}

function warningsOf(notices: readonly NoticeDocument[], overseer: OverseerFactsDocument | null): string[] {
  const defaulted = notices.filter((notice) => notice.kind === INCIDENT_DEFAULTED);
  const batonPass = overseer?.batonPassWarning ?? null;
  return [
    ...defaulted.map((notice) => {
      const cause = factOf(notice, 'cause');
      return `incident ${factOf(notice, 'incidentId')} took its default, ${factOf(notice, 'move')}: ${DEFAULT_CAUSE_TEXT[cause] ?? cause}`;
    }),
    ...(batonPass === null ? [] : [`the Baton pass to code ${batonPass.successorCodeVersion} failed at ${batonPass.step}: ${batonPass.error}`]),
    ...(defaulted.some((notice) => notice['cause'] === NO_ASSISTANT_CAUSE) ? ['no Assistant can come up: open incidents take their defaults'] : []),
  ];
}

function usageTextOf(usage: unknown): string {
  const facts = usage as Partial<UsageDocument> | null;
  if (typeof facts?.resetsAt !== 'string') return 'usage under its limit';
  const window = typeof facts.window === 'string' ? `${facts.window} ` : '';
  return `${window}usage limit hit, resets ${facts.resetsAt.slice(CLOCK_SLICE.start, CLOCK_SLICE.end)}`;
}

function tokenCountText(tokens: number): string {
  return tokens < TOKENS_PER_THOUSAND ? String(tokens) : `${Math.round(tokens / TOKENS_PER_THOUSAND)}k`;
}

/** Agents against the limit, done today, tokens today, waiting in queue, open questions and incidents; today is the viewer's local date. */
function statisticsOf(state: BoardStateDocument, todayCalendarDate: string): HeaderStatistic[] {
  const tasks = state.page?.payload.progress.tasks ?? [];
  const tickets = state.page?.tickets ?? [];
  const isToday = (stamp: string | null): boolean => stamp !== null && stamp.slice(0, CALENDAR_DATE_LENGTH) === todayCalendarDate;
  const running = tasks.filter((task) => task.status === 'in-progress' && task.end === null);
  const tokensToday = tasks.filter((task) => running.includes(task) || isToday(task.end)).reduce((total, task) => total + (task.tokens ?? 0), 0);
  const agentsFigure = state.concurrency === undefined ? String(running.length) : `${state.concurrency.agentsInFlight} / ${state.concurrency.limit}`;
  return [
    { figure: agentsFigure, label: 'agents working' },
    { figure: String(tickets.filter((ticket) => isToday(ticket.delivered)).length), label: 'done today' },
    { figure: tokenCountText(tokensToday), label: 'tokens today' },
    { figure: String(tickets.filter((ticket) => ticket.status === 'pending').length), label: 'waiting in queue' },
    { figure: String(state.decisions.length), label: 'open questions' },
    { figure: String(state.incidents.length), label: 'open incidents' },
  ];
}

function calendarDateOf(moment: Date): string {
  const twoDigits = (value: number): string => String(value).padStart(2, '0');
  return `${moment.getFullYear()}-${twoDigits(moment.getMonth() + 1)}-${twoDigits(moment.getDate())}`;
}

function headerModelOf(state: BoardStateDocument | null, now: Date): HeaderModel {
  const overseer = state?.overseer ?? null;
  const notices = state?.notices ?? [];
  const handingOver = overseer?.state === 'passing-baton';
  const newCodeOnDisk = notices.some((notice) => notice.kind === NEW_CODE);
  const answers = overseer !== null && overseer.state !== 'down' && !handingOver;
  return {
    stateToken:       overseer?.state ?? 'connecting',
    stateText:        overseer === null ? 'Overseer connecting' : `Overseer ${STATE_TEXT[overseer.state]}${overseer.paused ? ', paused' : ''}`,
    pauseControl:     answers ? (overseer.paused ? 'resume' : 'pause') : null,
    restartOffered:   answers && newCodeOnDisk,
    stopOffered:      answers,
    newCodeNotice:    newCodeOnDisk ? `new code: run \`${PRODUCT_NAMES.PROGRAM} update\`` : null,
    concurrencyLimit: state?.concurrency?.limit ?? null,
    usageText:        usageTextOf(state?.usage ?? null),
    statistics:       state === null ? [] : statisticsOf(state, calendarDateOf(now)),
    notices:          notices.filter((notice) => notice.kind !== INCIDENT_DEFAULTED && notice.kind !== NEW_CODE).map(noticeTextOf),
    warnings:         warningsOf(notices, overseer),
  };
}

export const HeaderModelUtil = Object.freeze({ headerModelOf, calendarDateOf });
