/** Runs the tracker's check command in a directory through the user's shell, its two output streams joined in order. */
import { userShell } from '../../src/shared/Environment.ts';

export interface CheckRun {
  exitCode: number | null;
  output:   string;
}

export const CHECK_OUTPUT_TAIL_LINES = 20;

const CHECK_SUCCESS_EXIT_CODE = 0;

const FALLBACK_SHELL = '/bin/sh';

// `sh` joins standard error onto standard output once, then hands the line to the user's shell, so the output keeps its order whatever shell that is.
const OUTPUT_JOINING_SCRIPT = 'exec 2>&1; exec "$0" -c "$1"';

export async function runCheckCommand(checkCommand: string, directory: string): Promise<CheckRun> {
  try {
    const checkProcess = Bun.spawn({
      cmd:    [FALLBACK_SHELL, '-c', OUTPUT_JOINING_SCRIPT, userShell() ?? FALLBACK_SHELL, checkCommand],
      cwd:    directory,
      stdin:  'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [output, errorOutput, exitCode] = await Promise.all([
      new Response(checkProcess.stdout).text(),
      new Response(checkProcess.stderr).text(),
      checkProcess.exited,
    ]);
    return { exitCode, output: output + errorOutput };
  } catch (error) {
    return { exitCode: null, output: error instanceof Error ? error.message : String(error) };
  }
}

export function checkRunPassed(checkRun: CheckRun): boolean {
  return checkRun.exitCode === CHECK_SUCCESS_EXIT_CODE;
}

export function checkRunOutcomeText(checkRun: CheckRun): string {
  return checkRun.exitCode === null ? 'could not be started' : `exited ${checkRun.exitCode}`;
}

export function lastLinesOf(output: string): string {
  return output.trimEnd().split('\n').slice(-CHECK_OUTPUT_TAIL_LINES).join('\n');
}
