/**
 * The detail panel of one ticket as a model: its head, its facts, the phases its own row recorded, the log lines claimed for it by
 * `LogClaimUtil`, the controls its stored status offers and the sandboxed document its body is shown in. Every stamp is sliced and
 * shortened through `TimeUtil`, never re-parsed; each state is the Board's fact.
 */
import { HtmlEscapeUtil }            from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { DisplayState }         from '../../../src/lib/tracker-model/@types/Task.ts';
import type { TicketType }           from '../../../src/lib/tracker-model/@types/Ticket.ts';
import { FIRST_REPEAT_REVIEW_ROUND } from '../../../src/lib/tracker-model/constants/ReviewRounds.ts';
import type {
  TicketsBoardState,
  TicketsEpicDocument,
  TicketsLogEntry,
  TicketsTaskDocument,
  TicketsTicketDocument
} from '../../@types/TicketsBoardState.ts';
import { DisplayStateWordingUtil } from '../../utils/DisplayStateWordingUtil.ts';
import { LogClaimUtil }            from '../../utils/LogClaimUtil.ts';
import { TimeUtil }                from '../../utils/TimeUtil.ts';

const HELD_WITHOUT_REASON_TEXT = 'no reason given';

export const NO_LOG_LINES_TEXT = 'No log line names this ticket or its row.';

/** A stamp shown short against the viewer's day, in full on hover. */
export interface StampModel {
  readonly shortText: string;
  readonly fullText:  string;
}

export type DetailFactModel =
  | { readonly kind: 'text'; readonly label: string; readonly text: string }
  | { readonly kind: 'stamp'; readonly label: string; readonly stamp: StampModel }
  | { readonly kind: 'tickets'; readonly label: string; readonly ticketIds: readonly string[] }
  | { readonly kind: 'epics'; readonly label: string; readonly epics: readonly TicketsEpicDocument[] };

export interface PhaseLineModel {
  readonly stateToken: DisplayState;
  readonly label:      string;
  readonly stamp:      StampModel;
}

export interface LogLineModel {
  readonly key:   string;
  readonly stamp: StampModel;
  readonly text:  string;
}

/** What the panel offers; each is a `ControlCommand` the Overseer applies or refuses. */
export interface DetailControlsModel {
  /** A draft ticket: `ticket-ready`. */
  readonly readies:     boolean;
  /** An open ticket: `ticket-hold` while unheld and not yet started, `ticket-unhold` while held, `null` otherwise. */
  readonly holdMove:    'hold' | 'unhold' | null;
  /** Any open ticket: `ticket-park`. */
  readonly parks:       boolean;
  /** Only while `draft` or `pending`: `ticket-network`. */
  readonly setsNetwork: boolean;
  /** The domains stored now, which the network control starts from. */
  readonly network:     readonly string[];
}

export interface DetailPanelViewModel {
  readonly ticketId:           string;
  readonly idText:             string;
  readonly title:              string;
  readonly stateToken:         DisplayState;
  readonly stateLabel:         string;
  readonly priority:           'low' | 'high' | null;
  readonly ticketType:         Exclude<TicketType, 'ticket'> | null;
  readonly facts:              readonly DetailFactModel[];
  readonly phases:             readonly PhaseLineModel[];
  readonly logLines:           readonly LogLineModel[];
  readonly controls:           DetailControlsModel;
  /** The ticket's rendered body as a whole document, for the `srcdoc` of a sandboxed frame and nowhere else. */
  readonly bodySourceDocument: string;
}

interface StampFormat {
  readonly todayCalendarDate: string;
  readonly limits:            TicketsBoardState['page']['payload']['limits'];
}

function stampOf(stamp: string, format: StampFormat): StampModel {
  return { shortText: TimeUtil.shortStampText(stamp, format.todayCalendarDate, format.limits), fullText: TimeUtil.fullStampText(stamp, format.limits) };
}

function stampFactsOf(stamps: readonly (readonly [string, string | null | undefined])[], format: StampFormat): DetailFactModel[] {
  return stamps.flatMap(([label, stamp]): DetailFactModel[] => (typeof stamp === 'string' && stamp !== '' ? [{ kind: 'stamp', label, stamp: stampOf(stamp, format) }] : []));
}

function textFact(label: string, text: string | undefined): DetailFactModel[] {
  return text === undefined || text === '' ? [] : [{ kind: 'text', label, text }];
}

interface FactSources {
  readonly ownRow:    TicketsTaskDocument | null;
  readonly epics:     readonly TicketsEpicDocument[];
  readonly waitingOn: readonly string[];
  readonly format:    StampFormat;
}

