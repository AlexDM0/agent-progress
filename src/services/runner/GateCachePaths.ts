/**
 * Which stored cache folders a gate and install line may write: never one that is, sits in or holds a `bin` folder, and never one that is,
 * sits in or holds a folder on the runner's `PATH`, so a branch's scripts cannot replace an executable the runner later starts.
 */
import { existsSync }       from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { resolvedPathOf } from './ResolvedPath.ts';

export type CacheFolderRefusal = 'bin-folder' | 'search-path-folder';

const HOME_PREFIX = '~/';
const EXECUTABLES_FOLDER_NAME = 'bin';

function absoluteCachePathOf(storedPath: string, homeDirectory: string): string {
  return storedPath.startsWith(HOME_PREFIX) ? join(homeDirectory, storedPath.slice(HOME_PREFIX.length)) : storedPath;
}

function nestsWith(first: string, second: string): boolean {
  return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`);
}

function refusalOf(storedPath: string, homeDirectory: string, executableSearchPath: readonly string[]): CacheFolderRefusal | null {
  const path = resolvedPathOf(absoluteCachePathOf(storedPath, homeDirectory));
  if (path.split('/').includes(EXECUTABLES_FOLDER_NAME) || existsSync(join(path, EXECUTABLES_FOLDER_NAME))) return 'bin-folder';
  const searchFolders = executableSearchPath.filter((folder) => isAbsolute(folder)).map(resolvedPathOf);
  return searchFolders.some((folder) => nestsWith(path, folder)) ? 'search-path-folder' : null;
}

/** The stored paths resolved, those refused now dropped: a folder may have gained a `bin` or joined `PATH` since it was stored. */
function writableCachePathsOf(storedPaths: readonly string[], homeDirectory: string, executableSearchPath: readonly string[]): string[] {
  return storedPaths
    .filter((storedPath) => refusalOf(storedPath, homeDirectory, executableSearchPath) === null)
    .map((storedPath) => resolvedPathOf(absoluteCachePathOf(storedPath, homeDirectory)));
}

export const GateCachePaths = Object.freeze({
  refusalOf,
  writableCachePathsOf,
});
