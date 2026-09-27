/**
 * The link `task add` stores for a review row filed by its name alone: the ticket padded and the round, a bundle's first ticket, and nothing
 * for a name that is not review-shaped, one naming no round, or one not written in the exact `Review` case the read-time linking matches.
 * And what a rename does to a stored link: one equal to what the previous name gave follows the new name, relinked or dropped, while one
 * given otherwise, or held by a ticket's own row, is left alone.
 */
import { describe, expect, test } from 'bun:test';

import type { Task }               from '../../../src/lib/tracker-model/@types/Task.ts';
import { ReviewBarNameFilingUtil } from './ReviewBarNameFilingUtil.ts';

const { reviewLinkNamedBy, reviewLinkAfterRenaming } = ReviewBarNameFilingUtil;

type NamedRow = Pick<Task, 'name' | 'ticket' | 'reviewOf' | 'reviewBarRound'>;

const ROW_LINKED_BY_ITS_NAME: NamedRow = {
  name:           'Review 1 #001 — Example work',
  ticket:         null,
  reviewOf:       '001',
  reviewBarRound: 1,
};

test('a review-shaped name gives its ticket, padded, and its round', () => {
  expect(reviewLinkNamedBy('Review 2 #7 — x')).toEqual({ ticketId: '007', round: 2 });
});

test('a bundle gives its first ticket', () => {
  expect(reviewLinkNamedBy('Review 1 #13, #5 — the bundle')).toEqual({ ticketId: '013', round: 1 });
});

test('a plain name gives no link', () => {
  expect(reviewLinkNamedBy('Draft the example page')).toBeUndefined();
});

test('a name whose round is zero gives no link, leaving it to the read-time linking', () => {
  expect(reviewLinkNamedBy('Review 0 #7 — x')).toBeUndefined();
});

test('a lower-case review name gives no link', () => {
  expect(reviewLinkNamedBy('review 1 #7')).toBeUndefined();
});

describe('reviewLinkAfterRenaming', () => {
  test('a link the previous name gave is relinked to the ticket and round the new name gives', () => {
    expect(reviewLinkAfterRenaming(ROW_LINKED_BY_ITS_NAME, 'Review 2 #2 — Other work')).toEqual({ ticketId: '002', round: 2 });
  });

  test('a link the previous name gave is dropped when the new name gives none', () => {
    expect(reviewLinkAfterRenaming(ROW_LINKED_BY_ITS_NAME, 'Reviewer scratch notes')).toBeNull();
  });

  test('a link that differs from what the previous name gave was given otherwise and is left alone', () => {
    const linkedByOption: NamedRow = { ...ROW_LINKED_BY_ITS_NAME, reviewOf: '003' };
    expect(reviewLinkAfterRenaming(linkedByOption, 'Reviewer scratch notes')).toBeUndefined();
    expect(reviewLinkAfterRenaming({ ...ROW_LINKED_BY_ITS_NAME, reviewBarRound: 2 }, 'Reviewer scratch notes')).toBeUndefined();
  });

  test('a row whose previous name gave no link keeps whatever it has', () => {
    const plainRowLinkedByOption: NamedRow = {
      name: 'Example review', ticket: null, reviewOf: '001', reviewBarRound: 1 
    };
    expect(reviewLinkAfterRenaming(plainRowLinkedByOption, 'Review 1 #002 — Other work')).toBeUndefined();
  });

  test('a ticket\'s own row is left alone', () => {
    expect(reviewLinkAfterRenaming({ ...ROW_LINKED_BY_ITS_NAME, ticket: '004' }, 'Reviewer scratch notes')).toBeUndefined();
  });
});
