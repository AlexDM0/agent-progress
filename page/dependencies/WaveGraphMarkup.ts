/**
 * The waves graph both pages draw, shaped by the `#ap-dependencies` markup of `resources/template.html`: a Done column, then one column per
 * wave, every column, node and edge placed in pixels on one canvas. A page maps its work into `DependencyNodeModel`s and words the graph
 * through `DependencyGraphOptions`. Every value passes `escapeHtml` once.
 */

import { HtmlEscapeUtil }                from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { DisplayState }             from '../../src/lib/tracker-model/@types/Task.ts';
import type { DependencyGraph }          from '../@types/DependencyGraph.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE } from '../constants/StateLabels.ts';
import { MarkupUtil }                    from '../utils/MarkupUtil.ts';

const NODE_WIDTH_PIXELS          = 192;
const NODE_HEIGHT_PIXELS         = 80;
const NODE_GAP_PIXELS            = 12;
const COLUMN_GAP_PIXELS          = 40;
const CANVAS_PADDING_PIXELS      = 10;
const COLUMN_HEAD_HEIGHT_PIXELS  = 56;
/** A head that also carries a wave's forecast line. */
const FORECAST_HEAD_HEIGHT_PIXELS = 72;
const BAND_OUTSET_PIXELS         = 8;
/** The node's left and right padding together with its stripe, which the weight bar stays inside. */
const WEIGHT_BAR_INSET_PIXELS    = 26;
const MINIMUM_EDGE_BEND_PIXELS   = 24;
/** From this many waiting nodes on, a node's "N wait" is set in the ink colour. */
const HEAVY_WAIT_COUNT           = 5;

const DONE_COLUMN_LABEL = 'Done';
const READY_CHIP_LABEL  = 'Ready';
const HELD_CHIP_LABEL   = 'Held';

/** A chip in a node's head; the renderer owns its markup. A held chip's reason may be empty. */
export type DependencyNodeChip =
  | { kind: 'ready' }
  | { kind: 'held'; reason: string }
  | { kind: 'state'; displayState: DisplayState };

export interface DependencyNodeModel {
  id:         string;
  /** The node's lead text and the start of its accessible name. */
  idLabel:    string;
  title:      string;
  dependsOn:  readonly string[];
  /** The node's `data-state`, which colours its stripe. */
  tone:       DisplayState;
  isInReview: boolean;
  /** An agent works on it now; the node pulses while the page is live. */
  isLive:     boolean;
  /** Drawn only on a node outside the Done column. */
  chips:      readonly DependencyNodeChip[];
}

export interface DependencyGraphOptions {
  /** Each wave's head carries a slot meter and the legend a slot line. */
  showsSlots:          boolean;
  /** The Done column's count, from its node ids. */
  doneCountTextOf:     (doneNodeIds: readonly string[]) => string;
  /** The attribute naming the node's id, which a click opens and the lineage reads. */
  openAttribute:       string;
  emptyText:           string;
  /** Markup already escaped, drawn after the node's chips. */
  extraChipMarkupOf?:  (nodeId: string) => string;
  /** A wave head's forecast line from its node ids, or null for none; the Done column never asks. */
  waveForecastTextOf?: (waveNodeIds: readonly string[]) => string | null;
}

interface DependencyColumn {
  label:    string;
  isDone:   boolean;
  isNarrow: boolean;
  nodeIds:  readonly string[];
}

interface NodePlace {
  columnIndex: number;
  left:        number;
  top:         number;
}

