/**
 * Captures the frozen dispatch trace table from a dispatcher script's text: every catalogue entry run through the harness, reduced to its
 * trace. Run as a script, it prints the table for `dispatcher/testing/FrozenDispatchTraces.json`.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { runDispatchScript, type DispatchScenario } from './DispatchScriptHarness';
import { digestOf, traceOf, type DispatchTrace }    from './DispatchTrace';
import {
  KEPT_CRASH_KEYS,
  LEVERS_READ_AS_THEIR_BASE,
  REFUSED_ARGUMENT_KEYS,
  dispatchTraceCatalogue,
  type CatalogueEntry,
} from './DispatchTraceCatalogue';
import { metaLiteralVerdictOf } from './WorkflowScriptSource';

export interface FrozenDispatchTraces {
  takenFrom:   { scriptPath: string; commit: string; scriptDigest: string };
  /** The command that retakes this table, stated in the table itself. */
  retake:      string;
  meta:        unknown;
  traces:      Record<string, DispatchTrace>;
  /** Every distinct prompt, once, by its digest in the traces' calls. */
  promptTexts: Record<string, string>;
}

const OLD_SCRIPT_PATH = 'templates/workflows/AgentProgressDispatch.js';

const FROZEN_TABLE_PATH = 'dispatcher/testing/FrozenDispatchTraces.json';

const LEVER_KEY_OPENING = 'lever: ';

function retakeCommandFor(commit: string): string {
  return `git show ${commit}:${OLD_SCRIPT_PATH} > <scratch>/AgentProgressDispatch.js`
    + ` && bun dispatcher/testing/DispatchTraceCapture.ts <scratch>/AgentProgressDispatch.js ${commit} > ${FROZEN_TABLE_PATH}`;
}

// Evaluated only once the purity walk has found nothing but literals in it, so no code of the script runs.
function metaValueOf(scriptSource: string): unknown {
  const verdict = metaLiteralVerdictOf(scriptSource);
  if (verdict.verdict !== 'pure') throw new Error(`The script's meta is not a pure literal: ${JSON.stringify(verdict)}.`);
  const literalText = /^export const meta = (\{[\s\S]*?\n\});\n/.exec(scriptSource)?.[1];
  if (literalText === undefined) throw new Error('The script\'s meta literal was not found where the purity walk found it.');
  const metaValue: unknown = new Function(`return ${literalText};`)();
  return metaValue;
}

function scenarioWithoutMisbehaviour(scenario: DispatchScenario): DispatchScenario {
  const { agentMisbehaviour, ...unmisbehavedScenario } = scenario;
  return unmisbehavedScenario;
}

async function leverProblemsOf(entry: CatalogueEntry, trace: DispatchTrace, scriptSource: string): Promise<string[]> {
  const scenario = entry.scenarioFor();
  const { agentMisbehaviour } = scenario;
  if (agentMisbehaviour === undefined) return [`${entry.key} misbehaves no agent`];
  let misbehavioursApplied = 0;
  await runDispatchScript({
    ...scenario,
    agentMisbehaviour: (call) => {
      const misbehaviour = agentMisbehaviour(call);
      if (misbehaviour !== undefined) misbehavioursApplied++;
      return misbehaviour;
    },
  }, scriptSource);
  const baseTrace = traceOf(await runDispatchScript(scenarioWithoutMisbehaviour(entry.scenarioFor()), scriptSource));
  const traceEqualsItsBase = JSON.stringify(baseTrace) === JSON.stringify(trace);
  const leverIsReadAsItsBase = (LEVERS_READ_AS_THEIR_BASE as readonly string[]).includes(entry.key);
  const problems: string[] = [];
  if (misbehavioursApplied === 0) problems.push(`${entry.key} reached no agent it misbehaves`);
  if (leverIsReadAsItsBase && !traceEqualsItsBase) problems.push(`${entry.key} is listed as read as its base, but its trace differs from it`);
  if (!leverIsReadAsItsBase && traceEqualsItsBase) problems.push(`${entry.key} leaves the trace as its base's`);
  return problems;
}

async function catalogueProblemsOf(entries: readonly CatalogueEntry[], traces: Record<string, DispatchTrace>, scriptSource: string): Promise<string[]> {
  const traceOfKey = (key: string): DispatchTrace | undefined => (Object.hasOwn(traces, key) ? traces[key] : undefined);
  const problems: string[] = [];
  for (const key of REFUSED_ARGUMENT_KEYS) {
    if ((traceOfKey(key)?.threw ?? null) === null) problems.push(`${key} did not refuse its arguments`);
  }
  for (const key of KEPT_CRASH_KEYS) {
    if (traceOfKey(key)?.threw !== 'TypeError') problems.push(`${key} did not crash with a TypeError`);
  }
  const listedLeverKeys: readonly string[] = [...LEVERS_READ_AS_THEIR_BASE, ...KEPT_CRASH_KEYS];
  for (const key of listedLeverKeys) {
    if (!entries.some((entry) => entry.key === key)) problems.push(`${key} is listed but not catalogued`);
  }
  for (const entry of entries) {
    const trace = traceOfKey(entry.key);
    if (entry.key.startsWith(LEVER_KEY_OPENING) && trace !== undefined) problems.push(...await leverProblemsOf(entry, trace, scriptSource));
  }
  return problems;
}

/** Throws when the catalogue fails its own sanity checks, so a table whose levers reach nothing is never written. */
export async function captureDispatchTraces(scriptSource: string, takenFrom: FrozenDispatchTraces['takenFrom']): Promise<FrozenDispatchTraces> {
  const entries = dispatchTraceCatalogue();
  const traces: Record<string, DispatchTrace> = {};
  const promptTexts: Record<string, string> = {};
  for (const entry of entries) {
    const run = await runDispatchScript(entry.scenarioFor(), scriptSource);
    traces[entry.key] = traceOf(run);
    for (const call of run.calls) {
      const promptDigest = digestOf(call.prompt);
      if (!Object.hasOwn(promptTexts, promptDigest)) promptTexts[promptDigest] = call.prompt;
    }
  }
  const problems = await catalogueProblemsOf(entries, traces, scriptSource);
  if (problems.length > 0) throw new Error(`The dispatch trace catalogue fails its sanity checks:\n${problems.join('\n')}`);
  return {
    takenFrom,
    retake: retakeCommandFor(takenFrom.commit),
    meta:   metaValueOf(scriptSource),
    traces,
    promptTexts,
  };
}

export function readFrozenDispatchTraces(): FrozenDispatchTraces {
  return JSON.parse(readFileSync(join(import.meta.dir, 'FrozenDispatchTraces.json'), 'utf8')) as FrozenDispatchTraces;
}

if (import.meta.main) {
  const [scriptFilePath, commit] = Bun.argv.slice(2);
  if (scriptFilePath === undefined || commit === undefined) throw new Error('Usage: bun dispatcher/testing/DispatchTraceCapture.ts <script file> <commit>');
  const scriptSource = readFileSync(scriptFilePath, 'utf8');
  const table = await captureDispatchTraces(scriptSource, { scriptPath: OLD_SCRIPT_PATH, commit, scriptDigest: digestOf(scriptSource) });
  process.stdout.write(`${JSON.stringify(table, null, 2)}\n`);
}
