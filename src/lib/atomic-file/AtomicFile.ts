/**
 * Replace a file in one step, so no reader ever sees a half-written one: the bytes go to a temporary
 * file beside the target — beside, because a rename across filesystems is a copy and a copy is not
 * atomic — are flushed with `fsync` before the rename, and are renamed over it.
 */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';

const TEMPORARY_NAME_RANDOM_LENGTH = 8;

const PERMISSION_BITS = 0o777;

const SYMLINK_FOLLOW_LIMIT = 40;

/** The last path of a symlink chain, which may not exist yet; a chain that never ends throws ELOOP, as a plain write through it would. */
function linkChainEndOf(targetPath: string): string {
  try {
    return realpathSync(targetPath);
  } catch {
    // Dangling, absent or cyclic: the chain is followed by hand below.
  }
  let currentPath = targetPath;
  for (let i = 0; i < SYMLINK_FOLLOW_LIMIT; i++) {
    let entryIsASymbolicLink = false;
    try {
      entryIsASymbolicLink = lstatSync(currentPath).isSymbolicLink();
    } catch {
      return currentPath;
    }
    if (!entryIsASymbolicLink) return currentPath;
    // The kernel resolves a relative link against the physical folder holding it, so a `..` after a symlinked folder lands where it would.
    currentPath = resolve(realpathSync(dirname(currentPath)), readlinkSync(currentPath));
  }
  throw Object.assign(new Error(`ELOOP: too many symbolic links encountered, '${targetPath}'`), { code: 'ELOOP' });
}

/**
 * A symlinked target stays a symlink and keeps its mode: the path is `realpath`-resolved first, and
 * an existing file's permission bits are carried onto the replacement.
 */
export function writeFileAtomically(targetPath: string, contents: string): void {
  let finalPath = targetPath;
  try {
    finalPath = realpathSync(targetPath);
  } catch {
    // A first write has nothing to resolve.
  }

  let existingMode: number | null = null;
  try {
    existingMode = statSync(finalPath).mode & PERMISSION_BITS;
  } catch {
    // No file, no mode to carry over.
  }

  mkdirSync(dirname(finalPath), { recursive: true });
  const writingProcessId = process.pid;
  const temporaryPath    = `${finalPath}.${writingProcessId}.${randomUUID().slice(0, TEMPORARY_NAME_RANDOM_LENGTH)}.tmp`;
  try {
    const temporaryFileDescriptor = openSync(temporaryPath, 'w', existingMode ?? undefined);
    try {
      // The mode handed to `open` is masked by the umask; only an explicit `fchmod` carries every bit over.
      if (existingMode !== null) fchmodSync(temporaryFileDescriptor, existingMode);
      writeSync(temporaryFileDescriptor, contents);
      fsyncSync(temporaryFileDescriptor);
    } finally {
      closeSync(temporaryFileDescriptor);
    }
    renameSync(temporaryPath, finalPath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The rename may already have consumed the path, and cleaning up must not replace the original error.
    }
    throw error;
  }
}

/**
 * Writes where a possibly dangling link chain ends, so the link survives the rename. Like a plain write
 * through the link, it never creates the folder a dangling link points into (ENOENT) and refuses a cycle (ELOOP).
 */
export function writeFileAtomicallyThroughLinks(linkPath: string, contents: string): void {
  const destinationPath = linkChainEndOf(linkPath);
  if (destinationPath !== linkPath && !existsSync(dirname(destinationPath))) {
    throw Object.assign(new Error(`ENOENT: no such file or directory, open '${linkPath}'`), { code: 'ENOENT' });
  }
  writeFileAtomically(destinationPath, contents);
}

/** The create-exclusive twin: the complete temporary file is hard-linked into place, which fails rather than replaces when the target exists. */
export function createFileAtomically(targetPath: string, contents: string): 'created' | 'already-exists' {
  mkdirSync(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID().slice(0, TEMPORARY_NAME_RANDOM_LENGTH)}.tmp`;
  try {
    const temporaryFileDescriptor = openSync(temporaryPath, 'wx');
    try {
      writeSync(temporaryFileDescriptor, contents);
      fsyncSync(temporaryFileDescriptor);
    } finally {
      closeSync(temporaryFileDescriptor);
    }
    linkSync(temporaryPath, targetPath);
    return 'created';
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return 'already-exists';
    throw error;
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // A temporary file that was never opened has nothing to remove.
    }
  }
}
