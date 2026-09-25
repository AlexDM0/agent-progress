/**
 * Keep a directory out of the repository it sits in. `git check-ignore` decides rather than a
 * scan of `.gitignore`, so a repository that already covers the directory in any way gets no diff,
 * and the exact-line scan is only the fallback for a machine with no git.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join }                     from 'node:path';

import { writeFileAtomicallyThroughLinks } from '../atomic-file/AtomicFile';
import { GitProcess }                      from './GitProcess';

const CHECK_IGNORE_PATH_IS_IGNORED = 0;
const CHECK_IGNORE_PATH_IS_NOT_IGNORED = 1;

export type EnsureIgnoredOutcome = 'already-ignored' | 'appended' | 'no-gitignore-written';

/**
 * The path is probed with its trailing slash, without which a rule written in the directory form answers "not ignored" while the
 * directory does not exist yet — which is exactly when a caller asks before creating it. `null` when git cannot answer, which the
 * exact-line fallback handles.
 */
function gitAlreadyIgnores(rootDirectory: string, ignoreLine: string): boolean | null {
  const run = GitProcess.run(rootDirectory, ['check-ignore', '-q', ignoreLine]);
  if (run === null) return null;
  if (run.exitCode === CHECK_IGNORE_PATH_IS_IGNORED) return true;
  if (run.exitCode === CHECK_IGNORE_PATH_IS_NOT_IGNORED) return false;
  return null;
}

function contentAlreadyIgnores(content: string, recognisedIgnoreLines: readonly string[]): boolean {
  return content.split(/\r?\n/).some((line) => recognisedIgnoreLines.includes(line.trim()));
}

export function ensureIgnored(rootDirectory: string, ignoredDirectoryName: string): EnsureIgnoredOutcome {
  const ignoreLine            = `${ignoredDirectoryName}/`;
  const recognisedIgnoreLines = [ignoreLine, ignoredDirectoryName];

  const gitVerdict = gitAlreadyIgnores(rootDirectory, ignoreLine);
  if (gitVerdict === true) return 'already-ignored';

  const gitIgnorePath = join(rootDirectory, '.gitignore');
  if (!existsSync(gitIgnorePath)) {
    // Fail closed: a directory holding a `.git` entry is a repository even when git itself refused to answer.
    const rootIsARepository = gitVerdict === false || existsSync(join(rootDirectory, '.git'));
    if (!rootIsARepository) return 'no-gitignore-written';
    writeFileAtomicallyThroughLinks(gitIgnorePath, `${ignoreLine}\n`);
    return 'appended';
  }

  const existingContent = readFileSync(gitIgnorePath, 'utf8');
  if (contentAlreadyIgnores(existingContent, recognisedIgnoreLines)) return 'already-ignored';

  const lineEnding = existingContent.includes('\r\n') ? '\r\n' : '\n';
  const separator = existingContent.length > 0 && !existingContent.endsWith('\n') ? lineEnding : '';
  writeFileAtomicallyThroughLinks(gitIgnorePath, `${existingContent}${separator}${ignoreLine}${lineEnding}`);
  return 'appended';
}
