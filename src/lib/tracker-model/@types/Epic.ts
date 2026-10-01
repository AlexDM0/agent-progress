import type { LineEnding, TicketStatus } from './Ticket.ts';

/** An epic has no lifecycle of its own: everything about its progress is derived from the tickets naming it. */
export interface EpicFrontmatter {
  key:   string;
  title: string;
  /** The epic's colour, from 1 to `EPIC_COLOUR_SLOT_COUNT`, assigned once when it is added. */
  slot:  number;
  /** Every frontmatter line the model does not own, in original order, so a rewrite does not eat it. */
  extra: Array<[key: string, rawValue: string]>;
}

export interface Epic {
  frontmatter: EpicFrontmatter;
  body:        string;
  filePath:    string;
  /** The frontmatter's line ending as read, which a rewrite keeps; absent for an epic not read from a file, which is written with `\n`. */
  lineEnding?: LineEnding;
}

export interface EpicAddition {
  key:      string;
  title:    string;
  body:     string;
  filePath: string;
}

export interface EpicEdit {
  title?: string;
  body?:  { text: string; appends: boolean };
}

/** From the earliest start to the latest end of the rows counted; `end` is null while one of them that started has not ended. */
export interface EpicSpan {
  start: string;
  end:   string | null;
}

export interface EpicRollup {
  key:                 string;
  title:               string;
  slot:                number;
  /** Every ticket naming the epic, in ticket id order, whichever place the epic has in its list. */
  ticketIds:           string[];
  ticketCountByStatus: Record<TicketStatus, number>;
  /** Each ticket's own row plus its review rows; a row nobody reported a figure for counts nothing. */
  tokens:              number;
  /** Null while none of those rows has started. */
  span:                EpicSpan | null;
}
