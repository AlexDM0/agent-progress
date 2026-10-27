/**
 * Spawns the real binary for the one claim an in-process `runCommandLine` cannot make: that `agent-progress.ts` itself works, shebang, executable
 * bit and exit code included, and for a spec that must set the child's environment, which no spec may set in-process. Its callers are
 * `cli/BinarySmoke.spec.ts`, `cli/InitRootOverride.spec.ts`, `cli/dispatch/release/ReleaseCommand.checks.spec.ts`,
 * `cli/RegisterWrittenDashboard.spec.ts` and `cli/MonitorRegistryIsolation.spec.ts`.
 */
import { existsSync }               from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { environmentCopy, rootOverrideVariableOf }            from '../../src/shared/Environment.ts';
import { ORIGINAL_PRODUCT_NAMES, SIDE_BY_SIDE_PRODUCT_NAMES } from '../../src/shared/constants/ProductNames.ts';
import { createScratchDirectory, removeScratchDirectory }     from '../../src/testing/ScratchWorkspace.ts';
import { requireTrackerIsolation }                            from '../../src/testing/TrackerIsolation.ts';

export interface AgentProgressResult {
  exitCode:       number;
  standardOutput: string;
  standardError:  string;
}

export interface RunAgentProgressOptions {
  currentDirectory: string;
  /** The child's whole environment, beside a `PATH` reaching Bun and git; absent, it inherits this process's. */
  environment?:     Record<string, string>;
  standardInput?:   string;
  /** The child's `HOME`, checked to be a scratch directory; absent, a fresh scratch folder removed after the run. A `HOME` in `environment` never wins. */
  homeDirectory?:   string;
}

/** Either program's, so a spec handing the child the other program's root still cannot point it outside the scratch root. */
const ROOT_OVERRIDE_VARIABLES = [ORIGINAL_PRODUCT_NAMES, SIDE_BY_SIDE_PRODUCT_NAMES].map((productNames) => rootOverrideVariableOf(productNames));

/** Built rather than inherited, because only `src/shared/Environment.ts` reads this process's environment. */
function childEnvironmentOf(environment: Record<string, string> | undefined, homeDirectory: string): Record<string, string> {
  if (environment === undefined) return { ...environmentCopy(), HOME: homeDirectory };
  const gitExecutable = Bun.which('git');
  const searchPath    = [dirname(process.execPath), ...(gitExecutable === null ? [] : [dirname(gitExecutable)])].join(delimiter);
  return { PATH: searchPath, ...environment, HOME: homeDirectory };
}

/** The existence check is the point: a wrong number of `..` segments still resolves, and the spawn would then fail as a Bun entry-point error. */
function agentProgressEntryPoint(): string {
  const entryPoint = join(import.meta.dir, '..', '..', 'agent-progress.ts');
  if (!existsSync(entryPoint)) {
    throw new Error(`The CLI entry point is not at ${entryPoint}; cli/testing/CliProcess.ts has to be told where it moved to.`);
  }
  return entryPoint;
}

/**
 * Both streams are read to completion before the exit code is awaited, since a pipe that fills while nobody drains it is a hang, not a failure.
 * The child always gets a scratch `HOME`, so no spawned command can write the real home's monitor registry.
 */
export async function runAgentProgress(commandLineArguments: readonly string[], options: RunAgentProgressOptions): Promise<AgentProgressResult> {
  requireTrackerIsolation(options.currentDirectory);
  for (const variable of ROOT_OVERRIDE_VARIABLES) {
    const overriddenRoot = options.environment?.[variable];
    if (overriddenRoot !== undefined) requireTrackerIsolation(overriddenRoot);
  }
  if (options.homeDirectory !== undefined) requireTrackerIsolation(options.homeDirectory);
  const homeDirectory = options.homeDirectory ?? createScratchDirectory('cli-process-home');
  try {
    const spawned = Bun.spawn(['bun', agentProgressEntryPoint(), ...commandLineArguments], {
      cwd:    options.currentDirectory,
      stdin:  options.standardInput === undefined ? 'ignore' : new Blob([options.standardInput]),
      stdout: 'pipe',
      stderr: 'pipe',
      env:    childEnvironmentOf(options.environment, homeDirectory),
    });
    const [standardOutput, standardError, exitCode] = await Promise.all([
      new Response(spawned.stdout).text(),
      new Response(spawned.stderr).text(),
      spawned.exited,
    ]);
    return { exitCode, standardOutput, standardError };
  } finally {
    if (options.homeDirectory === undefined) removeScratchDirectory(homeDirectory);
  }
}
