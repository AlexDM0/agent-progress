/** A new tracker's state, built from the model's constants. */
import type { ProgressFile }                from '../@types/ProgressFile.ts';
import { DEFAULT_CONCURRENCY_LIMIT_AGENTS } from '../constants/ConcurrencyLimits.ts';
import { FIRST_TASK_ID }                    from '../constants/TaskIds.ts';

const PROGRESS_FILE_VERSION: ProgressFile['version'] = 1;

/** `trackerId` comes from the caller, because the model has no randomness. */
function emptyProgressFor(input: { project: string; startedAt: string; trackerId: string }): ProgressFile {
  return {
    version:          PROGRESS_FILE_VERSION,
    trackerId:        input.trackerId,
    project:          input.project,
    startedAt:        input.startedAt,
    view:             { kind: 'auto' },
    nextTaskId:       FIRST_TASK_ID,
    concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT_AGENTS,
    tasks:            [],
    log:              [],
  };
}

export const EmptyProgressUtil = { emptyProgressFor } as const;
