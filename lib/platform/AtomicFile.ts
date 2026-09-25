/**
 * Replace a file in one step, so no reader ever sees a half-written one: the bytes go to a temporary
 * file beside the target — beside, because a rename across filesystems is a copy and a copy is not
 * atomic — are flushed with `fsync` before the rename, and are renamed over it.
 */
import { randomUUID } from 'crypto';
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync
} from 'fs';
import { dirname } from 'path';

const TEMPORARY_NAME_RANDOM_LENGTH = 8;

const PERMISSION_BITS = 0o777;

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
