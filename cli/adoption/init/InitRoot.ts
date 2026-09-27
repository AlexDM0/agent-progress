/** The directory `init` creates its tracker in: `--root` when given, else the repository discovered from here, and never one a mistake chose. */
import { realpathSync, statSync } from 'node:fs';
import { resolve }                from 'node:path';

import { discoverRepositoryRoot }    from '../../../src/lib/git/RepositoryRoot.ts';
import { agentProgressRootOverride } from '../../../src/shared/Environment.ts';
import { OperationRefusal }          from '../../../src/shared/OperationRefusal.ts';

function resolvedRealPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A bare repository is refused: it has no working tree, and guessing a directory near it would write into somebody else's. */
function discoveredRootForInit(currentDirectory: string): string {
  const discovery = discoverRepositoryRoot(currentDirectory);
  if (discovery.source === 'bare-repository') {
    throw new OperationRefusal(
      'refused',
      `${discovery.rootDirectory} is inside a bare git repository, which has no working tree to track. `
      + 'Run `agent-progress init` in a checkout of it, or pass --root <path> to track a directory explicitly.',
    );
  }
  return discovery.rootDirectory;
}

/** `--root` must name an existing directory: `init` does not create one, or a mistyped path would make a tracker nobody looks at. */
function requiredExistingDirectory(candidatePath: string, asWritten: string): string {
  let isADirectory = false;
  try {
    isADirectory = statSync(candidatePath).isDirectory();
  } catch {
    // Fail closed: anything a `stat` cannot answer is not a directory to write a tracker into.
  }
  if (!isADirectory) {
    throw new OperationRefusal(
      'refused',
      `--root "${asWritten}" is not an existing directory (${candidatePath}). `
      + 'Create it first, or leave --root off to track the repository `agent-progress` discovers from here.',
    );
  }
  return candidatePath;
}

export function initRootDirectoryOf(rootOption: string | undefined, currentDirectory: string): string {
  if (rootOption === undefined) return discoveredRootForInit(currentDirectory);
  return requiredExistingDirectory(resolvedRealPath(resolve(currentDirectory, rootOption)), rootOption);
}

/** `AGENT_PROGRESS_ROOT` does not choose where `init` writes, so one naming another directory is refused rather than half-obeyed. */
export function refuseAnOverrideNamingAnotherDirectory(currentDirectory: string, rootDirectory: string): void {
  const overrideRoot = agentProgressRootOverride();
  if (overrideRoot === undefined) return;
  const overriddenDirectory = resolvedRealPath(resolve(currentDirectory, overrideRoot));
  if (overriddenDirectory === resolvedRealPath(rootDirectory)) return;
  throw new OperationRefusal(
    'refused',
    `AGENT_PROGRESS_ROOT names ${overriddenDirectory}, but \`init\` would create the tracker in ${rootDirectory}; nothing was written. `
    + 'Unset AGENT_PROGRESS_ROOT, or set it to the directory you are initialising, or pass that directory as --root.',
  );
}
