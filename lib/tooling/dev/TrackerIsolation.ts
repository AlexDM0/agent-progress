/**
 * The guard that keeps a spec away from a tracker it did not create: every directory a spec hands a command must lie inside the scratch root, and
 * so must any tracker discovery resolves from it — the walk up, the git common directory and `AGENT_PROGRESS_ROOT` alike.
 */
import { realpathSync }                  from 'node:fs';
import { tmpdir }                        from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

import { findWorkspace } from '../../platform/Workspace';

export type TrackerIsolationVerdict = 'isolated' | 'directory-outside-the-scratch-root' | 'resolves-a-tracker-outside-the-scratch-root';

/** Where `lib/tooling/dev/ScratchWorkspace.ts` creates every scratch directory, with its symlinks resolved. */
export function scratchRootDirectory(): string {
  return canonicalPathOf(tmpdir());
}

function canonicalPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function pathLiesInside(candidatePath: string, containingDirectory: string): boolean {
  const pathFromContainer = relative(containingDirectory, candidatePath);
  return pathFromContainer !== '' && !pathFromContainer.startsWith('..') && !isAbsolute(pathFromContainer);
}

export function trackerIsolationVerdictFor(startDirectory: string, scratchRoot: string = scratchRootDirectory()): TrackerIsolationVerdict {
  const canonicalScratchRoot = canonicalPathOf(scratchRoot);
  if (!pathLiesInside(canonicalPathOf(startDirectory), canonicalScratchRoot)) return 'directory-outside-the-scratch-root';
  const resolvedWorkspace = findWorkspace(startDirectory);
  if (resolvedWorkspace !== null && !pathLiesInside(canonicalPathOf(resolvedWorkspace.rootDirectory), canonicalScratchRoot)) {
    return 'resolves-a-tracker-outside-the-scratch-root';
  }
  return 'isolated';
}

/** Throws rather than returning, because its callers are the spec helpers, and a throw there fails the spec before any command can write. */
export function requireTrackerIsolation(startDirectory: string, scratchRoot: string = scratchRootDirectory()): void {
  const verdict = trackerIsolationVerdictFor(startDirectory, scratchRoot);
  if (verdict === 'isolated') return;
  throw new Error(
    `A spec pointed a command at ${startDirectory}, which is not isolated (${verdict}): a command run from there could write into a real tracker. `
    + 'Give it a directory from lib/tooling/dev/ScratchWorkspace.ts instead.',
  );
}
