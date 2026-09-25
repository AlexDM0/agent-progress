/**
 * The viewer's work-visibility choice and the note under the chart. The cases that matter: a damaged stored choice falls back to hiding old
 * work, and the note names only the kinds that have hidden items.
 */

import { describe, expect, test }                 from 'bun:test';
import { hiddenWorkNoteText, workVisibilityFrom } from './WorkVisibility.ts';

describe('workVisibilityFrom', () => {
  test('reads only "all" as all, so a damaged stored value falls back to hiding old work', () => {
    expect(workVisibilityFrom('all')).toBe('all');
    expect(workVisibilityFrom('recent')).toBe('recent');
    expect(workVisibilityFrom(null)).toBe('recent');
    expect(workVisibilityFrom('constructor')).toBe('recent');
  });
});

describe('hiddenWorkNoteText', () => {
  test('names only the kinds that have hidden items, and says nothing when none are hidden', () => {
    expect(hiddenWorkNoteText(0, 0)).toBe('');
    expect(hiddenWorkNoteText(1, 0)).toBe('1 task hidden');
    expect(hiddenWorkNoteText(3, 2)).toBe('3 tasks · 2 tickets hidden');
  });
});
