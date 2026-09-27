/**
 * Where one tracker's files are. `findWorkspace` walks up first — the nearest tracker above wins —
 * and asks `src/lib/git/RepositoryRoot.ts` only when the walk finds nothing, which is what makes a
 * sibling worktree, with nothing above it holding the tracker, resolve to the main checkout.
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve }             from 'node:path';

import { discoverRepositoryRoot }    from '../../lib/git/RepositoryRoot.ts';
import { agentProgressRootOverride } from '../../shared/Environment.ts';
import { OperationRefusal }          from '../../shared/OperationRefusal.ts';
import { TRACKER_FILES }             from './constants/TrackerFiles.ts';

/** Every path one tracker owns, all absolute: a relative one would resolve against a subagent's working directory. */
export interface Workspace {
  rootDirectory:     string;
  trackerDirectory:  string;
  progressFilePath:  string;
  logFilePath:       string;
  htmlFilePath:      string;
  ticketsDirectory:  string;
  lockDirectoryPath: string;
}

/** The paths a tracker would have whether or not it exists; touches no filesystem, because `init` needs the paths of one it is creating. */
export function workspacePathsFor(rootDirectory: string): Workspace {
  const absoluteRoot = resolve(rootDirectory);
  const trackerDirectory = join(absoluteRoot, TRACKER_FILES.TRACKER_DIRECTORY_NAME);
  return {
    rootDirectory:     absoluteRoot,
    trackerDirectory,
    progressFilePath:  join(trackerDirectory, TRACKER_FILES.PROGRESS_FILE_NAME),
    logFilePath:       join(trackerDirectory, TRACKER_FILES.LOG_FILE_NAME),
    htmlFilePath:      join(trackerDirectory, TRACKER_FILES.HTML_FILE_NAME),
    ticketsDirectory:  join(trackerDirectory, TRACKER_FILES.TICKETS_DIRECTORY_NAME),
    lockDirectoryPath: join(trackerDirectory, TRACKER_FILES.LOCK_DIRECTORY_NAME),
  };
}

/** A tracker means its progress file, not merely the directory, which a half-finished `init` also leaves behind. */
function directoryHoldsATracker(candidateRoot: string): boolean {
  const { progressFilePath } = workspacePathsFor(candidateRoot);
  try {
    return statSync(progressFilePath).isFile();
  } catch {
    // Fail closed: a `stat` that errors reads as "no tracker here" rather than as a reason to stop walking.
    return false;
  }
}

/**
 * `AGENT_PROGRESS_ROOT` wins outright, with no walk in either direction, and a tracker must still
 * exist there, so a misspelled override reads as "no tracker" rather than finding a different one.
 */
export function findWorkspace(startDirectory: string): Workspace | null {
  const overrideRoot = agentProgressRootOverride();
  if (overrideRoot !== undefined) {
    const overriddenWorkspace = workspacePathsFor(overrideRoot);
    return directoryHoldsATracker(overriddenWorkspace.rootDirectory) ? overriddenWorkspace : null;
  }

  let candidate = resolve(startDirectory);
  try {
    candidate = realpathSync(candidate);
  } catch {
    // A start directory that no longer exists cannot hold a tracker, and the walk still reaches its real ancestors.
  }

  for (;;) {
    if (directoryHoldsATracker(candidate)) return workspacePathsFor(candidate);
    const parentDirectory = dirname(candidate);
    if (parentDirectory === candidate) break;
    candidate = parentDirectory;
  }

  const discovery = discoverRepositoryRoot(startDirectory);
  if (discovery.source !== 'git') return null;
  return directoryHoldsATracker(discovery.rootDirectory) ? workspacePathsFor(discovery.rootDirectory) : null;
}

/**
 * The one place the "no tracker here" refusal is thrown, so every command exits 1: with the directory AGENT_PROGRESS_ROOT names when it is
 * set, otherwise with the directory the search started from, for the command line to word.
 */
export function requireWorkspace(startDirectory: string): Workspace {
  const workspace = findWorkspace(startDirectory);
  if (workspace !== null) return workspace;

  const overrideRoot = agentProgressRootOverride();
  if (overrideRoot !== undefined) {
    throw new OperationRefusal('refused', { kind: 'no-tracker-at-override', overrideDirectory: resolve(overrideRoot) });
  }

  const searchedFrom = existsSync(startDirectory) ? resolve(startDirectory) : startDirectory;
  throw new OperationRefusal('refused', { kind: 'no-tracker-found', searchedFrom });
}
