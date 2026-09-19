/**
 * Keep `.agent-progress/` out of the repository it tracks. `git check-ignore` decides rather than a
 * scan of `.gitignore`, so a repository that already covers the directory in any way gets no diff,
 * and the exact-line scan is only the fallback for a machine with no git. The write is in place
 * rather than through `lib/platform/AtomicFile.ts`, because nothing holds a `.gitignore` open.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join }                                    from 'path';

import { TRACKER_DIRECTORY_NAME } from '../constants/Statuses';

const IGNORE_LINE = `${TRACKER_DIRECTORY_NAME}/`;

const RECOGNISED_IGNORE_LINES = [IGNORE_LINE, TRACKER_DIRECTORY_NAME];

const CHECK_IGNORE_PATH_IS_IGNORED = 0;
const CHECK_IGNORE_PATH_IS_NOT_IGNORED = 1;

export type EnsureIgnoredOutcome = 'already-ignored' | 'appended' | 'no-gitignore-written';

/**
 * The path is probed with its trailing slash, without which a rule written in the directory form
 * answers "not ignored" while the directory does not exist yet — which is exactly when `init` asks.
 */
function gitAlreadyIgnoresTheTracker(rootDirectory: string): boolean | null {
  try {
    const finished = Bun.spawnSync({
      cmd:    ['git', 'check-ignore', '-q', IGNORE_LINE],
      cwd:    rootDirectory,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (finished.exitCode === CHECK_IGNORE_PATH_IS_IGNORED) return true;
    if (finished.exitCode === CHECK_IGNORE_PATH_IS_NOT_IGNORED) return false;
    return null;
  } catch {
    // No git on this machine, which the exact-line fallback handles.
    return null;
  }
}

function contentAlreadyIgnoresTheTracker(content: string): boolean {
  return content.split(/\r?\n/).some((line) => RECOGNISED_IGNORE_LINES.includes(line.trim()));
}

export function ensureIgnored(rootDirectory: string): EnsureIgnoredOutcome {
  const gitVerdict = gitAlreadyIgnoresTheTracker(rootDirectory);
  if (gitVerdict === true) return 'already-ignored';

  const gitIgnorePath = join(rootDirectory, '.gitignore');
  if (!existsSync(gitIgnorePath)) {
    // Fail closed: a directory holding a `.git` entry is a repository even when git itself refused to answer.
    const rootIsARepository = gitVerdict === false || existsSync(join(rootDirectory, '.git'));
    if (!rootIsARepository) return 'no-gitignore-written';
    writeFileSync(gitIgnorePath, `${IGNORE_LINE}\n`);
    return 'appended';
  }

  const existingContent = readFileSync(gitIgnorePath, 'utf8');
  if (contentAlreadyIgnoresTheTracker(existingContent)) return 'already-ignored';

  const lineEnding = existingContent.includes('\r\n') ? '\r\n' : '\n';
  const separator = existingContent.length > 0 && !existingContent.endsWith('\n') ? lineEnding : '';
  writeFileSync(gitIgnorePath, `${existingContent}${separator}${IGNORE_LINE}${lineEnding}`);
  return 'appended';
}