function factsOf(ticket: TicketsTicketDocument, {
  ownRow, epics, waitingOn, format
}: FactSources): DetailFactModel[] {
  return [
    ...(epics.length === 0 ? [] : [{ kind: 'epics', label: 'epics', epics } as const]),
    ...stampFactsOf([
      ['filed', ticket.filed],
      ['started', ticket.started],
      ['finished', ticket.finished],
      ['reviewed', ownRow?.reviewed],
      ['done', ticket.delivered],
      ['abandoned', ticket.abandonedAt],
    ], format),
    ...textFact('reason', ticket.reason),
    ...(ticket.hold === undefined ? [] : textFact('held', ticket.hold === '' ? HELD_WITHOUT_REASON_TEXT : ticket.hold)),
    ...(waitingOn.length === 0 ? [] : [{ kind: 'tickets', label: 'waiting on', ticketIds: waitingOn } as const]),
    ...textFact('group', ticket.group),
    ...textFact('branch', ticket.branch),
    ...textFact('commit', ticket.commit),
    ...textFact('task', ticket.task === null ? undefined : `#${ticket.task}`),
    ...textFact('network', (ticket.network ?? []).join(', ')),
  ];
}

/**
 * A round is counted off the list rather than read from the row, because a row stays in `re-review` between rounds and carries only the
 * last; the count restarts at a `pending` phase, as a row sent back restarts its rounds.
 */
function phasesOf(ownRow: TicketsTaskDocument | null, format: StampFormat): PhaseLineModel[] {
  let repeatReviews = 0;
  return (ownRow?.history ?? []).map((phase) => {
    if (phase.status === 'pending') repeatReviews = 0;
    if (phase.status === 're-review') repeatReviews += 1;
    return {
      stateToken: phase.status,
      label:      DisplayStateWordingUtil.stateLabelOf(phase.status, FIRST_REPEAT_REVIEW_ROUND + Math.max(0, repeatReviews - 1)),
      stamp:      stampOf(phase.at, format),
    };
  });
}

function logLinesOf(log: readonly TicketsLogEntry[], taskId: number | null, ticketId: string, format: StampFormat): LogLineModel[] {
  // Sorting by stamp is a stated clock exception that decides only the display order, because `--at` backfills.
  // Within one second the later append is the newer line.
  return log
    .map((entry, appendIndex) => ({ entry, appendIndex }))
    .filter(({ entry }) => LogClaimUtil.entryIsAbout(entry, taskId, ticketId))
    .sort((a, b) => b.entry.at.localeCompare(a.entry.at) || b.appendIndex - a.appendIndex)
    .map(({ entry, appendIndex }) => ({ key: String(appendIndex), stamp: stampOf(entry.at, format), text: entry.text }));
}

function controlsOf(ticket: TicketsTicketDocument): DetailControlsModel {
  const isOpen = ticket.status !== 'delivered' && ticket.status !== 'abandoned';
  const notYetStarted = ticket.status === 'draft' || ticket.status === 'pending';
  let holdMove: DetailControlsModel['holdMove'] = null;
  if (isOpen && ticket.hold !== undefined) holdMove = 'unhold';
  else if (notYetStarted) holdMove = 'hold';
  return {
    readies:     ticket.status === 'draft',
    holdMove,
    parks:       isOpen,
    setsNetwork: notYetStarted,
    network:     ticket.network ?? [],
  };
}

/** Fixed markup around the body: links open outside the frame, and the title is the one value escaped by hand, since it lands in markup. */
function bodySourceDocumentOf(title: string, bodyHtml: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<title>${HtmlEscapeUtil.escapeHtml(title)}</title>`,
    '<base target="_blank">',
    `</head><body>${bodyHtml}</body></html>`,
  ].join('');
}

/** `null` when the board holds no ticket of that id. */
function detailPanelModelOf(state: TicketsBoardState, ticketId: string, todayCalendarDate: string): DetailPanelViewModel | null {
  const ticket = state.page.tickets.find((candidate) => candidate.id === ticketId);
  if (ticket === undefined) return null;
  const { boardFacts, progress, limits } = state.page.payload;
  const facts = boardFacts.tickets.find((candidate) => candidate.ticketId === ticketId);
  const ownRow = facts?.ownRowPosition === null || facts?.ownRowPosition === undefined ? null : progress.tasks[facts.ownRowPosition] ?? null;
  const epics = (ticket.epics ?? []).flatMap((key) => boardFacts.epics.filter((epic) => epic.key === key));
  const format: StampFormat = { todayCalendarDate, limits };
  const displayState = facts?.displayState ?? ticket.status;
  const priority = ticket.priority ?? 'normal';
  return {
    ticketId:   ticket.id,
    idText:     `#${ticket.id}`,
    title:      ticket.title,
    stateToken: displayState,
    stateLabel: DisplayStateWordingUtil.stateLabelOf(displayState, ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND),
    priority:   priority === 'normal' ? null : priority,
    ticketType: ticket.type === 'ticket' ? null : ticket.type,
    facts:      factsOf(ticket, {
      ownRow, epics, waitingOn: facts?.waitingOnTicketIds ?? [], format
    }),
    phases:             phasesOf(ownRow, format),
    logLines:           logLinesOf(progress.log, ownRow?.id ?? ticket.task, ticket.id, format),
    controls:           controlsOf(ticket),
    bodySourceDocument: bodySourceDocumentOf(ticket.title, ticket.bodyHtml),
  };
}

/** The domains a viewer typed, split at commas and white space. */
function networkDomainsOf(typedText: string): string[] {
  return typedText.split(/[\s,]+/).filter((domain) => domain !== '');
}

export const DetailPanelModel = Object.freeze({ detailPanelModelOf, bodySourceDocumentOf, networkDomainsOf });
