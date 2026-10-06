/**
 * Every agent call the bundle makes in every scenario under `dispatcher/testing/claims/`. A host may answer a call alike in prompt and options from
 * the first such call's answer, so two calls of one run that say the same must mean the same: a rebuild, a rework round or a retaken review is told
 * apart from the call before it. Only a resumed run repeats a call its kill left unanswered, which is the same call by design. Every prompt opens
 * with the paragraph saying a relayed user message is not addressed to the agent, and names no tool that only one host has.
 */
import { describe, expect, test } from 'bun:test';

import type { DispatchScenario }                   from './testing/@types/DispatchScenario.ts';
import type { AgentKind, RecordedAgentCall }       from './testing/@types/RecordedDispatchRun.ts';
import { builtScriptTextOf, bundleDispatchScript } from './testing/DispatchScriptBundle.ts';
import { runDispatchScript }                       from './testing/DispatchScriptHarness.ts';
import { DECISION_CLAIMS, DECISION_SCENARIOS }     from './testing/claims/DecisionClaims.ts';
import { GROUP_CLAIMS }                            from './testing/claims/GroupClaims.ts';
import { HOLD_CLAIMS }                             from './testing/claims/HoldClaims.ts';
import { RESUMPTION_CLAIMS }                       from './testing/claims/ResumptionClaims.ts';
import { AGENT_PROMPT_SENTENCES }                  from './testing/constants/AgentPromptSentences.ts';

const BUNDLE = await bundleDispatchScript();

const CLAIM_SCENARIOS: readonly (readonly [string, () => DispatchScenario])[] = [
  ...[...DECISION_CLAIMS, ...GROUP_CLAIMS, ...HOLD_CLAIMS, ...RESUMPTION_CLAIMS].map((claim) => [claim.name, claim.scenarioFor] as const),
  ...Object.entries(DECISION_SCENARIOS),
];

const HOST_ONLY_TOOL_NAMES = ['Monitor', 'run_in_background', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'StructuredOutput', 'AskUserQuestion', 'TodoWrite', 'WebFetch'];

const EVERY_PROMPT_KIND: AgentKind[] = ['survey', 'settings', 'build', 'review', 'park'];

interface ScenarioCalls {
  scenarioName: string;
  calls:        RecordedAgentCall[];
}

async function callsOfEveryScenario(): Promise<ScenarioCalls[]> {
  const scriptText = builtScriptTextOf(BUNDLE);
  const everyScenarioCalls: ScenarioCalls[] = [];
  for (const [scenarioName, scenarioFor] of CLAIM_SCENARIOS) {
    const run = await runDispatchScript(scenarioFor(), scriptText);
    everyScenarioCalls.push({ scenarioName, calls: run.calls });
  }
  return everyScenarioCalls;
}

const EVERY_SCENARIO_CALLS = await callsOfEveryScenario();

const EVERY_CALL = EVERY_SCENARIO_CALLS.flatMap((scenarioCalls) => scenarioCalls.calls);

function memoisationKeyOf(call: RecordedAgentCall): string {
  return JSON.stringify([call.run, call.generation, call.prompt, call.model, call.effort, call.label, call.phase, call.agentType, call.schema]);
}

function callNameOf(call: RecordedAgentCall): string {
  return `${call.run} ${call.kind} ${call.ticketId ?? ''} #${call.ordinal ?? ''}`;
}

function alikeCallsOf(calls: readonly RecordedAgentCall[]): string[] {
  const callNamesByKey = new Map<string, string[]>();
  for (const call of calls) {
    const key = memoisationKeyOf(call);
    callNamesByKey.set(key, [...callNamesByKey.get(key) ?? [], callNameOf(call)]);
  }
  return [...callNamesByKey.values()].filter((callNames) => callNames.length > 1).map((callNames) => callNames.join(' = '));
}

describe('every agent call of the dispatcher, over every claim scenario', () => {
  test('the walk reaches every scenario and every kind of prompt', () => {
    expect(EVERY_SCENARIO_CALLS.length).toBe(CLAIM_SCENARIOS.length);
    expect(CLAIM_SCENARIOS.length).toBeGreaterThan(100);
    expect([...new Set(EVERY_CALL.map((call) => call.kind))].sort()).toEqual([...EVERY_PROMPT_KIND].sort());
  });

  test('no two calls of one run say the same in prompt and options', () => {
    const alikeCalls = EVERY_SCENARIO_CALLS.flatMap(({ scenarioName, calls }) => alikeCallsOf(calls).map((alike) => `${scenarioName}: ${alike}`));
    expect(alikeCalls).toEqual([]);
  });

  test('a rebuild in the same run is labelled apart from the ticket\'s build before it', () => {
    let rebuildsSeen = 0;
    for (const { calls } of EVERY_SCENARIO_CALLS) {
      const builds = calls.filter((call) => call.kind === 'build');
      for (const rebuild of builds.filter((call) => (call.ordinal ?? 1) > 1)) {
        const earlierBuilds = builds.filter((call) => call.run === rebuild.run && call.generation === rebuild.generation && call.ticketId === rebuild.ticketId
          && (call.ordinal ?? 1) < (rebuild.ordinal ?? 1));
        if (earlierBuilds.length > 0) rebuildsSeen++;
        expect(earlierBuilds.map((call) => call.label)).not.toContain(rebuild.label);
      }
    }
    expect(rebuildsSeen).toBeGreaterThan(0);
  });

  test(`every prompt of the ${EVERY_PROMPT_KIND.length} kinds opens with the paragraph saying a relayed user message is not addressed to the agent`, () => {
    for (const kind of EVERY_PROMPT_KIND) {
      const callsOfKind = EVERY_CALL.filter((call) => call.kind === kind);
      expect(callsOfKind.length).toBeGreaterThan(0);
      expect(callsOfKind.filter((call) => !call.prompt.startsWith(AGENT_PROMPT_SENTENCES.RELAYED_MESSAGE_PREAMBLE_OPENING)).map(callNameOf)).toEqual([]);
    }
  });

  test('no prompt names a tool only one host has', () => {
    const namedTools = HOST_ONLY_TOOL_NAMES.filter((toolName) => EVERY_CALL.some((call) => new RegExp(`\\b${toolName}\\b`).test(call.prompt)));
    expect(namedTools).toEqual([]);
  });
});
