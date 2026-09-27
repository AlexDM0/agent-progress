/**
 * The install version decision against its own contract, with arbitrary numbers: with one install version so far, a valid older manifest cannot
 * exist on disk, so only this spec reaches `older`. What matters: equal is current, lower is older and higher is newer with the recorded number,
 * an unreadable manifest fails closed, and a missing one is a mismatch only while installed files are present.
 */
import { describe, expect, test } from 'bun:test';

import { InstallVersionVerdictUtil } from './InstallVersionVerdictUtil.ts';

const { verdictOf } = InstallVersionVerdictUtil;

describe('InstallVersionVerdictUtil.verdictOf', () => {
  test('a manifest recording the running install version is current', () => {
    expect(verdictOf({ verdict: 'readable', installVersion: 7 }, true, 7)).toEqual({ verdict: 'current' });
  });

  test('a lower recorded version is an older mismatch carrying that version', () => {
    expect(verdictOf({ verdict: 'readable', installVersion: 5 }, true, 7)).toEqual({ verdict: 'mismatch', mismatch: { reason: 'older', installedVersion: 5 } });
  });

  test('a higher recorded version is a newer mismatch carrying that version', () => {
    expect(verdictOf({ verdict: 'readable', installVersion: 9 }, true, 7)).toEqual({ verdict: 'mismatch', mismatch: { reason: 'newer', installedVersion: 9 } });
  });

  test('an unreadable manifest is a mismatch carrying the problem, whether or not files are present', () => {
    for (const installedFilesArePresent of [true, false]) {
      expect(verdictOf({ verdict: 'unreadable', reason: 'it is not a JSON object' }, installedFilesArePresent, 7)).toEqual({
        verdict:  'mismatch',
        mismatch: { reason: 'unreadable', manifestProblem: 'it is not a JSON object' },
      });
    }
  });

  test('a missing manifest while installed files are present is an unversioned mismatch', () => {
    expect(verdictOf({ verdict: 'absent' }, true, 7)).toEqual({ verdict: 'mismatch', mismatch: { reason: 'unversioned' } });
  });

  test('a missing manifest with nothing installed is current', () => {
    expect(verdictOf({ verdict: 'absent' }, false, 7)).toEqual({ verdict: 'current' });
  });
});
