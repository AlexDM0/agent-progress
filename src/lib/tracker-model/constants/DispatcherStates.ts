import type { DispatcherState } from '../@types/TrackerProgress.ts';

export const DISPATCHER_STATES = ['running', 'finished', 'stopped'] as const satisfies readonly DispatcherState[];

/** What a tracker that never set a dispatcher state reads: the first start waits for the user's go, as a stop by the user does. */
export const DEFAULT_DISPATCHER_STATE: DispatcherState = 'stopped';
