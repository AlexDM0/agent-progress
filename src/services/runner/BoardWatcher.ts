/**
 * What wakes the DrivePass: a debounced watch of the data folder, its job folders included, and of the relay folders, plus a sweep every
 * `RUNNER_SWEEP_SECONDS` as a backstop for dropped watch events. A wake only asks for a pass; whether anything changed is the pass's
 * fingerprint, never the time of the event.
 */
import {
  existsSync,
  mkdirSync,
  watch,
  type FSWatcher
} from 'node:fs';
import { join } from 'node:path';

import { PRODUCT_NAMES }                                            from '../../shared/constants/ProductNames.ts';
import { RUNNER_SWEEP_SECONDS, RUNNER_WATCH_DEBOUNCE_MILLISECONDS } from '../../shared/constants/RunnerLimits.ts';

const MILLISECONDS_PER_SECOND = 1000;

export interface BoardWatcherRequest {
  trackerDirectory:   string;
  repositoryRoot:     string;
  wake:               () => void;
  /** Overridden by specs, which cannot wait a sweep. */
  sweepMilliseconds?: number;
}

export interface BoardWatcher {
  stop: () => void;
}

function watchQuietly(folderPath: string, onEvent: () => void): FSWatcher | null {
  try {
    return watch(folderPath, { recursive: true }, onEvent);
  } catch {
    // A folder the platform cannot watch is still swept.
    return null;
  }
}

/** The relay root holds every job's folder, so one recursive watch sees a request in a folder created after the start. */
function startWatching(request: BoardWatcherRequest): BoardWatcher {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const wakeSoon = (): void => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      request.wake();
    }, RUNNER_WATCH_DEBOUNCE_MILLISECONDS);
  };
  const relayRoot = join(request.repositoryRoot, PRODUCT_NAMES.WORKTREES_FOLDER, 'relay');
  if (!existsSync(relayRoot)) mkdirSync(relayRoot, { recursive: true });
  const watchers = [watchQuietly(request.trackerDirectory, wakeSoon), watchQuietly(relayRoot, wakeSoon)];
  const sweep = setInterval(request.wake, request.sweepMilliseconds ?? RUNNER_SWEEP_SECONDS * MILLISECONDS_PER_SECOND);
  return {
    stop: () => {
      if (debounce !== null) clearTimeout(debounce);
      clearInterval(sweep);
      for (const watcher of watchers) watcher?.close();
    },
  };
}

export const BoardWatcher = Object.freeze({ startWatching });
