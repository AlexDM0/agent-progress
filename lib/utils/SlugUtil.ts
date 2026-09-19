/** The tail of a ticket's file name; making a slug unique within a directory belongs to `lib/tickets/TicketStore.ts`. */

const SLUG_MAXIMUM_LENGTH = 60;

const EMPTY_TITLE_SLUG = 'ticket';

/** What an accented letter decomposes into under NFKD, removed so the base letter survives. */
const COMBINING_MARKS = /[̀-ͯ]/g;

const NON_SLUG_CHARACTERS = /[^a-z0-9]+/g;
const LEADING_OR_TRAILING_HYPHENS = /^-+|-+$/g;

/** Never returns an empty string: a title with no usable characters yields `ticket`, so no ticket is filed under the unreadable name `003-.md`. */
function slugFromTitle(title: string): string {
  const folded = title
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_SLUG_CHARACTERS, '-')
    .replace(LEADING_OR_TRAILING_HYPHENS, '');
  const truncated = folded.slice(0, SLUG_MAXIMUM_LENGTH).replace(LEADING_OR_TRAILING_HYPHENS, '');
  return truncated.length > 0 ? truncated : EMPTY_TITLE_SLUG;
}

export const SlugUtil = { slugFromTitle } as const;
