/**
 * Where one tracker's files are. `findWorkspace` walks up first — the nearest tracker above wins —
 * and asks `lib/platform/RepositoryRoot.ts` only when the walk finds nothing, which is what makes a
 * sibling worktree, with nothing above it holding the tracker, resolve to the main checkout.
 */
import { existsSync, realpathSync, statSync } from 'fs';
import { dirname, join, resolve }             from 'path';

import {
  HTML_FILE_NAME,
  LOCK_DIRECTORY_NAME,
  PROGRESS_FILE_NAME,
  TICKETS_DIRECTORY_NAME,
  TRACKER_DIRECTORY_NAME
} from '../constants/Statuses';
import { agentProgressRootOverride } from './Environment';
import { OperationRefusal }          from './OperationRefusal';
import { discoverRepositoryRoot }    from './RepositoryRoot';

/** Every path one tracker owns, all absolute: a relative one would resolve against a subagent's working directory. */
export interface Workspace {
  rootDirectory:     string;
  trackerDirectory:  string;
  progressFilePath:  string;
  htmlFilePath:      string;
  ticketsDirectory:  string;
  lockDirectoryPath: string;
}

/** The paths a tracker would have whether or not it exists; touches no filesystem, because `init` needs the paths of one it is creating. */
export function workspacePathsFor(rootDirectory: string): Workspace {
  const absoluteRoot = resolve(rootDirectory);
  const trackerDirectory = join(absoluteRoot, TRACKER_DIRECTORY_NAME);
  return {
    rootDirectory:     absoluteRoot,
    trackerDirectory,
    progressFilePath:  join(trackerDirectory, PROGRESS_FILE_NAME),
    htmlFilePath:      join(trackerDirectory, HTML_FILE_NAME),
    ticketsDirectory:  join(trackerDirectory, TICKETS_DIRECTORY_NAME),
    lockDirectoryPath: join(trackerDirectory, LOCK_DIRECTORY_NAME),
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

/** The one place the "no tracker here" refusal is written, so every command exits 1 with a message naming `agent-progress init`. */
export function requireWorkspace(startDirectory: string): Workspace {
  const workspace = findWorkspace(startDirectory);
  if (workspace !== null) return workspace;

  const overrideRoot = agentProgressRootOverride();
  if (overrideRoot !== undefined) {
    throw new OperationRefusal(
      'refused',
      `No agent-progress tracker was found in ${resolve(overrideRoot)}, which AGENT_PROGRESS_ROOT names. `
      + 'Run `agent-progress init` there, or unset AGENT_PROGRESS_ROOT to search upwards from the current directory instead.',
    );
  }

  const searchedFrom = existsSync(startDirectory) ? resolve(startDirectory) : startDirectory;
  throw new OperationRefusal(
    'refused',
    `No agent-progress tracker was found in ${searchedFrom} or any directory above it. Run \`agent-progress init\` in the repository you want tracked.`,
  );
}
