/** Runs the tracker's check command in a directory as the lifecycle's gate runs it, and words what the run ended with. */
import { GateRun, type GateProcessRun } from '../../src/services/lifecycle/GateRun.ts';

export type CheckRun = GateProcessRun;

export const CHECK_OUTPUT_TAIL_LINES = 20;

export async function runCheckCommand(checkCommand: string, directory: string): Promise<CheckRun> {
  return await GateRun.runGate({ argv: GateRun.checksLineArgvOf(checkCommand), directory });
}

export function checkRunPassed(checkRun: CheckRun): boolean {
  return GateRun.gateOutcomeOf(checkRun) === 'passed';
}

export function checkRunOutcomeText(checkRun: CheckRun): string {
  if (checkRun.signalCode !== null) return `was ended by ${checkRun.signalCode}`;
  return checkRun.exitCode === null ? 'could not be started' : `exited ${checkRun.exitCode}`;
}

export function lastLinesOf(output: string): string {
  return output.trimEnd().split('\n').slice(-CHECK_OUTPUT_TAIL_LINES).join('\n');
}
