import type { DisplayState } from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageLimits }   from '../../src/shared/@types/PagePayload.ts';

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

/** What a group's span and stamps are shortened against. */
export interface GroupMarkupFormat {
  limits:               PageLimits;
  todayCalendarDate:    string;
  nowEpochMilliseconds: number;
}

/** One fact of a group's facts line; the value comes as its whole element, already escaped, so a stamp can carry its own title. */
export interface GroupFactModel {
  label:       string;
  valueMarkup: string;
}

export interface GroupItemBadge {
  stateToken: string;
  label:      string;
}

/** One line of a group's item list. */
export interface GroupItemRowModel {
  /** The item opener attribute's value, or `null` for a line that opens nothing. */
  opener:      string | null;
  leadText:    string;
  title:       string;
  /** The item's other groups, drawn as squares after its title. */
  otherGroups: readonly GroupMark[];
  badge:       GroupItemBadge | null;
  note:        string | null;
  /** Work on the item runs now; its line pulses while the page is live. */
  isLive:      boolean;
}

export interface GroupCardHeadModel {
  /** The title element, already escaped: a group's title button, or a plain title. */
  titleMarkup:   string;
  keyText:       string;
  doneText:      string;
  doneTitleText: string | null;
}

/** A group's card: its frame coloured by `slot`, its head and its body's parts in order, each already escaped. */
export interface GroupCardModel {
  slot:      number | null;
  ariaLabel: string;
  head:      GroupCardHeadModel;
  bodyParts: readonly string[];
  /** Work on one of its items runs now; its head's colour square pulses while the page is live. */
  isLive:    boolean;
}

/** A group's detail: its head, coloured by `slot`, and its body's parts in order, each already escaped. */
export interface GroupDetailModel {
  slot:      number;
  title:     string;
  typeTags:  readonly string[];
  bodyParts: readonly string[];
}
