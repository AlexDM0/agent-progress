/**
 * The Epics view's model, the static page's epic marks (`page/epics/EpicGroupMarks.ts`) read from the Board facts: each shown epic's done
 * text, roll-up segments, facts and ticket lines, open epics first. Its description stays the rendered string, which only the sandboxed
 * frame shows.
 */
import type { EpicRollupDocument, PageDocument }      from '../../@types/BoardStateDocument.ts';
import { FinishedWorkModel, type FinishedWorkChoice } from '../finished-work/FinishedWorkModel.ts';

/** The roll-up bar's segments, settled work first. */
const ROLLUP_STATUS_ORDER = ['delivered', 'reviewed', 'in-review', 'in-progress', 'pending', 'abandoned'] as const;

const LIVE_DISPLAY_STATES: readonly string[] = ['in-progress', 'reviewing'];

const TOKENS_PER_THOUSAND = 1000;

export interface EpicSegment {
  readonly state: string;
  readonly count: number;
}

export interface EpicTicketLine {
  readonly ticketId:     string;
  readonly title:        string;
  readonly displayState: string;
  readonly isLive:       boolean;
}

export interface EpicCard {
  readonly key:             string;
  readonly title:           string;
  readonly slot:            number;
  /** "3 of 5 done" while open, "all settled" or "no tickets" once nothing is open. */
  readonly doneText:        string;
  readonly segments:        readonly EpicSegment[];
  readonly facts:           readonly { readonly label: string; readonly value: string }[];
  readonly descriptionHtml: string;
  readonly tickets:         readonly EpicTicketLine[];
  readonly isLive:          boolean;
}

export interface EpicsModelResult {
  readonly cards:     readonly EpicCard[];
  /** The one line shown when the finished-work choice hid every epic; `null` while any shows. */
  readonly emptyText: string | null;
}

function countOf(epic: EpicRollupDocument, status: string): number {
  return Object.hasOwn(epic.ticketCountByStatus, status) ? epic.ticketCountByStatus[status] ?? 0 : 0;
}

function openTicketCountOf(epic: EpicRollupDocument): number {
  return epic.ticketIds.length - countOf(epic, 'delivered') - countOf(epic, 'abandoned');
}

function doneTextOf(epic: EpicRollupDocument): string {
  if (epic.ticketIds.length === 0) return 'no tickets';
  if (openTicketCountOf(epic) === 0) return 'all settled';
  return `${countOf(epic, 'delivered')} of ${epic.ticketIds.length} done`;
}

function tokenCountText(tokens: number): string {
  return tokens < TOKENS_PER_THOUSAND ? String(tokens) : `${Math.round(tokens / TOKENS_PER_THOUSAND)}k`;
}

function factsOf(epic: EpicRollupDocument): EpicCard['facts'] {
  const abandonedCount = countOf(epic, 'abandoned');
  return [
    { label: 'open', value: String(openTicketCountOf(epic)) },
    { label: 'done', value: String(countOf(epic, 'delivered')) },
    ...(abandonedCount > 0 ? [{ label: 'abandoned', value: String(abandonedCount) }] : []),
    { label: 'tokens', value: tokenCountText(epic.tokens) },
    { label: 'span', value: epic.span === null ? 'not started' : `${epic.span.start} → ${epic.span.end ?? 'now'}` },
  ];
}

function cardOf(epic: EpicRollupDocument, page: PageDocument): EpicCard {
  const titleById = new Map(page.tickets.map((ticket) => [ticket.id, ticket.title]));
  const displayStateById = new Map(page.payload.boardFacts.tickets.map((facts) => [facts.ticketId, facts.displayState]));
  const tickets = epic.ticketIds
    .filter((ticketId) => titleById.has(ticketId))
    .toSorted((a, b) => Number(b) - Number(a))
    .map((ticketId) => {
      const displayState = displayStateById.get(ticketId) ?? 'pending';
      return {
        ticketId, title: titleById.get(ticketId) ?? '', displayState, isLive: LIVE_DISPLAY_STATES.includes(displayState)
      };
    });
  return {
    key:             epic.key,
    title:           epic.title,
    slot:            epic.slot,
    doneText:        doneTextOf(epic),
    segments:        ROLLUP_STATUS_ORDER.filter((status) => countOf(epic, status) > 0).map((status) => ({ state: status, count: countOf(epic, status) })),
    facts:           factsOf(epic),
    descriptionHtml: page.payload.epicDescriptions.find((description) => description.key === epic.key)?.descriptionHtml ?? '',
    tickets,
    isLive:          tickets.some((ticket) => ticket.isLive),
  };
}

/** Open epics first, then the settled ones, each part in the Board's key order. */
function epicsModelOf(page: PageDocument, choice: FinishedWorkChoice, nowEpochMilliseconds: number): EpicsModelResult {
  const cutoff = FinishedWorkModel.cutoffEpochMillisecondsOf(choice, nowEpochMilliseconds);
  const shown = FinishedWorkModel.shownEpicsOf(page.payload.boardFacts.epics, page.tickets, cutoff)
    .toSorted((a, b) => Number(openTicketCountOf(a) === 0) - Number(openTicketCountOf(b) === 0));
  return {
    cards:     shown.map((epic) => cardOf(epic, page)),
    emptyText: shown.length === 0 ? `No epic finished ${FinishedWorkModel.windowPhraseOf(choice)}.` : null,
  };
}

export const EpicsModel = Object.freeze({ epicsModelOf, doneTextOf, openTicketCountOf });
