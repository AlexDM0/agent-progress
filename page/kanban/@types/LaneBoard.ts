import type { DisplayState }        from '../../../src/lib/tracker-model/@types/Task.ts';
import type { TicketPriority }      from '../../../src/lib/tracker-model/@types/Ticket.ts';
import type { TicketType }          from '../../../src/lib/tracker-model/@types/Ticket.ts';
import type { GroupMark }           from '../../@types/GroupMarks.ts';
import type { GroupMarkVocabulary } from '../../@types/GroupMarks.ts';
import type { WorkItemLink }        from '../../@types/WorkItemLink.ts';
import type { ShortenedTexts }      from '../../utils/WorkItemMarkupUtil.ts';

/** One figure of a lane head; `dotState` draws the state's dot before it, `reviewedMark` the ✓. */
export interface LaneSubtitleCount {
  count:        number;
  label:        string;
  dotState:     DisplayState | null;
  reviewedMark: boolean;
}

/** The words after a lane's count: a leading text and figures, or one free line. */
export type LaneSubtitle =
  | { kind: 'counts'; leading: string | null; counts: readonly LaneSubtitleCount[] }
  | { kind: 'text'; text: string };

export type LaneCardGroup =
  | { kind: 'plain'; cards: readonly LaneCardModel[] }
  | { kind: 'priority'; priority: TicketPriority; title: string; count: number; cards: readonly LaneCardModel[] }
  | { kind: 'state'; stateGroup: string; title: string; count: number; cards: readonly LaneCardModel[] }
  | { kind: 'wave'; index: number; isNarrow: boolean; label: string; note: string; cards: readonly LaneCardModel[] };

export type LaneBody =
  | { kind: 'empty'; text: string }
  | { kind: 'groups'; groups: readonly LaneCardGroup[] };

export interface LanePaging {
  shownCount:    number;
  laneCount:     number;
  /** How many cards the "more" button adds, 0 when none are left. */
  nextPageSize:  number;
  /** How many cards the reset button goes back to, or `null` while the lane shows only its first page. */
  firstPageSize: number | null;
}

export interface LaneFooter {
  paging:      LanePaging | null;
  /** The lane's cards the finished-work switch leaves out, with a way to show them all. */
  hiddenCount: number;
}

export interface LaneModel {
  key:            string;
  title:          string;
  dotState:       DisplayState;
  count:          number;
  subtitle:       LaneSubtitle;
  cardsElementId: string;
  /** A lane that folds away behind its head; `null` for one that is always open. */
  collapse:       { isCollapsed: boolean; toggleTitle: string } | null;
  body:           LaneBody;
  footer:         LaneFooter | null;
}

/** How many items wait on this one; a heavy count reads in full ink. */
export interface LaneCardHeldCount {
  count:   number;
  isHeavy: boolean;
  title:   string;
}

export interface LaneCardHead {
  idText:         string;
  priority:       TicketPriority;
  /** Null on a card that is not a ticket's, which shows no type mark. */
  ticketType:     TicketType | null;
  /** Markup after the type mark, already escaped by its producer. */
  slotMarkup:     string | null;
  /** Holds the "needed first" slot that hovering a dependent fades in. */
  hasNeededFirst: boolean;
  heldCount:      LaneCardHeldCount | null;
  tokenCount:     number | null;
}

export interface LaneCardMarks {
  waitingOn:  readonly WorkItemLink[];
  heldTitle:  string | null;
  noRowTitle: string | null;
}

export interface LaneCardGroupChips {
  groups:     readonly GroupMark[];
  vocabulary: GroupMarkVocabulary;
}

export interface LaneCardElapsedStamp {
  label:                  string;
  startEpochMilliseconds: number;
}

export interface LaneCardModel {
  elementId:     string;
  identity:      { attribute: string; value: string };
  /** Its `data-state`, which colours the stripe and dashes the border. */
  stateToken:    string;
  /** Without a stripe the card carries `data-row="none"`. */
  hasStripe:     boolean;
  ariaLabel:     string;
  head:          LaneCardHead;
  title:         string;
  chips:         LaneCardGroupChips | null;
  marks:         LaneCardMarks;
  note:          string | null;
  reviewedTitle: string | null;
  stamp:         ShortenedTexts | null;
  /** An agent is at work on it: the card pulses while the page is live. */
  isLive:        boolean;
  /** What the page's ticker re-measures the stamp from every second; `null` for a stamp that stands still. */
  elapsedStamp:  LaneCardElapsedStamp | null;
  /** A card that opens the detail panel takes the keyboard focus. */
  opensDetail:   boolean;
}
