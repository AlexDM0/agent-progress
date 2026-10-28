/**
 * A gate: one run of the stored checks line on a tree, the code the runner and the by-hand `release` share. The argv arrives built, so the
 * runner can wrap it in a sandboxed process host; it runs in a process group of its own with the job variables removed from its
 * environment, and a pass is cached by content, never by time.
 */
import type { GateOutcome }       from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecordFieldsOf } from '../../lib/tracker-model/@types/LogRecord.ts';
import {
  environmentCopy,
  JOB_ID_VARIABLE,
  RELAY_DIRECTORY_VARIABLE,
  userShell
} from '../../shared/Environment.ts';
import { gateCacheKeyOf, type GateResultCache } from './GateResultCache.ts';

export interface GateRequest {
  argv:         readonly string[];
  directory:    string;
  /** This process's environment when absent; the job variables are removed either way. */
  environment?: Readonly<Record<string, string>>;
}

export interface GateProcessRun {
  /** `null` when the gate could not be started, or ended by a signal. */
  exitCode:   number | null;
  signalCode: string | null;
  output:     string;
}

export interface TreeGateRequest extends GateRequest {
  treeId:      string;
  checksLine:  string;
  installLine: string | null;
  cache:       GateResultCache;
}

/** What a `gate-ran` record stores, and the run itself when one happened: a cache hit runs nothing. */
export type TreeGateVerdict = LogRecordFieldsOf<'gate-ran'> & { run: GateProcessRun | null };

const FALLBACK_SHELL = '/bin/sh';

// `sh` joins standard error onto standard output once, then hands the line to the user's shell, so the output keeps its order whatever shell that is.
const OUTPUT_JOINING_SCRIPT = 'exec 2>&1; exec "$0" -c "$1"';

const JOB_VARIABLES: readonly string[] = [JOB_ID_VARIABLE, RELAY_DIRECTORY_VARIABLE];

const GATE_PASSED_EXIT_CODE = 0;

// The shell's own answers for a command it found but could not execute, and for one it did not find: the line never judged the tree.
const COMMAND_NOT_EXECUTABLE_EXIT_CODE = 126;
const COMMAND_NOT_FOUND_EXIT_CODE      = 127;
const SHELL_CANNOT_RUN_EXIT_CODES: readonly number[] = [COMMAND_NOT_EXECUTABLE_EXIT_CODE, COMMAND_NOT_FOUND_EXIT_CODE];

function checksLineArgvOf(checksLine: string): string[] {
  return [FALLBACK_SHELL, '-c', OUTPUT_JOINING_SCRIPT, userShell() ?? FALLBACK_SHELL, checksLine];
}

/** Without this, every spec of a gated tree that runs a mutating verb would relay it to the runner rather than run it. */
function gateEnvironmentOf(environment: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => !JOB_VARIABLES.includes(name)));
}

async function runGate({ argv, directory, environment }: GateRequest): Promise<GateProcessRun> {
  try {
    const gateProcess = Bun.spawn({
      cmd:      [...argv],
      cwd:      directory,
      env:      gateEnvironmentOf(environment ?? environmentCopy()),
      // A process group of its own, so a checks line's `kill 0` reaches only the gate.
      detached: true,
      stdin:    'ignore',
      stdout:   'pipe',
      stderr:   'pipe',
    });
    const [output, errorOutput, exitCode] = await Promise.all([
      new Response(gateProcess.stdout).text(),
      new Response(gateProcess.stderr).text(),
      gateProcess.exited,
    ]);
    const signalCode = gateProcess.signalCode ?? null;
    return { exitCode: signalCode === null ? exitCode : null, signalCode, output: output + errorOutput };
  } catch (error) {
    return { exitCode: null, signalCode: null, output: error instanceof Error ? error.message : String(error) };
  }
}

function gateOutcomeOf(run: GateProcessRun): GateOutcome {
  if (run.exitCode === GATE_PASSED_EXIT_CODE) return 'passed';
  if (run.exitCode === null || SHELL_CANNOT_RUN_EXIT_CODES.includes(run.exitCode)) return 'cannot-run';
  return 'failed';
}

/** Only a pass is cached: a failure or a gate that could not run is judged again on the next attempt. */
async function gateTree(request: TreeGateRequest): Promise<TreeGateVerdict> {
  const {
    treeId, checksLine, installLine, cache
  } = request;
  const key                                        = gateCacheKeyOf({ treeId, checksLine, installLine });
  if (cache.holdsPassOf(key)) return {
    tree: treeId, outcome: 'passed', cached: true, run: null
  };
  const run     = await runGate(request);
  const outcome = gateOutcomeOf(run);
  if (outcome === 'passed') cache.recordPass(key, { treeId, checksLine, installLine });
  return {
    tree: treeId, outcome, cached: false, run
  };
}

export const GateRun = Object.freeze({
  checksLineArgvOf,
  gateEnvironmentOf,
  gateOutcomeOf,
  gateTree,
  runGate,
});
