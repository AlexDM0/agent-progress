/**
 * The frozen trace table names where it came from: the bundle of the TypeScript port, by its entry and digest, and the command that retakes it.
 * A retake is made only in a commit meant to change what the agents are told, so the table must say how to make one.
 */
import { describe, expect, test } from 'bun:test';

import { BUNDLE_ENTRY_PATH, RETAKE_COMMAND, readFrozenDispatchTraces } from './DispatchTraceCapture.ts';
import { DIGEST_LENGTH_CHARACTERS }                                    from './constants/DispatchTraceFormat.ts';

describe('the frozen dispatch trace table', () => {
  test('records the bundle it was taken from and the command that retakes it', () => {
    const { takenFrom, retake } = readFrozenDispatchTraces();
    expect(takenFrom.scriptPath).toBe(BUNDLE_ENTRY_PATH);
    expect(takenFrom.scriptDigest).toMatch(new RegExp(`^[0-9a-f]{${DIGEST_LENGTH_CHARACTERS}}$`));
    expect(retake).toBe(RETAKE_COMMAND);
  });
});
