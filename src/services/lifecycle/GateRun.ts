/**
 * The gate pipeline run on a tree, the code the runner's build, review and merge gates share: the prepare steps, then each gate in list
 * order, the first red one stopping the rest. Each argv arrives built and confined by the caller; a step runs in a process group of its own
 * with the job variables removed from its environment. agent-progress keeps no gate result: caching is the repository's own tooling's.
 */
import { join } from 'node:path';

import { GitProcess }                      from '../../lib/git/GitProcess.ts';
import type { GateOutcome }                from '../../lib/tracker-model/@types/Job.ts';
import type { PipelineGate, PipelineStep } from '../../lib/tracker-model/@types/Pipeline.ts';
import {
  environmentCopy,
  JOB_ID_VARIABLE,
  RELAY_DIRECTORY_VARIABLE,
  userShell
} from '../../shared/Environment.ts';

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

/** What one step may reach besides its tree and temp: the network when it names domains (a prepare step always), and the folders it writes. */
export interface GateConfinement {
  network:        boolean;
  networkDomains: readonly string[];
  writes:         readonly string[];
}

export interface PipelineRunRequest {
  prepare:          readonly PipelineStep[];
  gates:            readonly PipelineGate[];
  /** The checkout of the tree the pipeline judges; a gate's `in` is relative to it. */
  directory:        string;
  environment?:     Readonly<Record<string, string>>;
  /** Wraps a step's argv in its confinement; the argv itself when absent. */
  confinedArgvOf?:  (argv: readonly string[], confinement: GateConfinement) => readonly string[];
  /** Waits for one of the machine's gate run slots and answers its release; prepare steps take none. */
  acquireGateSlot?: () => Promise<() => void>;
}

export type PipelineVerdict =
  | { outcome: 'setup-failed'; step: string; output: string; gatesRun: string[] }
  | { outcome: 'passed'; gatesRun: string[] }
  | { outcome: Exclude<GateOutcome, 'passed'>; gate: string; output: string; gatesRun: string[] };

const FALLBACK_SHELL = '/bin/sh';

// `sh` joins standard error onto standard output once, then hands the line to the user's shell, so the output keeps its order whatever shell that is.
const OUTPUT_JOINING_SCRIPT = 'exec 2>&1; exec "$0" -c "$1"';

const JOB_VARIABLES: readonly string[] = [JOB_ID_VARIABLE, RELAY_DIRECTORY_VARIABLE];

const GATE_PASSED_EXIT_CODE = 0;

// The shell's own answers for a command it found but could not execute, and for one it did not find: the line never judged the tree.
const COMMAND_NOT_EXECUTABLE_EXIT_CODE = 126;
const COMMAND_NOT_FOUND_EXIT_CODE      = 127;
const SHELL_CANNOT_RUN_EXIT_CODES: readonly number[] = [COMMAND_NOT_EXECUTABLE_EXIT_CODE, COMMAND_NOT_FOUND_EXIT_CODE];

function shellLineArgvOf(line: string): string[] {
  return [FALLBACK_SHELL, '-c', OUTPUT_JOINING_SCRIPT, userShell() ?? FALLBACK_SHELL, line];
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

/** The diff of every tracked file a step changed against HEAD; empty when the tree is as it was. */
function trackedChangesOf(directory: string): string {
  const run = GitProcess.run(directory, ['diff', '--no-ext-diff', 'HEAD', '--']);
  return GitProcess.succeeded(run) ? run.standardOutput : '';
}

/** A gate passes only when it exits 0 and leaves the tree unchanged. */
function gateOutcomeOf(run: GateProcessRun, trackedChanges = ''): GateOutcome {
  if (run.exitCode === null || SHELL_CANNOT_RUN_EXIT_CODES.includes(run.exitCode)) return 'cannot-run';
  return run.exitCode === GATE_PASSED_EXIT_CODE && trackedChanges === '' ? 'passed' : 'failed';
}

/** A gate that exited 0 but changed the tree reports the diff; any other run its own output. */
function gateErrorOutputOf(run: GateProcessRun, trackedChanges: string): string {
  return run.exitCode === GATE_PASSED_EXIT_CODE && trackedChanges !== '' ? trackedChanges : run.output;
}

function gateDirectoryOf(directory: string, gate: Readonly<PipelineGate>): string {
  return gate.in === undefined ? directory : join(directory, gate.in);
}

function gateConfinementOf(gate: Readonly<PipelineGate>): GateConfinement {
  const networkDomains = gate.network ?? [];
  return { network: networkDomains.length > 0, networkDomains, writes: gate.writes ?? [] };
}

/** A prepare step installs, so it reaches the network and writes every folder a gate may. */
function prepareConfinementOf(gates: readonly PipelineGate[]): GateConfinement {
  return { network: true, networkDomains: [], writes: [...new Set(gates.flatMap((gate) => gate.writes ?? []))] };
}

/** A prepare step that does not exit 0 is a setup failure, never a red gate; the Overseer never runs a gate's `fix`. */
async function runPipeline(request: PipelineRunRequest): Promise<PipelineVerdict> {
  const confinedArgvOf = request.confinedArgvOf ?? ((argv: readonly string[]) => argv);
  const environment = request.environment === undefined ? {} : { environment: request.environment };
  const prepareConfinement = prepareConfinementOf(request.gates);
  for (const step of request.prepare) {
    const run = await runGate({ argv: confinedArgvOf(shellLineArgvOf(step.run), prepareConfinement), directory: request.directory, ...environment });
    if (run.exitCode !== GATE_PASSED_EXIT_CODE) return {
      outcome: 'setup-failed', step: step.name, output: run.output, gatesRun: []
    };
  }
  const gatesRun: string[] = [];
  for (const gate of request.gates) {
    const releaseGateSlot = request.acquireGateSlot === undefined ? null : await request.acquireGateSlot();
    let run: GateProcessRun;
    try {
      gatesRun.push(gate.name);
      run = await runGate({ argv: confinedArgvOf(shellLineArgvOf(gate.run), gateConfinementOf(gate)), directory: gateDirectoryOf(request.directory, gate), ...environment });
    } finally {
      releaseGateSlot?.();
    }
    const trackedChanges = trackedChangesOf(request.directory);
    const outcome = gateOutcomeOf(run, trackedChanges);
    if (outcome !== 'passed') return {
      outcome, gate: gate.name, output: gateErrorOutputOf(run, trackedChanges), gatesRun
    };
  }
  return { outcome: 'passed', gatesRun };
}

export const GateRun = Object.freeze({
  shellLineArgvOf,
  gateEnvironmentOf,
  gateOutcomeOf,
  gateErrorOutputOf,
  gateDirectoryOf,
  gateConfinementOf,
  prepareConfinementOf,
  trackedChangesOf,
  runGate,
  runPipeline,
});
