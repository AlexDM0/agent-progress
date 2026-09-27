/**
 * Captures the frozen dispatch trace table from a dispatcher script's text: every catalogue entry run through the harness, reduced to its
 * trace. Run as a script at the commit that holds the table, it bundles the TypeScript port and prints the table for
 * `dispatcher/testing/FrozenDispatchTraces.json`.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { DISPATCHER_SCRIPT_BUILD }                 from '../../src/shared/DispatcherScriptBuildRequest.ts';
import type { DispatchScenario }                   from './@types/DispatchScenario.ts';
import type { DispatchTrace }                      from './@types/DispatchTrace.ts';
import { builtScriptTextOf, bundleDispatchScript } from './DispatchScriptBundle.ts';
import { runDispatchScript }                       from './DispatchScriptHarness.ts';
import {
  KEPT_CRASH_KEYS,
  LEVERS_READ_AS_THEIR_BASE,
  REFUSED_ARGUMENT_KEYS,
  dispatchTraceCatalogue,
  type CatalogueEntry,
} from './DispatchTraceCatalogue.ts';
import { DispatchTraceUtil }        from './utils/DispatchTraceUtil.ts';
import { WorkflowScriptSourceUtil } from './utils/WorkflowScriptSourceUtil.ts';

export interface FrozenDispatchTraces {
  /** A bundle is named by its digest, since a table retaken in the commit that changes the port cannot name that commit. */
  takenFrom:   { scriptPath: string; scriptDigest: string };
  /** The command that retakes this table, stated in the table itself. */
  retake:      string;
  meta:        unknown;
  traces:      Record<string, DispatchTrace>;
  /** Every distinct prompt, once, by its digest in the traces' calls. */
  promptTexts: Record<string, string>;
}

export const BUNDLE_ENTRY_PATH = `dispatcher/${DISPATCHER_SCRIPT_BUILD.ENTRY_FILE_NAME}`;

export const RETAKE_COMMAND = 'bun dispatcher/testing/DispatchTraceCapture.ts > dispatcher/testing/FrozenDispatchTraces.json';

const LEVER_KEY_OPENING = 'lever: ';

const TRACE_TABLE_INDENT_SPACES = 2;

function metaValueOf(scriptSource: string): unknown {
  const metaRead = WorkflowScriptSourceUtil.metaLiteralValueOf(scriptSource);
  if (metaRead.verdict !== 'value') throw new Error(`The script's meta is not a pure literal: ${JSON.stringify(WorkflowScriptSourceUtil.metaLiteralVerdictOf(scriptSource))}.`);
  return metaRead.value;
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
  const baseTrace = DispatchTraceUtil.traceOf(await runDispatchScript(scenarioWithoutMisbehaviour(entry.scenarioFor()), scriptSource));
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
async function captureDispatchTraces(scriptSource: string, takenFrom: FrozenDispatchTraces['takenFrom']): Promise<FrozenDispatchTraces> {
  const entries = dispatchTraceCatalogue();
  const traces: Record<string, DispatchTrace> = {};
  const promptTexts: Record<string, string> = {};
  for (const entry of entries) {
    const run = await runDispatchScript(entry.scenarioFor(), scriptSource);
    traces[entry.key] = DispatchTraceUtil.traceOf(run);
    for (const call of run.calls) {
      const promptDigest = DispatchTraceUtil.digestOf(call.prompt);
      if (!Object.hasOwn(promptTexts, promptDigest)) promptTexts[promptDigest] = call.prompt;
    }
  }
  const problems = await catalogueProblemsOf(entries, traces, scriptSource);
  if (problems.length > 0) throw new Error(`The dispatch trace catalogue fails its sanity checks:\n${problems.join('\n')}`);
  return {
    takenFrom,
    retake: RETAKE_COMMAND,
    meta:   metaValueOf(scriptSource),
    traces,
    promptTexts,
  };
}

export function readFrozenDispatchTraces(): FrozenDispatchTraces {
  return JSON.parse(readFileSync(join(import.meta.dir, 'FrozenDispatchTraces.json'), 'utf8')) as FrozenDispatchTraces;
}

if (import.meta.main) {
  const scriptText = builtScriptTextOf(await bundleDispatchScript());
  const table = await captureDispatchTraces(scriptText, { scriptPath: BUNDLE_ENTRY_PATH, scriptDigest: DispatchTraceUtil.digestOf(scriptText) });
  process.stdout.write(`${JSON.stringify(table, null, TRACE_TABLE_INDENT_SPACES)}\n`);
}
