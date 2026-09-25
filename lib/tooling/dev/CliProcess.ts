/**
 * Spawns the real binary for the one claim an in-process `runCommandLine` cannot make: that `agent-progress.ts` itself works, shebang, executable
 * bit and exit code included, and for a spec that must set the child's environment, which no spec may set in-process. Its callers are
 * `cli/BinarySmoke.spec.ts` and `cli/InitRootOverride.spec.ts`.
 */
import { existsSync }               from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { requireTrackerIsolation } from './TrackerIsolation';

export interface AgentProgressResult {
  exitCode:       number;
  standardOutput: string;
  standardError:  string;
}

export interface RunAgentProgressOptions {
  currentDirectory: string;
  /** The child's whole environment, beside a `PATH` reaching Bun and git; absent, it inherits this process's. */
  environment?:     Record<string, string>;
}

const ROOT_OVERRIDE_VARIABLE = 'AGENT_PROGRESS_ROOT';

/** Built rather than inherited, because `lib/EnvironmentReads.spec.ts` forbids reading this process's environment here. */
function childEnvironmentOf(environment: Record<string, string>): Record<string, string> {
  const gitExecutable = Bun.which('git');
  const searchPath    = [dirname(process.execPath), ...(gitExecutable === null ? [] : [dirname(gitExecutable)])].join(delimiter);
  return { PATH: searchPath, ...environment };
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
  const overriddenRoot = options.environment?.[ROOT_OVERRIDE_VARIABLE];
  if (overriddenRoot !== undefined) requireTrackerIsolation(overriddenRoot);
  const spawned = Bun.spawn(['bun', agentProgressEntryPoint(), ...commandLineArguments], {
    cwd:    options.currentDirectory,
    stdin:  'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    ...(options.environment === undefined ? {} : { env: childEnvironmentOf(options.environment) }),
  });
  const [standardOutput, standardError, exitCode] = await Promise.all([
    new Response(spawned.stdout).text(),
    new Response(spawned.stderr).text(),
    spawned.exited,
  ]);
  return { exitCode, standardOutput, standardError };
}
