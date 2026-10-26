/**
 * The three dependency rows of an Epics tab card: what the epic waits on outside itself, its tickets in the board's waves, and the epics
 * it frees. A ticket counts under its primary epic alone, as the dependency model's cross-epic links do. Every value passes `escapeHtml`
 * once.
 */

import { HtmlEscapeUtil }              from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { DependencyGraph }        from '../@types/DependencyGraph.ts';
import type { BoardEpic, BoardTicket } from '../@types/PageBoard.ts';
import { LiveStateUtil }               from '../utils/LiveStateUtil.ts';
import { MarkupUtil }                  from '../utils/MarkupUtil.ts';

const WAITS_ON_LABEL         = 'Waits on';
const FREES_LABEL            = 'Frees';
const NOTHING_WAITED_ON_TEXT = 'Nothing outside this epic';
const NO_EPIC_WAITS_TEXT     = 'No other epic waits on this one';
const NO_OWN_TICKETS_TEXT    = 'No tickets under this epic';
const DONE_COLUMN_LABEL      = 'Done';

const SWATCH_MARKUP = '<span class="ap-epic-swatch"></span>';

interface EpicWaveColumn {
  label:     string;
  isDone:    boolean;
  isNarrow:  boolean;
  ticketIds: readonly string[];
}

function byLowestId(a: string, b: string): number {
  return Number(a) - Number(b) || a.localeCompare(b);
}

function primaryEpicOf(ticketId: string, ticketById: ReadonlyMap<string, BoardTicket>): BoardEpic | null {
  return ticketById.get(ticketId)?.memberOfEpics[0] ?? null;
}

function linkRowMarkup(label: string, itemsMarkup: readonly string[], emptyText: string): string {
  const content = itemsMarkup.length === 0 ? `<span class="ap-epic-link-empty">${HtmlEscapeUtil.escapeHtml(emptyText)}</span>` : itemsMarkup.join('');
  return `<div class="ap-epic-link-row"><span class="ap-epic-link-label">${HtmlEscapeUtil.escapeHtml(label)}</span>${content}</div>`;
}

function waitsOnMarkup(epic: BoardEpic, graph: DependencyGraph, ticketById: ReadonlyMap<string, BoardTicket>): string {
  const dependencyTicketIds = [...new Set(graph.crossGroupLinks
    .filter((link) => link.dependentGroupKey === epic.key)
    .map((link) => link.dependencyNodeId))].sort(byLowestId);
  const chips = dependencyTicketIds.flatMap((ticketId) => {
    const ticket      = ticketById.get(ticketId);
    const primaryEpic = primaryEpicOf(ticketId, ticketById);
    if (ticket === undefined || primaryEpic === null) {
      return [];
    }
    return [`<button type="button" class="ap-epic-link-chip" ${MarkupUtil.attribute('data-open-ticket', ticketId)} `
      + `${MarkupUtil.attribute('data-epic-slot', String(primaryEpic.slot))} ${MarkupUtil.attribute('title', `#${ticketId} ${ticket.title}`)}>`
      + `${SWATCH_MARKUP}<span class="ap-ticket-id">#${HtmlEscapeUtil.escapeHtml(ticketId)}</span>`
      + `<span class="ap-epic-link-epic">${HtmlEscapeUtil.escapeHtml(primaryEpic.title)}</span></button>`];
  });
  return linkRowMarkup(WAITS_ON_LABEL, chips, NOTHING_WAITED_ON_TEXT);
}

