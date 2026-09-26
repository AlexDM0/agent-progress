/**
 * The count names the next review bar's round, so what callers rely on is that only a `## Review` heading on a line of its own counts: a
 * body with none is round zero, trailing blanks after the heading still count, and a mention inside a sentence or a deeper heading does not.
 * The next round is that count plus one, the round both filing sites store on the bar.
 */
import { expect, test } from 'bun:test';

import { TicketBodyUtil } from './TicketBodyUtil';

const { reviewSectionCountOf, nextReviewRoundOf } = TicketBodyUtil;

test('a body with no review section counts none', () => {
  expect(reviewSectionCountOf('# Example checkout page\n\n## Report\n\nReported by Alex Example.\n')).toBe(0);
  expect(reviewSectionCountOf('')).toBe(0);
});

test('every review heading on a line of its own counts once, trailing blanks included', () => {
  const body = '# Example checkout page\n\n## Review\nRound 1 found two gaps.\n\n## Review  \nRound 2 passed.\n## Review\t\n';
  expect(reviewSectionCountOf(body)).toBe(3);
});

// A reviewer quoting the heading in prose, or nesting a subsection under it, has not written another round.
test('a heading mentioned in a sentence, a deeper heading and a longer title are not counted', () => {
  const body = 'Add a ## Review section when done.\n### Review\n## Reviewer notes\n## Review of the export\n';
  expect(reviewSectionCountOf(body)).toBe(0);
});

test('a ticket with no review section files its first bar as round 1', () => {
  expect(nextReviewRoundOf('# Example checkout page\n\n## Report\n\nReported by Alex Example.\n')).toBe(1);
});

test('a ticket with two review sections files its next bar as round 3', () => {
  expect(nextReviewRoundOf('# Example checkout page\n\n## Review\nRound 1 found a gap.\n\n## Review\nRound 2 passed.\n')).toBe(3);
});

test('an inline mention of the review heading does not advance the round', () => {
  expect(nextReviewRoundOf('# Example checkout page\n\nAdd a ## Review section when done.\n')).toBe(1);
});
