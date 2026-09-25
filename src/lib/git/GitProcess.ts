/**
 * The git building block: `GitProcess.run` is the one place git is spawned, with paths printed unquoted, and the modules beside it answer
 * repository questions on it as verdicts. It depends on `src/lib/atomic-file` only, through GitIgnore.
 */
import { existsSync, statSync } from 'node:fs';

const GIT_SUCCESS_EXIT_CODE = 0;

// Callers parse paths out of git's output, which must not arrive octal-escaped and quoted.
const CONFIGURATION_OVERRIDES = ['-c', 'core.quotePath=false'];

export interface GitRun {
  exitCode:       number;
  standardOutput: string;
  standardError:  string;
}

/** `null` when git could not be started at all. No timeout: a git that hangs is the caller's to wait on. */
function run(directory: string, gitArguments: readonly string[]): GitRun | null {
  try {
    const finished = Bun.spawnSync({
      cmd:    ['git', ...CONFIGURATION_OVERRIDES, ...gitArguments],
      cwd:    directory,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      exitCode:       finished.exitCode,
      standardOutput: finished.stdout.toString(),
      standardError:  finished.stderr.toString().trim(),
    };
  } catch {
    return null;
  }
}

// Narrowed to the exit code rather than to GitRun, so a failed run stays a GitRun where the check is negated.
type SucceededGitRun = GitRun & { exitCode: typeof GIT_SUCCESS_EXIT_CODE };

function succeeded(finishedRun: GitRun | null): finishedRun is SucceededGitRun {
  return finishedRun !== null && finishedRun.exitCode === GIT_SUCCESS_EXIT_CODE;
}

/** Fail closed: a `stat` that errors reads as "not a directory", which git is never started in. */
function directoryExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function failureReasonOf(finishedRun: GitRun | null, gitArguments: readonly string[]): string {
  const command = `git ${gitArguments.join(' ')}`;
  if (finishedRun === null) return `${command} could not be started.`;
  return `${command} exited with ${finishedRun.exitCode}: ${finishedRun.standardError}`;
}

/** `--end-of-options`, so a revision written as `--output=x` is looked up rather than obeyed. */
function resolvedCommitOf(directory: string, revision: string): string | null {
  const finishedRun = run(directory, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`]);
  if (!succeeded(finishedRun)) return null;
  return finishedRun.standardOutput.trim();
}

export const GitProcess = {
  directoryExists,
  failureReasonOf,
  resolvedCommitOf,
  run,
  succeeded,
} as const;
