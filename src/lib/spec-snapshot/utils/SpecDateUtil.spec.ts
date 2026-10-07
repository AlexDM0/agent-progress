/**
 * File dates as the snapshot shows them: local-offset, never UTC, keeping their source, and unknown rather than a throw when missing or
 * unreadable, since a scan's dates come from whatever the file system reports.
 */
import { describe, expect, test } from 'bun:test';

import { LocalTimeUtil } from '../../local-time/LocalTimeUtil.ts';
import { SpecDateUtil }  from './SpecDateUtil.ts';

describe('a snapshot date', () => {
  test('is the same instant in local-offset form, keeping its source', () => {
    const date = SpecDateUtil.snapshotDateOf({ at: '2026-09-01T08:00:00.000Z', source: 'birth-time' });
    expect(date?.source).toBe('birth-time');
    expect(date?.at.endsWith('Z')).toBe(false);
    expect(LocalTimeUtil.parseIso(date?.at ?? '')?.getTime()).toBe(Date.parse('2026-09-01T08:00:00.000Z'));
  });

  test('is unknown when missing or unreadable', () => {
    expect(SpecDateUtil.snapshotDateOf(null)).toBeNull();
    expect(SpecDateUtil.snapshotDateOf({ at: 'not a date', source: 'birth-time' })).toBeNull();
  });

  test('a pair maps each date on its own', () => {
    expect(SpecDateUtil.snapshotDatesOf({ created: null, modified: { at: 'unreadable', source: 'modification-time' } })).toEqual({ created: null, modified: null });
  });
});
