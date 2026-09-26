/**
 * The guards that read the text of the committed old script, `templates/workflows/AgentProgressDispatch.js`, which `init` and `update` still install
 * until plan step 8 generates the script from the TypeScript port and deletes these with it. They pin what the old script states for itself: the
 * tool's default model, effort and ceiling, a model and effort at every agent site, the held tickets in every status block, and a body the Workflow
 * tool can run without a clock and a `meta` it can read without running it.
 */
import { describe, expect, test } from 'bun:test';

import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL }       from '../../src/lib/tracker-model/constants/AgentSettings.ts';
import { LIMITS }                                          from '../../src/shared/constants/Limits.ts';
import { agentBriefNumbers, numberIn }                     from './AgentBriefNumbers.ts';
import { runDispatchScript }                               from './DispatchScriptHarness.ts';
import { readDispatchScript }                              from './OldDispatchScript.ts';
import { metaLiteralVerdictOf, nondeterministicCallsIn }   from './WorkflowScriptSource.ts';
import { DECISION_SCENARIOS, modelsAndEffortsAreExplicit } from './claims/DecisionClaims.ts';

const SCRIPT_SOURCE = readDispatchScript();

/** Each site that starts an agent, with its model or its effort taken out: four sites, eight forms. */
const AGENT_OPTIONS_LEFT_OUT: [string, string][] = [
  ['    model:  SURVEY_MODEL,\n    effort: SURVEY_EFFORT,', '    effort: SURVEY_EFFORT,'],
  ['    model:  SURVEY_MODEL,\n    effort: SURVEY_EFFORT,', '    model:  SURVEY_MODEL,'],
  ['      model:  PARKING_MODEL,\n      effort: PARKING_EFFORT,', '      effort: PARKING_EFFORT,'],
  ['      model:  PARKING_MODEL,\n      effort: PARKING_EFFORT,', '      model:  PARKING_MODEL,'],
  ['schema: BUILDER_SCHEMA,\n      model,\n      effort,', 'schema: BUILDER_SCHEMA,\n      effort,'],
  ['schema: BUILDER_SCHEMA,\n      model,\n      effort,', 'schema: BUILDER_SCHEMA,\n      model,'],
  ['schema: REVIEWER_SCHEMA,\n    model,\n    effort,', 'schema: REVIEWER_SCHEMA,\n    effort,'],
  ['schema: REVIEWER_SCHEMA,\n    model,\n    effort,', 'schema: REVIEWER_SCHEMA,\n    model,'],
];

/** The real script's closing log line, where a planted form stands inside the body the Workflow tool would run. */
const PLANTING_POINT = 'log(`Done: ';

function scriptConstantOf(name: string): string | null {
  return new RegExp(`^const ${name} = '(\\w+)';$`, 'm').exec(SCRIPT_SOURCE)?.[1] ?? null;
}

describe('the dispatcher script', () => {
  test.each(AGENT_OPTIONS_LEFT_OUT)('an agent started without its model or effort (%s → %s) fails the check', async (find, replace) => {
    expect(SCRIPT_SOURCE.split(find).length - 1).toBe(1);
    expect(modelsAndEffortsAreExplicit(await runDispatchScript(DECISION_SCENARIOS['every kind of agent runs'](), SCRIPT_SOURCE.replace(find, replace)))).toBe(false);
  });

  test('the four sites above are every agent the script starts: one agent() call, reached through runAgent from four places', () => {
    expect(SCRIPT_SOURCE.split(/\bagent\(/).length - 1).toBe(1);
    expect(SCRIPT_SOURCE.split('await agent(prompt, options)').length - 1).toBe(1);
    expect(SCRIPT_SOURCE.split('runAgent(').length - 1).toBe(1 + AGENT_OPTIONS_LEFT_OUT.length / 2);
  });

  // The script is plain JavaScript in another repository and cannot import the tool's defaults, so it states its own and they must not drift.
  test('the script falls back to the same default model and effort as the tool, and runs the survey and parking agents on haiku at low', () => {
    expect(scriptConstantOf('DEFAULT_WORKER_MODEL')).toBe(DEFAULT_AGENT_MODEL);
    expect(scriptConstantOf('DEFAULT_WORKER_EFFORT')).toBe(DEFAULT_AGENT_EFFORT);
    expect([scriptConstantOf('SURVEY_MODEL'), scriptConstantOf('SURVEY_EFFORT')]).toEqual(['haiku', 'low']);
    expect([scriptConstantOf('PARKING_MODEL'), scriptConstantOf('PARKING_EFFORT')]).toEqual(['haiku', 'low']);
  });

  // The same drift for the limit: a script ceiling above the tool's would run more agents than `concurrency` ever lets the user store.
  test('the script caps the board limit at the same ceiling as the tool', () => {
    const statedCeiling = /^const CONCURRENCY_CEILING_AGENTS = (\d+);$/m.exec(SCRIPT_SOURCE)?.[1] ?? null;
    expect(statedCeiling).toBe(String(LIMITS.CONCURRENCY_LIMIT_CEILING_AGENTS));
  });
});

describe('the dispatcher script and a held ticket', () => {
  test('every agent is told to return heldTicketIds with the concurrency block, and the schema requires it', () => {
    expect(SCRIPT_SOURCE).toContain('(limit, agentsInFlight, freeSlots, readyTicketIds, dispatcherState, heldTicketIds)');
    expect(SCRIPT_SOURCE).toMatch(/required: \[[^\]]*'heldTicketIds'\]/);
  });
});

describe('the dispatcher and the agent brief', () => {
  const { reworkThresholdLines } = agentBriefNumbers();

  test('the round decision counts against the brief\'s threshold', () => {
    expect(numberIn(SCRIPT_SOURCE, /const REWORK_ROUND_THRESHOLD_LINES = (\d+);/)).toBe(reworkThresholdLines);
  });
});

describe('nondeterministicCallsIn', () => {
  test('each form planted in the real script is caught', () => {
    const source = readDispatchScript();
    expect(source.split(PLANTING_POINT).length - 1).toBe(1);
    for (const planted of ['Date.now()', 'Math.random()', 'new Date()']) {
      const found = nondeterministicCallsIn(source.replace(PLANTING_POINT, `log(String(${planted}));\n${PLANTING_POINT}`));
      expect(found, planted).toHaveLength(1);
    }
  });

  test('the real script calls no clock and no randomness', () => {
    expect(nondeterministicCallsIn(readDispatchScript())).toEqual([]);
  });
});

describe('metaLiteralVerdictOf', () => {
  test('the real script\'s meta is a pure literal, walked node by node', () => {
    const verdict = metaLiteralVerdictOf(readDispatchScript());
    expect(verdict.verdict).toBe('pure');
    expect(verdict.verdict === 'pure' ? verdict.literalNodeCount : 0).toBeGreaterThan(15);
  });

  test('an impurity planted in the real script\'s meta is caught', () => {
    const source = readDispatchScript().replace('name:        \'agent-progress-dispatch\',', 'name:        `agent-progress-${1}`,');
    expect(metaLiteralVerdictOf(source).verdict).toBe('impure');
  });
});