/** One chip per waiting epic, in the order its first link appears; "via" names this epic's tickets that epic waits on. */
function freesMarkup(epic: BoardEpic, graph: DependencyGraph, ticketById: ReadonlyMap<string, BoardTicket>): string {
  const waitingEpicByKey = new Map<string, { waitingEpic: BoardEpic; viaTicketIds: Set<string> }>();
  for (const link of graph.crossGroupLinks) {
    const waitingEpic = primaryEpicOf(link.dependentNodeId, ticketById);
    if (link.dependencyGroupKey !== epic.key || waitingEpic === null) {
      continue;
    }
    const waiting = waitingEpicByKey.get(waitingEpic.key) ?? { waitingEpic, viaTicketIds: new Set<string>() };
    waiting.viaTicketIds.add(link.dependencyNodeId);
    waitingEpicByKey.set(waitingEpic.key, waiting);
  }
  const chips = [...waitingEpicByKey.values()].map(({ waitingEpic, viaTicketIds }) => {
    const viaText = `via ${[...viaTicketIds].sort(byLowestId).map((ticketId) => `#${ticketId}`).join(', ')}`;
    return `<button type="button" class="ap-epic-link-chip" data-frees ${MarkupUtil.attribute('data-open-epic', waitingEpic.key)} `
      + `${MarkupUtil.attribute('data-epic-slot', String(waitingEpic.slot))} ${MarkupUtil.attribute('title', `${waitingEpic.title} ${viaText}`)}>`
      + `${SWATCH_MARKUP}<span>${HtmlEscapeUtil.escapeHtml(waitingEpic.title)}</span>`
      + `<span class="ap-epic-link-via">${HtmlEscapeUtil.escapeHtml(viaText)}</span></button>`;
  });
  return linkRowMarkup(FREES_LABEL, chips, NO_EPIC_WAITS_TEXT);
}

/** Done first, then each global wave holding a ticket of this epic, narrow as the whole wave is narrow. */
function waveColumnsOf(epic: BoardEpic, graph: DependencyGraph, ticketById: ReadonlyMap<string, BoardTicket>): EpicWaveColumn[] {
  const ownTicketIds = (ticketIds: readonly string[]): string[] => ticketIds.filter((ticketId) => primaryEpicOf(ticketId, ticketById)?.key === epic.key);
  const doneColumn: EpicWaveColumn = {
    label: DONE_COLUMN_LABEL, isDone: true, isNarrow: false, ticketIds: ownTicketIds(graph.settledNodeIds)
  };
  const waveColumns = graph.waves.map((wave): EpicWaveColumn => ({
    label: wave.label, isDone: false, isNarrow: wave.isNarrow, ticketIds: ownTicketIds(wave.nodeIds)
  }));
  return [doneColumn, ...waveColumns].filter((column) => column.ticketIds.length > 0);
}

function wavePillMarkup(ticket: BoardTicket, column: EpicWaveColumn): string {
  return `<button type="button" class="ap-epic-wave-pill" ${MarkupUtil.attribute('data-open-ticket', ticket.id)} `
    + `${MarkupUtil.attribute('data-state', ticket.displayState)}${LiveStateUtil.liveAttributeOf(ticket.displayState)}`
    + `${column.isDone ? ' data-done' : ''}${column.isNarrow ? ' data-narrow' : ''} `
    + `${MarkupUtil.attribute('title', ticket.title)}><span class="ap-ticket-id">#${HtmlEscapeUtil.escapeHtml(ticket.id)}</span>`
    + `<span class="ap-epic-wave-title">${HtmlEscapeUtil.escapeHtml(ticket.title)}</span></button>`;
}

function wavesStripMarkup(epic: BoardEpic, graph: DependencyGraph, ticketById: ReadonlyMap<string, BoardTicket>): string {
  const columns = waveColumnsOf(epic, graph, ticketById).map((column) => (
    `<div class="ap-epic-wave"${column.isNarrow ? ' data-narrow' : ''}${column.isDone ? ' data-done' : ''}>`
    + `<span class="ap-epic-wave-name">${HtmlEscapeUtil.escapeHtml(column.label)}</span>`
    + `${column.ticketIds.flatMap((ticketId) => {
      const ticket = ticketById.get(ticketId);
      return ticket === undefined ? [] : [wavePillMarkup(ticket, column)];
    }).join('')}</div>`
  ));
  const content = columns.length === 0 ? `<span class="ap-epic-link-empty">${HtmlEscapeUtil.escapeHtml(NO_OWN_TICKETS_TEXT)}</span>` : columns.join('');
  return `<div class="ap-epic-waves">${content}</div>`;
}

function epicDependencyRowsMarkup(epic: BoardEpic, graph: DependencyGraph, ticketById: ReadonlyMap<string, BoardTicket>): string {
  return waitsOnMarkup(epic, graph, ticketById) + wavesStripMarkup(epic, graph, ticketById) + freesMarkup(epic, graph, ticketById);
}

export const EpicDependencyMarkup = { epicDependencyRowsMarkup } as const;
