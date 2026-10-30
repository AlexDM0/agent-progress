import type { RunnerState } from '../@types/TrackerProgress.ts';

export const RUNNER_STATES = ['running', 'paused'] as const satisfies readonly RunnerState[];

/** What a tracker that never set a runner state reads: the first start waits for the user's go, as a pause by the user does. */
export const DEFAULT_RUNNER_STATE: RunnerState = 'paused';
