/**
 * What wakes the DrivePass: a debounced watch of the data folder, its job folders included, and of the Hatch folders, plus a sweep every
 * `OVERSEER_SWEEP_SECONDS` as a backstop for dropped watch events. A wake only asks for a pass; whether anything changed is the pass's
 * fingerprint, never the time of the event.
 */
import {
  existsSync,
  mkdirSync,
  watch,
  type FSWatcher
} from 'node:fs';
import { join } from 'node:path';

import { OVERSEER_SWEEP_SECONDS, OVERSEER_WATCH_DEBOUNCE_MILLISECONDS } from '../../shared/constants/OverseerLimits.ts';
import { PRODUCT_NAMES }                                                from '../../shared/constants/ProductNames.ts';

const MILLISECONDS_PER_SECOND = 1000;

export interface DataFolderWatchRequest {
  trackerDirectory:   string;
  repositoryRoot:     string;
  wake:               () => void;
  /** Called at each sweep before its wake; the Overseer asks the on-disk binary for its versions again then. */
  onSweep?:           () => void;
  /** Overridden by specs, which cannot wait a sweep. */
  sweepMilliseconds?: number;
}

export interface DataFolderWatch {
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

/** The Hatch root holds every job's folder, so one recursive watch sees a request in a folder created after the start. */
function startWatching(request: DataFolderWatchRequest): DataFolderWatch {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const wakeSoon = (): void => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      request.wake();
    }, OVERSEER_WATCH_DEBOUNCE_MILLISECONDS);
  };
  const hatchRoot = join(request.repositoryRoot, PRODUCT_NAMES.WORKTREES_FOLDER, 'hatch');
  if (!existsSync(hatchRoot)) mkdirSync(hatchRoot, { recursive: true });
  const watchers = [watchQuietly(request.trackerDirectory, wakeSoon), watchQuietly(hatchRoot, wakeSoon)];
  const sweepOnce = (): void => {
    request.onSweep?.();
    request.wake();
  };
  const sweep = setInterval(sweepOnce, request.sweepMilliseconds ?? OVERSEER_SWEEP_SECONDS * MILLISECONDS_PER_SECOND);
  return {
    stop: () => {
      if (debounce !== null) clearTimeout(debounce);
      clearInterval(sweep);
      for (const watcher of watchers) watcher?.close();
    },
  };
}

export const DataFolderWatch = Object.freeze({ startWatching });
