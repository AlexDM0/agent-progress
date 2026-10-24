/** The Progress chart's rows grouped under a head row per group, the shape both pages hand the chart: epics on one, specs on the other. */

import type { ResolvedSpan } from '../@types/Timeline.ts';

/** A head row's span on the axis, from its first start to its last end, or to now while `end` is null. */
export interface ChartGroupSpan {
  start: string;
  end:   string | null;
  /** Leads the span's title: `<label> · <start> → <end>`. */
  label: string;
}

/** What one head row draws. */
export interface ChartGroupModel {
  /** The fold key and the head row's `data-epic-key`. */
  key:               string;
  slot:              number;
  chipMarkup:        string;
  /** Null when the group never started, which draws no span. */
  span:              ChartGroupSpan | null;
  /** Marks the span open. */
  isOpen:            boolean;
  doneText:          string;
  /** Members drawn under another group; the head names them as shared when there are any. */
  sharedMemberCount: number;
}

/** The head of the rows whose group key is null, drawn after every group. */
export interface UngroupedHead {
  key:   string;
  label: string;
}

/** Everything about a grouping that holds across layouts. */
export interface RowGroupingSource<Row> {
  /** In the order the groups are drawn. */
  groups:        readonly ChartGroupModel[];
  /** A null key puts the row under `ungroupedHead`. */
  groupKeyOfRow(row: Row): string | null;
  /** Null when no row can be ungrouped. */
  ungroupedHead: UngroupedHead | null;
}

export interface RowGrouping<Row> extends RowGroupingSource<Row> {
  /** Group keys, and the ungrouped head's key, whose rows are folded away under their head. */
  foldedGroupKeys:         ReadonlySet<string>;
  axis:                    ResolvedSpan;
  nowEpochMilliseconds:    number;
  minimumSpanWidthPercent: number;
}
