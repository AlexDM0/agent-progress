/** Whether a value read from outside is a well-formed board setting: the view, the concurrency limit, the dispatcher state and its run id. */
import type { DispatcherState, ViewRange } from '../@types/TrackerProgress.ts';
import { LOWEST_CONCURRENCY_LIMIT_AGENTS } from '../constants/ConcurrencyLimits.ts';
import { DISPATCHER_STATES }               from '../constants/DispatcherStates.ts';

function viewRangeIsWellFormed(value: unknown): value is ViewRange {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as { kind?: unknown; from?: unknown; to?: unknown; tickMinutes?: unknown };
  if (view.kind === 'auto') return true;
  if (view.kind !== 'absolute' && view.kind !== 'relative') return false;
  if (typeof view.from !== 'string' || typeof view.to !== 'string') return false;
  return view.tickMinutes === null || typeof view.tickMinutes === 'number';
}

/** Well-formed on disk, which a limit above the ceiling still is: an older tracker holding one reads it as the ceiling rather than failing. */
function concurrencyLimitIsWellFormed(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= LOWEST_CONCURRENCY_LIMIT_AGENTS;
}

function dispatcherStateIsKnown(value: unknown): value is DispatcherState {
  return typeof value === 'string' && (DISPATCHER_STATES as readonly string[]).includes(value);
}

function dispatcherRunIdIsWellFormed(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export const BoardSettingsUtil = {
  viewRangeIsWellFormed,
  concurrencyLimitIsWellFormed,
  dispatcherStateIsKnown,
  dispatcherRunIdIsWellFormed,
} as const;
