/**
 * The ingestion step that links a review bar known only by its name. What readers rely on: only a free-standing row whose name starts
 * `Review <N> #<id>` gains fields, a stored field always wins over the name, a stored `reviewOf` the page read as a whole number is
 * padded, a name naming no ticket links nothing, and a row that gains nothing comes back with exactly the keys it had, so a
 * rewrite leaves it byte-identical. The names are the page's nesting cases.
 */
import { describe, expect, test } from 'bun:test';

import { taskFixture }         from '../../testing/BoardFixtures';
import { LegacyReviewBarUtil } from './LegacyReviewBarUtil';

const { linkedReviewBarOf } = LegacyReviewBarUtil;

describe('a free-standing row known only by its name', () => {
  test('takes the ticket and the round its name gives, the ticket padded', () => {
    expect(linkedReviewBarOf(taskFixture({ name: 'Review 1 #3 — x' }))).toMatchObject({ reviewOf: '003', reviewBarRound: 1 });
  });

  test('a bundle reviews its first ticket', () => {
    expect(linkedReviewBarOf(taskFixture({ name: 'Review 1 #13, #5 — the bundle' }))).toMatchObject({ reviewOf: '013', reviewBarRound: 1 });
  });

  // A round of 0 is no round, but the ticket is still named, so the bar is linked without one.
  test('a round of zero links the ticket and stores no round', () => {
    const linked = linkedReviewBarOf(taskFixture({ name: 'Review 0 #3' }));

    expect(linked.reviewOf).toBe('003');
    expect('reviewBarRound' in linked).toBe(false);
  });

  test('a round too large to be a whole number links the ticket and stores no round', () => {
    const linked = linkedReviewBarOf(taskFixture({ name: `Review ${'9'.repeat(20)} #3 — x` }));

    expect(linked.reviewOf).toBe('003');
    expect('reviewBarRound' in linked).toBe(false);
  });

  // Ticket ids start at 001, so `#0` names no ticket and its round has nothing to belong to.
  test('a name naming ticket zero comes back unchanged', () => {
    const task = taskFixture({ name: 'Review 1 #0' });

    expect(linkedReviewBarOf(task)).toStrictEqual(task);
  });

  // Keys are appended, so the rows a rewrite does not touch keep their bytes and a linked row only grows at the end.
  test('keeps the keys it had in their order and appends the new ones', () => {
    const task = taskFixture({ name: 'Review 1 #3 — x' });

    expect(Object.keys(linkedReviewBarOf(task))).toEqual([...Object.keys(task), 'reviewOf', 'reviewBarRound']);
  });
});

describe('a row with a stored field', () => {
  test('keeps its stored ticket and gains the round its name gives', () => {
    expect(linkedReviewBarOf(taskFixture({ name: 'Review 2 #3 — x', reviewOf: '003' }))).toMatchObject({ reviewOf: '003', reviewBarRound: 2 });
  });

  // The stored field is what `--review-of` said; the name's round is still read, as the page reads it.
  test('keeps a stored ticket the name disagrees with and still gains the name\'s round', () => {
    expect(linkedReviewBarOf(taskFixture({ name: 'Review 1 #3 — x', reviewOf: '004' }))).toMatchObject({ reviewOf: '004', reviewBarRound: 1 });
  });

  test('with both fields stored comes back unchanged', () => {
    const task = taskFixture({ name: 'Review 1 #3 — x', reviewOf: '004', reviewBarRound: 2 });

    expect(linkedReviewBarOf(task)).toStrictEqual(task);
  });

  // The page reads a stored reviewOf as a number, so an unpadded one must still name its ticket to the Board.
  test('pads a stored reviewOf the page reads as a number, so "3" reads as "003"', () => {
    expect(linkedReviewBarOf(taskFixture({ name: 'Example review', reviewOf: '3' })).reviewOf).toBe('003');
    for (const storedReviewOf of ['+5', '5.0', '5.', '5e0', '0x5', '0b101', '0o5', ' 5 ', '0005']) {
      expect(linkedReviewBarOf(taskFixture({ name: 'Example review', reviewOf: storedReviewOf })).reviewOf).toBe('005');
    }
  });

  test('leaves a stored reviewOf the page does not read as a number standing', () => {
    expect(linkedReviewBarOf(taskFixture({ name: 'Example review', reviewOf: '#3' })).reviewOf).toBe('#3');
    expect(linkedReviewBarOf(taskFixture({ name: 'Example review', reviewOf: 'abc' })).reviewOf).toBe('abc');
    for (const storedReviewOf of ['0', '-5', '5.5', '']) {
      expect(linkedReviewBarOf(taskFixture({ name: 'Example review', reviewOf: storedReviewOf })).reviewOf).toBe(storedReviewOf);
    }
  });

  test('pads a stored reviewOf also on a row whose name matches the legacy pattern', () => {
    expect(linkedReviewBarOf(taskFixture({ name: 'Review 1 #3 — x', reviewOf: '3' }))).toMatchObject({ reviewOf: '003', reviewBarRound: 1 });
  });

  test('replaces a padded reviewOf in place, so the keys keep their order', () => {
    const task = taskFixture({ name: 'Example review', reviewOf: '3' });

    expect(Object.keys(linkedReviewBarOf(task))).toEqual(Object.keys(task));
  });
});

describe('a row that is not a legacy review bar', () => {
  // A ticket's own row is never a review bar, as the page reads it, whatever it is called.
  test('a ticket-owned row comes back unchanged, whatever its name', () => {
    const task = taskFixture({ name: 'Review 1 #3 — misnamed', ticket: '009' });

    expect(linkedReviewBarOf(task)).toStrictEqual(task);
  });

  test('never touches a ticket row\'s reviewOf', () => {
    const task = taskFixture({ name: 'Example follow-up', ticket: '003', reviewOf: '3' });

    expect(linkedReviewBarOf(task)).toStrictEqual(task);
  });

  test('a name without the prefix gains no keys', () => {
    const linked = linkedReviewBarOf(taskFixture({ name: 'Review pass' }));

    expect('reviewOf' in linked).toBe(false);
    expect('reviewBarRound' in linked).toBe(false);
  });
});
