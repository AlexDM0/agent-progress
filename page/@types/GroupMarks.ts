import type { DisplayState } from '../../src/lib/tracker-model/@types/Task.ts';

/** Anything a work item can be grouped under and coloured by: an epic on the tracker page. */
export interface GroupMark {
  key:   string;
  title: string;
  slot:  number;
}

/** The words and hook attributes one page's group marks carry, so a controller reads them from the same place the markup writes them. */
export interface GroupMarkVocabulary {
  /** Leads a chip's title: `<noun>: <title>`. */
  noun:                 string;
  /** On a group chip; its value is the group key and a click opens the group. */
  chipOpenerAttribute:  string;
  /** On a group's title button or link; its value is the group key and a click opens the group. */
  titleOpenerAttribute: string;
  /** On a line of a group's item list; its value is the item id and a click opens the item. */
  itemOpenerAttribute:  string;
  /** On a filter chip; its value is the group key, or the no-group chip's key. */
  filterChipAttribute:  string;
  /** The filter chip of the items in no group, or `null` where there is none. */
  noGroupChip:          { key: string; label: string } | null;
}

export interface GroupRollupSegment {
  state: DisplayState;
  count: number;
}

/** A group's roll-up bar: its segments in drawing order, only those with a count. */
export interface GroupRollupModel {
  segments:  readonly GroupRollupSegment[];
  ariaLabel: string;
}
