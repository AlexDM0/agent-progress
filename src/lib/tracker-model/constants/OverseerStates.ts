import type { OverseerState } from '../@types/TrackerProgress.ts';

export const OVERSEER_STATES = ['running', 'paused'] as const satisfies readonly OverseerState[];

/** What a tracker that never set an Overseer state reads: the first start waits for the user's go, as a pause by the user does. */
export const DEFAULT_OVERSEER_STATE: OverseerState = 'paused';
