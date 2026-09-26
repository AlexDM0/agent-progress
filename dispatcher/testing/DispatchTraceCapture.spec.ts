/**
 * The frozen trace table is the old dispatcher script's behaviour, so it holds only while that script is the one it was taken from: a change
 * to the committed script must retake the table and port the change, never leave the two apart.
 */
import { describe, expect, test } from 'bun:test';

import { digestOf }                 from './DispatchTrace.ts';
import { readFrozenDispatchTraces } from './DispatchTraceCapture.ts';
import { readDispatchScript }       from './OldDispatchScript.ts';

describe('the frozen dispatch trace table', () => {
  test('was taken from the committed old dispatcher script as it stands', () => {
    expect(digestOf(readDispatchScript()), 'the old script changed since the table was taken: retake the table and port the change')
      .toBe(readFrozenDispatchTraces().takenFrom.scriptDigest);
  });
});
