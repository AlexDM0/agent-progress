import type { DispatcherState } from '../@types/ProgressFile.ts';

export const DISPATCHER_STATES = ['running', 'finished', 'stopped'] as const satisfies readonly DispatcherState[];
