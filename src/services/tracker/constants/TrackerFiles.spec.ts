/**
 * Every tracker file name is joined onto a directory the tool resolved itself, so a name carrying a
 * separator or a parent segment would reach outside the tracker.
 */
import { expect, test } from 'bun:test';

import { TRACKER_FILES } from './TrackerFiles.ts';

test('every path constant is a bare name, so joining one onto a directory cannot escape it', () => {
  const names = Object.values(TRACKER_FILES);
  expect(names.length, 'the scan found the tracker file names').toBeGreaterThan(5);
  for (const name of names) {
    expect(name.length, 'a path constant is never empty').toBeGreaterThan(0);
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
    expect(name.includes('..'), `"${name}" has no parent-directory segment`).toBe(false);
  }
});
