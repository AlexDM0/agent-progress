/**
 * Spawns the real binary for the one claim an in-process `runCommandLine` cannot make: that `agent-progress.ts` itself works, shebang, executable
 * bit and exit code included. `cli/BinarySmoke.spec.ts` is the only caller.
 */
import { existsSync } from 'node:fs';
import { join }       from 'node:path';

import { requireTrackerIsolation } from './TrackerIsolation';

export interface AgentProgressResult {
  exitCode:       number;
  standardOutput: string;
  standardError:  string;
}

export interface RunAgentProgressOptions {
  currentDirectory: string;
}

/** The existence check is the point: a wrong number of `..` segments still resolves, and the spawn would then fail as a Bun entry-point error. */
function agentProgressEntryPoint(): string {
  const entryPoint = join(import.meta.dir, '..', '..', '..', 'agent-progress.ts');
  if (!existsSync(entryPoint)) {
    throw new Error(`The CLI entry point is not at ${entryPoint}; lib/tooling/dev/CliProcess.ts has to be told where it moved to.`);
  }
  return entryPoint;
}

/** Both streams are read to completion before the exit code is awaited, since a pipe that fills while nobody drains it is a hang, not a failure. */
export async function runAgentProgress(commandLineArguments: readonly string[], options: RunAgentProgressOptions): Promise<AgentProgressResult> {
  requireTrackerIsolation(options.currentDirectory);
  const spawned = Bun.spawn(['bun', agentProgressEntryPoint(), ...commandLineArguments], {
    cwd:    options.currentDirectory,
    stdin:  'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [standardOutput, standardError, exitCode] = await Promise.all([
    new Response(spawned.stdout).text(),
    new Response(spawned.stderr).text(),
    spawned.exited,
  ]);
  return { exitCode, standardOutput, standardError };
}
