/**
 * Whether a path lies under `/tmp` or `/var/tmp`, the two temp folders the process context always counts besides `tmpdir()`. A spawned
 * child can move its `tmpdir()` through `TMPDIR`, never these two, so a scratch root under either keeps every child's tracker temporary.
 */
import { tmpdir }               from 'node:os';
import { isAbsolute, relative } from 'node:path';

import { canonicalPathOf } from './TrackerIsolation.ts';

const FIXED_TEMPORARY_FOLDERS = ['/tmp', '/var/tmp'] as const;

export function pathLiesUnderAFixedTemporaryFolder(path: string): boolean {
  const canonicalPath = canonicalPathOf(path);
  return FIXED_TEMPORARY_FOLDERS.some((temporaryFolder) => {
    const pathFromTemporaryFolder = relative(canonicalPathOf(temporaryFolder), canonicalPath);
    return !pathFromTemporaryFolder.startsWith('..') && !isAbsolute(pathFromTemporaryFolder);
  });
}

export function scratchRootLiesOutsideTheFixedTemporaryFolders(): boolean {
  return !pathLiesUnderAFixedTemporaryFolder(tmpdir());
}
