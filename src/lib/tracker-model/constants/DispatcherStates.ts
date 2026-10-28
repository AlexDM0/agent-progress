import type { DispatcherState } from '../@types/TrackerProgress.ts';

export const DISPATCHER_STATES = ['running', 'finished', 'stopped'] as const satisfies readonly DispatcherState[];

/** What a tracker that never set a dispatcher state reads: the first start waits for the user's go, as a stop by the user does. */
export const DEFAULT_DISPATCHER_STATE: DispatcherState = 'stopped';

/** How each stored state reads: a stored `finished` reads as `stopped`, which fails closed, so a stored file is never rewritten for it. */
export const DISPATCHER_STATE_READ_FOR_STORED_STATE: Readonly<Record<DispatcherState, DispatcherState>> = {
  running:  'running',
  finished: 'stopped',
  stopped:  'stopped',
};
