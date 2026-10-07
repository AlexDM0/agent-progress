import { realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { SpecKitRootVerdict } from './@types/SpecKitScan.ts';

const SPECIFY_DIRECTORY_NAME = '.specify';

function holdsSpecifyDirectory(directory: string): boolean {
  try {
    return statSync(join(directory, SPECIFY_DIRECTORY_NAME)).isDirectory();
  } catch {
    return false;
  }
}

function canonicalPathOf(directory: string): string {
  try {
    return realpathSync(directory);
  } catch {
    return directory;
  }
}

/**
 * Spec-kit's own rule: the nearest directory at or above the start holding `.specify/`. An override root wins outright, with no walk, and
 * is found only when it holds `.specify/` itself.
 */
export function findSpecKitRoot(startDirectory: string, overrideRoot: string | undefined): SpecKitRootVerdict {
  if (overrideRoot !== undefined) {
    const overrideDirectory = resolve(overrideRoot);
    return holdsSpecifyDirectory(overrideDirectory)
      ? { verdict: 'found', rootDirectory: canonicalPathOf(overrideDirectory) }
      : { verdict: 'not-found', searchedDirectory: overrideDirectory };
  }

  const resolvedStart = resolve(startDirectory);
  let candidate       = canonicalPathOf(resolvedStart);
  for (;;) {
    if (holdsSpecifyDirectory(candidate)) return { verdict: 'found', rootDirectory: candidate };
    const parent = dirname(candidate);
    if (parent === candidate) return { verdict: 'not-found', searchedDirectory: resolvedStart };
    candidate = parent;
  }
}
