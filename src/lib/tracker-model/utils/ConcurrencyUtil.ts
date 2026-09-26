import type { Concurrency }                                                   from '../@types/Concurrency.ts';
import type { Task }                                                          from '../@types/Task.ts';
import { CONCURRENCY_LIMIT_CEILING_AGENTS, DEFAULT_CONCURRENCY_LIMIT_AGENTS } from '../constants/ConcurrencyLimits.ts';

function agentsInFlightOf(tasks: readonly Readonly<Task>[]): number {
  const inProgressTasks   = tasks.filter((task) => task.status === 'in-progress');
  const claimedAgentKeys  = new Set(inProgressTasks.flatMap((task) => (task.agent === undefined ? [] : [task.agent])));
  const unclaimedRowCount = inProgressTasks.filter((task) => task.agent === undefined).length;
  return claimedAgentKeys.size + unclaimedRowCount;
}

/** A stored limit above the ceiling reads as the ceiling, and a tracker that never stored one reads the default. */
function concurrencyOf(tasks: readonly Readonly<Task>[], storedLimit: number | undefined): Concurrency {
  const limit          = Math.min(storedLimit ?? DEFAULT_CONCURRENCY_LIMIT_AGENTS, CONCURRENCY_LIMIT_CEILING_AGENTS);
  const agentsInFlight = agentsInFlightOf(tasks);
  return { limit, agentsInFlight, freeSlots: Math.max(0, limit - agentsInFlight) };
}

export const ConcurrencyUtil = { agentsInFlightOf, concurrencyOf } as const;
