/**
 * Runs a case that waits out a held tracker lock's whole retry budget without the wall time: every `Bun.sleep` inside it resolves at once and
 * is recorded, so the case asserts the waits the lock asked for instead of sitting through them.
 */
import { spyOn } from 'bun:test';

export interface LockRetryWaitsResult<ActionResult> {
  outcome:           { settled: 'fulfilled'; value: ActionResult } | { settled: 'rejected'; reason: unknown };
  sleepMilliseconds: number[];
}

export async function lockRetryWaitsDuring<ActionResult>(action: () => Promise<ActionResult>): Promise<LockRetryWaitsResult<ActionResult>> {
  const sleepMilliseconds: number[] = [];
  const sleepSpy = spyOn(Bun, 'sleep').mockImplementation((requested: number | Date) => {
    sleepMilliseconds.push(typeof requested === 'number' ? requested : requested.getTime() - Date.now());
    return Promise.resolve();
  });
  try {
    return { outcome: { settled: 'fulfilled', value: await action() }, sleepMilliseconds };
  } catch (reason) {
    return { outcome: { settled: 'rejected', reason }, sleepMilliseconds };
  } finally {
    sleepSpy.mockRestore();
  }
}
