/**
 * The Dependencies tab's waves graph, shaped by the `#ap-dependencies` markup of `resources/template.html`: a Done column, then one column
 * per wave, every column, node and edge placed in pixels on one canvas. Every value passes `escapeHtml` once.
 */

import { HtmlEscapeUtil }                from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { DependencyGraph }          from '../@types/DependencyGraph.ts';
import type { BoardTicket }              from '../@types/PageBoard.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE } from '../constants/StateLabels.ts';
import { MarkupUtil }                    from '../utils/MarkupUtil.ts';

const NODE_WIDTH_PIXELS          = 192;
const NODE_HEIGHT_PIXELS         = 80;
const NODE_GAP_PIXELS            = 12;
const COLUMN_GAP_PIXELS          = 40;
const CANVAS_PADDING_PIXELS      = 10;
const COLUMN_HEAD_HEIGHT_PIXELS  = 56;
const BAND_OUTSET_PIXELS         = 8;
/** The node's left and right padding together with its stripe, which the weight bar stays inside. */
const WEIGHT_BAR_INSET_PIXELS    = 26;
const MINIMUM_EDGE_BEND_PIXELS   = 24;
/** From this many waiting tickets on, a node's "N wait" is set in the ink colour. */
const HEAVY_WAIT_COUNT           = 5;

const DONE_COLUMN_LABEL = 'Done';
const READY_CHIP_LABEL  = 'Ready';
const HELD_CHIP_LABEL   = 'Held';

interface DependencyColumn {
  label:     string;
  isDone:    boolean;
  isNarrow:  boolean;
  ticketIds: readonly string[];
}

interface NodePlace {
  columnIndex: number;
  left:        number;
  top:         number;
}

