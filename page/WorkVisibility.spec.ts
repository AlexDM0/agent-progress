/** The note under the chart that says how much the recent-work filter hides. The case that matters: it names only the kinds with hidden items. */

import { describe, expect, test } from 'bun:test';
import { hiddenWorkNoteText }     from './WorkVisibility.ts';

describe('hiddenWorkNoteText', () => {
  test('names only the kinds that have hidden items, and says nothing when none are hidden', () => {
    expect(hiddenWorkNoteText(0, 0)).toBe('');
    expect(hiddenWorkNoteText(1, 0)).toBe('1 task hidden');
    expect(hiddenWorkNoteText(3, 2)).toBe('3 tasks · 2 tickets hidden');
  });
});
