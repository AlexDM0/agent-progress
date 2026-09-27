/**
 * Runs a few lines of source in a child Bun process with its own environment, for the specs that must set an environment variable, which only
 * `src/shared/Environment.spec.ts` may assign in-process. Test-only: nothing that ships may import `src/testing/`.
 */

/** The JSON the source printed to standard output; a child that exits non-zero fails the test with its standard error. */
export function jsonPrintedByAChildProcess(environment: Record<string, string>, source: string): unknown {
  const finished = Bun.spawnSync([process.execPath, '-e', source], {
    env:    environment,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (finished.exitCode !== 0) throw new Error(`the child process failed: ${finished.stderr.toString().trim()}`);
  return JSON.parse(finished.stdout.toString().trim()) as unknown;
}