function pixels(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

function boardHasDependencies(tickets: readonly BoardTicket[]): boolean {
  return tickets.some((ticket) => (ticket.dependsOn ?? []).length > 0);
}

function columnLeftOf(columnIndex: number): number {
  return CANVAS_PADDING_PIXELS + columnIndex * (NODE_WIDTH_PIXELS + COLUMN_GAP_PIXELS);
}

function nodeTopOf(rowIndex: number): number {
  return COLUMN_HEAD_HEIGHT_PIXELS + rowIndex * (NODE_HEIGHT_PIXELS + NODE_GAP_PIXELS);
}

/** The settled tickets an open ticket depends on directly, lowest id first as the graph lists them. */
function builtOnTicketIdsOf(graph: DependencyGraph, ticketById: ReadonlyMap<string, BoardTicket>): string[] {
  const builtOn = new Set(graph.openTicketIds.flatMap((ticketId) => ticketById.get(ticketId)?.dependsOn ?? []));
  return graph.settledTicketIds.filter((ticketId) => builtOn.has(ticketId));
}

/**
 * The pace-path ticket first, then by the mean row of its parents already placed, which keeps edges from crossing, then most held first.
 * A ticket with no placed parent goes after those with one.
 */
function columnsInRowOrder(graph: DependencyGraph, ticketById: ReadonlyMap<string, BoardTicket>): DependencyColumn[] {
  const rowIndexOfTicket = new Map<string, number>();
  const doneTicketIds    = builtOnTicketIdsOf(graph, ticketById);
  doneTicketIds.forEach((ticketId, rowIndex) => rowIndexOfTicket.set(ticketId, rowIndex));

  const parentRowMeanOf = (ticketId: string): number => {
    const parentRows = (ticketById.get(ticketId)?.dependsOn ?? []).flatMap((dependencyId) => rowIndexOfTicket.get(dependencyId) ?? []);
    return parentRows.length === 0 ? Number.POSITIVE_INFINITY : parentRows.reduce((sum, row) => sum + row, 0) / parentRows.length;
  };
  const heldCountOf    = (ticketId: string): number => graph.heldOfTicket.get(ticketId)?.size ?? 0;
  const isOnPacePath   = (ticketId: string): number => Number(graph.pacePathTicketIds.includes(ticketId));
  const byParentRows   = (a: string, b: string): number => {
    const meanA = parentRowMeanOf(a);
    const meanB = parentRowMeanOf(b);
    return meanA === meanB ? 0 : meanA - meanB;
  };

  const waveColumns = graph.waves.map((wave): DependencyColumn => {
    const ticketIds = wave.ticketIds.toSorted((a, b) => isOnPacePath(b) - isOnPacePath(a) || byParentRows(a, b) || heldCountOf(b) - heldCountOf(a));
    ticketIds.forEach((ticketId, rowIndex) => rowIndexOfTicket.set(ticketId, rowIndex));
    return {
      label: wave.label, isDone: false, isNarrow: wave.isNarrow, ticketIds
    };
  });
  const doneColumns: DependencyColumn[] = doneTicketIds.length === 0 ? [] : [{
    label: DONE_COLUMN_LABEL, isDone: true, isNarrow: false, ticketIds: doneTicketIds
  }];
  return [...doneColumns, ...waveColumns];
}

function narrowAttribute(column: DependencyColumn): string {
  return column.isNarrow ? ' data-narrow' : '';
}

function doneCountTextOf(column: DependencyColumn, ticketById: ReadonlyMap<string, BoardTicket>): string {
  const deliveredCount = column.ticketIds.filter((ticketId) => ticketById.get(ticketId)?.status === 'delivered').length;
  const reviewedCount  = column.ticketIds.length - deliveredCount;
  return reviewedCount === 0 ? `${deliveredCount} delivered` : `${deliveredCount} delivered · ${reviewedCount} awaiting merge`;
}

function slotMeterMarkup(ticketCount: number, boardSlots: number): string {
  const slots = Array.from({ length: boardSlots }, (_, i) => `<span class="ap-dependency-slot"${i < ticketCount ? ' data-filled' : ''}></span>`);
  const label = `${Math.min(ticketCount, boardSlots)} of ${boardSlots} slots in use`;
  return `<span class="ap-dependency-slots" role="img" ${MarkupUtil.attribute('aria-label', label)}>${slots.join('')}</span>`;
}

function columnHeadMarkup(column: DependencyColumn, columnIndex: number, graph: DependencyGraph, ticketById: ReadonlyMap<string, BoardTicket>): string {
  const countText = column.isDone
    ? doneCountTextOf(column, ticketById)
    : column.isNarrow ? 'one at a time' : `${column.ticketIds.length} side by side`;
  const style = `left:${pixels(columnLeftOf(columnIndex))};width:${pixels(NODE_WIDTH_PIXELS)}`;
  return `<div class="ap-dependency-head"${narrowAttribute(column)}${column.isDone ? ' data-done' : ''} style="${style}">`
    + `<span class="ap-dependency-head-name">${HtmlEscapeUtil.escapeHtml(column.label)}</span>`
    + `<span class="ap-dependency-head-count">${HtmlEscapeUtil.escapeHtml(countText)}</span>`
    + `${column.isDone ? '' : slotMeterMarkup(column.ticketIds.length, graph.boardSlots)}</div>`;
}

function columnBandMarkup(column: DependencyColumn, columnIndex: number): string {
  const nodesHeight = column.ticketIds.length * (NODE_HEIGHT_PIXELS + NODE_GAP_PIXELS) - NODE_GAP_PIXELS;
  const style       = `left:${pixels(columnLeftOf(columnIndex) - BAND_OUTSET_PIXELS)};top:${pixels(COLUMN_HEAD_HEIGHT_PIXELS - BAND_OUTSET_PIXELS)};`
    + `width:${pixels(NODE_WIDTH_PIXELS + BAND_OUTSET_PIXELS * 2)};height:${pixels(nodesHeight + BAND_OUTSET_PIXELS * 2)}`;
  return `<div class="ap-dependency-band"${narrowAttribute(column)}${column.isDone ? ' data-done' : ''} style="${style}"></div>`;
}

/** Ready only as the Board lists it; a held pending ticket wears the Kanban's held mark instead, and a low one nothing. */
function statusChipMarkup(ticket: BoardTicket, readyTicketIds: ReadonlySet<string>): string {
  if (readyTicketIds.has(ticket.id)) {
    return `<span class="ap-badge" data-ready>${READY_CHIP_LABEL}</span>`;
  }
  if (ticket.status === 'pending' && ticket.hold !== undefined) {
    const title = ticket.hold === '' ? HELD_CHIP_LABEL : `${HELD_CHIP_LABEL}: ${ticket.hold}`;
    return `<span class="ap-kanban-held" ${MarkupUtil.attribute('title', title)}>${HELD_CHIP_LABEL}</span>`;
  }
  if (ticket.status !== 'in-progress' && ticket.status !== 'in-review') {
    return '';
  }
  const label = STATE_LABEL_FOR_DISPLAY_STATE[ticket.displayState];
  return `<span class="ap-badge" ${MarkupUtil.attribute('data-state', ticket.displayState)}>${HtmlEscapeUtil.escapeHtml(label)}</span>`;
}

function waitMarkup(heldCount: number): string {
  if (heldCount === 0) {
    return '';
  }
  return `<span class="ap-dependency-wait"${heldCount >= HEAVY_WAIT_COUNT ? ' data-heavy' : ''}>${heldCount} wait</span>`;
}

interface NodeContext {
  graph:            DependencyGraph;
  readyTicketIds:   ReadonlySet<string>;
  largestHeldCount: number;
}

function nodeMarkup(ticket: BoardTicket, place: NodePlace, isDone: boolean, { graph, readyTicketIds, largestHeldCount }: NodeContext): string {
  const heldCount   = isDone ? 0 : graph.heldOfTicket.get(ticket.id)?.size ?? 0;
  const weightWidth = largestHeldCount === 0 ? 0 : (NODE_WIDTH_PIXELS - WEIGHT_BAR_INSET_PIXELS) * heldCount / largestHeldCount;
  return `<button type="button" class="ap-dependency-node" ${MarkupUtil.attribute('data-open-ticket', ticket.id)} `
    + `${MarkupUtil.attribute('data-state', ticket.displayState)}${isDone ? ' data-done' : ''}${ticket.status === 'in-review' ? ' data-in-review' : ''} `
    + `${MarkupUtil.attribute('aria-label', `#${ticket.id} ${ticket.title}`)} style="left:${pixels(place.left)};top:${pixels(place.top)}">`
    + `<span class="ap-dependency-node-head"><span class="ap-ticket-id">#${HtmlEscapeUtil.escapeHtml(ticket.id)}</span>`
    + `${isDone ? '' : statusChipMarkup(ticket, readyTicketIds)}${waitMarkup(heldCount)}</span>`
    + `<span class="ap-dependency-node-title">${HtmlEscapeUtil.escapeHtml(ticket.title)}</span>`
    + `${weightWidth > 0 ? `<span class="ap-dependency-weight" style="width:${pixels(weightWidth)}"></span>` : ''}</button>`;
}

/** A horizontal cubic from the dependency's right middle to the dependent's left middle. */
function edgePathOf(from: NodePlace, to: NodePlace): string {
  const startX = from.left + NODE_WIDTH_PIXELS;
  const startY = from.top + NODE_HEIGHT_PIXELS / 2;
  const endX   = to.left;
  const endY   = to.top + NODE_HEIGHT_PIXELS / 2;
  const bend   = Math.max(MINIMUM_EDGE_BEND_PIXELS, (endX - startX) / 2);
  return `M${startX} ${startY} C${startX + bend} ${startY} ${endX - bend} ${endY} ${endX} ${endY}`;
}

function pacePathEdgeKeysOf(graph: DependencyGraph): Set<string> {
  return new Set(graph.pacePathTicketIds.slice(1).map((ticketId, i) => `${graph.pacePathTicketIds[i] ?? ''}>${ticketId}`));
}

function edgesMarkup(
  graph: DependencyGraph,
  ticketById: ReadonlyMap<string, BoardTicket>,
  placeOfTicket: ReadonlyMap<string, NodePlace>,
  width: number,
  height: number
): string {
  const settled   = new Set(graph.settledTicketIds);
  const paceEdges = pacePathEdgeKeysOf(graph);
  const paths     = [...placeOfTicket.entries()].flatMap(([dependentId, dependentPlace]) => (
    [...new Set(ticketById.get(dependentId)?.dependsOn ?? [])].flatMap((dependencyId) => {
      const dependencyPlace = placeOfTicket.get(dependencyId);
      if (dependencyPlace === undefined || dependencyPlace.columnIndex >= dependentPlace.columnIndex) {
        return [];
      }
      const pace = paceEdges.has(`${dependencyId}>${dependentId}`) ? ' data-pace' : '';
      const dash = settled.has(dependencyId) ? ' data-settled' : '';
      return [`<path class="ap-dependency-edge" ${MarkupUtil.attribute('data-from', dependencyId)} ${MarkupUtil.attribute('data-to', dependentId)}${pace}${dash} `
        + `d="${edgePathOf(dependencyPlace, dependentPlace)}"></path>`];
    })
  ));
  return `<svg class="ap-dependency-edges" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${paths.join('')}</svg>`;
}

function legendMarkup(boardSlots: number): string {
  return '<ul class="ap-dependency-legend">'
    + '<li><span class="ap-dependency-legend-line" data-pace></span>sets the pace</li>'
    + '<li><span class="ap-dependency-legend-line"></span>waits on</li>'
    + '<li><span class="ap-dependency-legend-line" data-settled></span>built on (done)</li>'
    + `<li><span class="ap-dependency-slot" data-filled></span>${HtmlEscapeUtil.escapeHtml(`slot in use (of ${boardSlots})`)}</li>`
    + '</ul>';
}

/** The whole card's content: the canvas and its legend, or a line saying nothing open waits on anything. */
function dependencyGraphMarkup(graph: DependencyGraph, ticketById: ReadonlyMap<string, BoardTicket>, readyTicketIds: ReadonlySet<string>): string {
  const columns = columnsInRowOrder(graph, ticketById);
  if (columns.length === 0) {
    return '<p class="ap-dependency-empty">No open ticket waits on another.</p>';
  }
  const largestHeldCount = graph.openTicketIds.reduce((largest, ticketId) => Math.max(largest, graph.heldOfTicket.get(ticketId)?.size ?? 0), 0);
  const placeOfTicket    = new Map<string, NodePlace>();
  const nodes: string[]  = [];
  columns.forEach((column, columnIndex) => {
    column.ticketIds.forEach((ticketId, rowIndex) => {
      const ticket = ticketById.get(ticketId);
      if (ticket === undefined) {
        return;
      }
      const place = { columnIndex, left: columnLeftOf(columnIndex), top: nodeTopOf(rowIndex) };
      placeOfTicket.set(ticketId, place);
      nodes.push(nodeMarkup(ticket, place, column.isDone, { graph, readyTicketIds, largestHeldCount }));
    });
  });
  const tallestColumnLength = Math.max(...columns.map((column) => column.ticketIds.length));
  const width  = columns.length * NODE_WIDTH_PIXELS + (columns.length - 1) * COLUMN_GAP_PIXELS + CANVAS_PADDING_PIXELS * 2;
  const height = nodeTopOf(tallestColumnLength) - NODE_GAP_PIXELS + CANVAS_PADDING_PIXELS;
  return `<div class="ap-dependency-canvas" style="width:${pixels(width)};height:${pixels(height)}">`
    + columns.map((column, columnIndex) => columnBandMarkup(column, columnIndex)).join('')
    + edgesMarkup(graph, ticketById, placeOfTicket, width, height)
    + columns.map((column, columnIndex) => columnHeadMarkup(column, columnIndex, graph, ticketById)).join('')
    + nodes.join('')
    + `</div>${legendMarkup(graph.boardSlots)}`;
}

export const DependencyMarkup = { boardHasDependencies, dependencyGraphMarkup } as const;
