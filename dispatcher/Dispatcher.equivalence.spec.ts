/**
 * The TypeScript port, bundled, does exactly what the old dispatcher script did on every catalogued scenario: every agent call with its options,
 * its prompt and where it falls among the logs, every phase, every log line, the summary and the board it leaves. The frozen table is that
 * script's own record, so a difference is a change of behaviour. The key check and the floors keep a catalogue that shrank from passing by
 * comparing less; a prompt that differs is shown as a line diff, since its digest alone says nothing.
 */
import { describe, expect, test } from 'bun:test';

import { builtScriptTextOf, bundleDispatchScript }     from './testing/DispatchScriptBundle.ts';
import { runDispatchScript, type RecordedDispatchRun } from './testing/DispatchScriptHarness.ts';
import { digestOf, promptDigestOfCallText, traceOf }   from './testing/DispatchTrace.ts';
import { readFrozenDispatchTraces }                    from './testing/DispatchTraceCapture.ts';
import { dispatchTraceCatalogue }                      from './testing/DispatchTraceCatalogue.ts';

// A little under the frozen table's size, so a retake may grow it but a catalogue that shrank fails.
const CATALOGUE_ENTRIES_FLOOR = 197;
const AGENT_CALLS_COMPARED_FLOOR = 1170;

const FROZEN_TABLE = readFrozenDispatchTraces();

const CATALOGUE = dispatchTraceCatalogue();

function frozenTraceOf(key: string): (typeof FROZEN_TABLE.traces)[string] | undefined {
  return Object.hasOwn(FROZEN_TABLE.traces, key) ? FROZEN_TABLE.traces[key] : undefined;
}

function frozenPromptOf(promptDigest: string): string {
  return Object.hasOwn(FROZEN_TABLE.promptTexts, promptDigest) ? FROZEN_TABLE.promptTexts[promptDigest] ?? '' : '';
}

function lineDiffOf(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const differingLines: string[] = [];
  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined) differingLines.push(`- ${oldLine}`);
    if (newLine !== undefined) differingLines.push(`+ ${newLine}`);
  }
  return differingLines.join('\n');
}

function promptDiffsOf(run: RecordedDispatchRun, frozenCalls: readonly string[]): string {
  const promptDiffs: string[] = [];
  run.calls.forEach((call, callIndex) => {
    const frozenCallText = frozenCalls[callIndex];
    const frozenPromptDigest = frozenCallText === undefined ? undefined : promptDigestOfCallText(frozenCallText);
    if (frozenPromptDigest === undefined || frozenPromptDigest === digestOf(call.prompt)) return;
    promptDiffs.push(`call ${callIndex} (${call.run} ${call.kind} ${call.ticketId ?? ''}):\n${lineDiffOf(frozenPromptOf(frozenPromptDigest), call.prompt)}`);
  });
  return promptDiffs.join('\n\n');
}

describe('the bundled TypeScript dispatcher against the frozen table of the old script', () => {
  test('bundles into one Workflow script', async () => {
    expect((await bundleDispatchScript()).verdict).toBe('built');
  });

  test('is run on exactly the table\'s entries, no fewer than it held when taken', () => {
    const catalogueKeys = CATALOGUE.map((entry) => entry.key).sort();
    expect(catalogueKeys).toEqual(Object.keys(FROZEN_TABLE.traces).sort());
    expect(catalogueKeys.length).toBeGreaterThanOrEqual(CATALOGUE_ENTRIES_FLOOR);
    const agentCallsCompared = CATALOGUE.reduce((callCount, entry) => callCount + (frozenTraceOf(entry.key)?.calls.length ?? 0), 0);
    expect(agentCallsCompared).toBeGreaterThanOrEqual(AGENT_CALLS_COMPARED_FLOOR);
  });

  for (const entry of CATALOGUE) {
    test(`reproduces ${entry.key}`, async () => {
      const frozenTrace = frozenTraceOf(entry.key);
      if (frozenTrace === undefined) throw new Error(`${entry.key} is not in the table`);
      const run = await runDispatchScript(entry.scenarioFor(), builtScriptTextOf(await bundleDispatchScript()));
      expect(traceOf(run), promptDiffsOf(run, frozenTrace.calls)).toEqual(frozenTrace);
    });
  }
});