function pixels(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

function columnLeftOf(columnIndex: number): number {
  return CANVAS_PADDING_PIXELS + columnIndex * (NODE_WIDTH_PIXELS + COLUMN_GAP_PIXELS);
}

function nodeTopOf(rowIndex: number, headHeight: number): number {
  return headHeight + rowIndex * (NODE_HEIGHT_PIXELS + NODE_GAP_PIXELS);
}

/** The settled nodes an open node depends on directly, lowest id first as the graph lists them. */
function builtOnNodeIdsOf(graph: DependencyGraph, nodeById: ReadonlyMap<string, DependencyNodeModel>): string[] {
  const builtOn = new Set(graph.openNodeIds.flatMap((nodeId) => nodeById.get(nodeId)?.dependsOn ?? []));
  return graph.settledNodeIds.filter((nodeId) => builtOn.has(nodeId));
}

/**
 * The pace-path node first, then by the mean row of its parents already placed, which keeps edges from crossing, then most held first.
 * A node with no placed parent goes after those with one.
 */
function columnsInRowOrder(graph: DependencyGraph, nodeById: ReadonlyMap<string, DependencyNodeModel>): DependencyColumn[] {
  const rowIndexOfNode = new Map<string, number>();
  const doneNodeIds    = builtOnNodeIdsOf(graph, nodeById);
  doneNodeIds.forEach((nodeId, rowIndex) => rowIndexOfNode.set(nodeId, rowIndex));

  const parentRowMeanOf = (nodeId: string): number => {
    const parentRows = (nodeById.get(nodeId)?.dependsOn ?? []).flatMap((dependencyId) => rowIndexOfNode.get(dependencyId) ?? []);
    return parentRows.length === 0 ? Number.POSITIVE_INFINITY : parentRows.reduce((sum, row) => sum + row, 0) / parentRows.length;
  };
  const heldCountOf  = (nodeId: string): number => graph.heldOfNode.get(nodeId)?.size ?? 0;
  const isOnPacePath = (nodeId: string): number => Number(graph.pacePathNodeIds.includes(nodeId));
  const byParentRows = (a: string, b: string): number => {
    const meanA = parentRowMeanOf(a);
    const meanB = parentRowMeanOf(b);
    return meanA === meanB ? 0 : meanA - meanB;
  };

  const waveColumns = graph.waves.map((wave): DependencyColumn => {
    const nodeIds = wave.nodeIds.toSorted((a, b) => isOnPacePath(b) - isOnPacePath(a) || byParentRows(a, b) || heldCountOf(b) - heldCountOf(a));
    nodeIds.forEach((nodeId, rowIndex) => rowIndexOfNode.set(nodeId, rowIndex));
    return {
      label: wave.label, isDone: false, isNarrow: wave.isNarrow, nodeIds
    };
  });
  const doneColumns: DependencyColumn[] = doneNodeIds.length === 0 ? [] : [{
    label: DONE_COLUMN_LABEL, isDone: true, isNarrow: false, nodeIds: doneNodeIds
  }];
  return [...doneColumns, ...waveColumns];
}

function narrowAttribute(column: DependencyColumn): string {
  return column.isNarrow ? ' data-narrow' : '';
}

function slotMeterMarkup(nodeCount: number, boardSlots: number): string {
  const slots = Array.from({ length: boardSlots }, (_slot, i) => `<span class="ap-dependency-slot"${i < nodeCount ? ' data-filled' : ''}></span>`);
  const label = `${Math.min(nodeCount, boardSlots)} of ${boardSlots} slots in use`;
  return `<span class="ap-dependency-slots" role="img" ${MarkupUtil.attribute('aria-label', label)}>${slots.join('')}</span>`;
}

function forecastTextOf(column: DependencyColumn, options: DependencyGraphOptions): string | null {
  return column.isDone ? null : options.waveForecastTextOf?.(column.nodeIds) ?? null;
}

function columnHeadMarkup(column: DependencyColumn, columnIndex: number, graph: DependencyGraph, options: DependencyGraphOptions): string {
  const countText    = column.isDone
    ? options.doneCountTextOf(column.nodeIds)
    : column.isNarrow ? 'one at a time' : `${column.nodeIds.length} side by side`;
  const style        = `left:${pixels(columnLeftOf(columnIndex))};width:${pixels(NODE_WIDTH_PIXELS)}`;
  const slotMeter    = column.isDone || !options.showsSlots ? '' : slotMeterMarkup(column.nodeIds.length, graph.boardSlots);
  const forecastText = forecastTextOf(column, options);
  const forecastLine = forecastText === null ? '' : `<span class="ap-dependency-head-count">${HtmlEscapeUtil.escapeHtml(forecastText)}</span>`;
  return `<div class="ap-dependency-head"${narrowAttribute(column)}${column.isDone ? ' data-done' : ''} style="${style}">`
    + `<span class="ap-dependency-head-name">${HtmlEscapeUtil.escapeHtml(column.label)}</span>`
    + `<span class="ap-dependency-head-count">${HtmlEscapeUtil.escapeHtml(countText)}</span>`
    + `${forecastLine}${slotMeter}</div>`;
}

function columnBandMarkup(column: DependencyColumn, columnIndex: number, headHeight: number): string {
  const nodesHeight = column.nodeIds.length * (NODE_HEIGHT_PIXELS + NODE_GAP_PIXELS) - NODE_GAP_PIXELS;
  const style       = `left:${pixels(columnLeftOf(columnIndex) - BAND_OUTSET_PIXELS)};top:${pixels(headHeight - BAND_OUTSET_PIXELS)};`
    + `width:${pixels(NODE_WIDTH_PIXELS + BAND_OUTSET_PIXELS * 2)};height:${pixels(nodesHeight + BAND_OUTSET_PIXELS * 2)}`;
  return `<div class="ap-dependency-band"${narrowAttribute(column)}${column.isDone ? ' data-done' : ''} style="${style}"></div>`;
}

/** A held chip wears the Kanban's held mark. */
function chipMarkup(chip: DependencyNodeChip): string {
  switch (chip.kind) {
    case 'ready':
      return `<span class="ap-badge" data-ready>${READY_CHIP_LABEL}</span>`;
    case 'held': {
      const title = chip.reason === '' ? HELD_CHIP_LABEL : `${HELD_CHIP_LABEL}: ${chip.reason}`;
      return `<span class="ap-kanban-held" ${MarkupUtil.attribute('title', title)}>${HELD_CHIP_LABEL}</span>`;
    }
    case 'state': {
      const label = STATE_LABEL_FOR_DISPLAY_STATE[chip.displayState];
      return `<span class="ap-badge" ${MarkupUtil.attribute('data-state', chip.displayState)}>${HtmlEscapeUtil.escapeHtml(label)}</span>`;
    }
  }
}

function waitMarkup(heldCount: number): string {
  if (heldCount === 0) {
    return '';
  }
  return `<span class="ap-dependency-wait"${heldCount >= HEAVY_WAIT_COUNT ? ' data-heavy' : ''}>${heldCount} wait</span>`;
}

interface NodeContext {
  graph:            DependencyGraph;
  options:          DependencyGraphOptions;
  largestHeldCount: number;
}

function nodeMarkup(node: DependencyNodeModel, place: NodePlace, isDone: boolean, { graph, options, largestHeldCount }: NodeContext): string {
  const heldCount   = isDone ? 0 : graph.heldOfNode.get(node.id)?.size ?? 0;
  const weightWidth = largestHeldCount === 0 ? 0 : (NODE_WIDTH_PIXELS - WEIGHT_BAR_INSET_PIXELS) * heldCount / largestHeldCount;
  const chips       = isDone ? '' : node.chips.map(chipMarkup).join('');
  const extraChip   = options.extraChipMarkupOf?.(node.id) ?? '';
  return `<button type="button" class="ap-dependency-node" ${MarkupUtil.attribute(options.openAttribute, node.id)} `
    + `${MarkupUtil.attribute('data-state', node.tone)}${isDone ? ' data-done' : ''}${node.isInReview ? ' data-in-review' : ''}${node.isLive ? ' data-live' : ''} `
    + `${MarkupUtil.attribute('aria-label', `${node.idLabel} ${node.title}`)} style="left:${pixels(place.left)};top:${pixels(place.top)}">`
    + `<span class="ap-dependency-node-head"><span class="ap-ticket-id">${HtmlEscapeUtil.escapeHtml(node.idLabel)}</span>`
    + `${chips}${extraChip}${waitMarkup(heldCount)}</span>`
    + `<span class="ap-dependency-node-title">${HtmlEscapeUtil.escapeHtml(node.title)}</span>`
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
  return new Set(graph.pacePathNodeIds.slice(1).map((nodeId, i) => `${graph.pacePathNodeIds[i] ?? ''}>${nodeId}`));
}

function edgesMarkup(
  graph: DependencyGraph,
  nodeById: ReadonlyMap<string, DependencyNodeModel>,
  placeOfNode: ReadonlyMap<string, NodePlace>,
  width: number,
  height: number
): string {
  const settled   = new Set(graph.settledNodeIds);
  const paceEdges = pacePathEdgeKeysOf(graph);
  const paths     = [...placeOfNode.entries()].flatMap(([dependentId, dependentPlace]) => (
    [...new Set(nodeById.get(dependentId)?.dependsOn ?? [])].flatMap((dependencyId) => {
      const dependencyPlace = placeOfNode.get(dependencyId);
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

function legendMarkup(graph: DependencyGraph, options: DependencyGraphOptions): string {
  const slotLine = options.showsSlots
    ? `<li><span class="ap-dependency-slot" data-filled></span>${HtmlEscapeUtil.escapeHtml(`slot in use (of ${graph.boardSlots})`)}</li>`
    : '';
  return '<ul class="ap-dependency-legend">'
    + '<li><span class="ap-dependency-legend-line" data-pace></span>sets the pace</li>'
    + '<li><span class="ap-dependency-legend-line"></span>waits on</li>'
    + '<li><span class="ap-dependency-legend-line" data-settled></span>built on (done)</li>'
    + `${slotLine}</ul>`;
}

/** The whole card's content: the canvas and its legend, or the options' line saying nothing open waits on anything. */
export function waveGraphMarkup(graph: DependencyGraph, nodeById: ReadonlyMap<string, DependencyNodeModel>, options: DependencyGraphOptions): string {
  const columns = columnsInRowOrder(graph, nodeById);
  if (columns.length === 0) {
    return `<p class="ap-dependency-empty">${HtmlEscapeUtil.escapeHtml(options.emptyText)}</p>`;
  }
  const headHeight       = columns.some((column) => forecastTextOf(column, options) !== null) ? FORECAST_HEAD_HEIGHT_PIXELS : COLUMN_HEAD_HEIGHT_PIXELS;
  const largestHeldCount = graph.openNodeIds.reduce((largest, nodeId) => Math.max(largest, graph.heldOfNode.get(nodeId)?.size ?? 0), 0);
  const placeOfNode      = new Map<string, NodePlace>();
  const nodes: string[]  = [];
  columns.forEach((column, columnIndex) => {
    column.nodeIds.forEach((nodeId, rowIndex) => {
      const node = nodeById.get(nodeId);
      if (node === undefined) {
        return;
      }
      const place = { columnIndex, left: columnLeftOf(columnIndex), top: nodeTopOf(rowIndex, headHeight) };
      placeOfNode.set(nodeId, place);
      nodes.push(nodeMarkup(node, place, column.isDone, { graph, options, largestHeldCount }));
    });
  });
  const tallestColumnLength = Math.max(...columns.map((column) => column.nodeIds.length));
  const width  = columns.length * NODE_WIDTH_PIXELS + (columns.length - 1) * COLUMN_GAP_PIXELS + CANVAS_PADDING_PIXELS * 2;
  const height = nodeTopOf(tallestColumnLength, headHeight) - NODE_GAP_PIXELS + CANVAS_PADDING_PIXELS;
  return `<div class="ap-dependency-canvas" style="width:${pixels(width)};height:${pixels(height)}">`
    + columns.map((column, columnIndex) => columnBandMarkup(column, columnIndex, headHeight)).join('')
    + edgesMarkup(graph, nodeById, placeOfNode, width, height)
    + columns.map((column, columnIndex) => columnHeadMarkup(column, columnIndex, graph, options)).join('')
    + nodes.join('')
    + `</div>${legendMarkup(graph, options)}`;
}
