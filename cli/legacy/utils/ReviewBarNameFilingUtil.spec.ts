/**
 * The link `task add` stores for a review row filed by its name alone: the ticket padded and the round, a bundle's first ticket, and nothing
 * for a name that is not review-shaped, one naming no round, or one not written in the exact `Review` case the read-time linking matches.
 */
import { expect, test } from 'bun:test';

import { ReviewBarNameFilingUtil } from './ReviewBarNameFilingUtil';

const { reviewLinkNamedBy } = ReviewBarNameFilingUtil;

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
