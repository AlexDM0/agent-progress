/**
 * The dispatcher's prompts point every agent at the installed copy of `templates/AgentBrief.md` for the blocks it follows, and state three numbers
 * of their own: the builder's call budget, the reviewer's, and the rework count above which a round is granted. Those three are read here from
 * the brief and from what the script actually sends, and held to `DISPATCH_PROTOCOL`, so a change to one that leaves another behind fails.
 */
import { describe, expect, test } from 'bun:test';

import { DISPATCH_PROTOCOL }  from '../../src/shared/constants/DispatchProtocol';
import { agentBriefNumbers }  from './AgentBriefNumbers';
import { runDispatchScript }  from './DispatchScriptHarness';
import { readDispatchScript } from './OldDispatchScript';
import { DECISION_SCENARIOS } from './claims/DecisionClaims';

const SCRIPT_SOURCE = readDispatchScript();

describe('the dispatcher and the agent brief', () => {
  const { builderBudget, reviewerBudget, reworkThresholdLines } = agentBriefNumbers();

  test('the brief states the three numbers the prompts repeat', () => {
    expect([builderBudget, reviewerBudget, reworkThresholdLines]).toEqual([150, 75, 750]);
  });

  test('the brief\'s three numbers are the dispatch protocol\'s', () => {
    expect([builderBudget, reviewerBudget, reworkThresholdLines]).toEqual([
      DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET,
      DISPATCH_PROTOCOL.REVIEWER_API_CALL_BUDGET,
      DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES,
    ]);
  });

  test('the builder is sent the brief\'s call budget and told to read the installed brief', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['one ticket is ready at a limit of 1'](), SCRIPT_SOURCE);
    const builder = run.calls.find((call) => call.kind === 'build');
    expect(builder?.prompt).toContain(`or at about ${builderBudget} API calls`);
    expect(builder?.prompt).toContain('/scratch/example-repository/.agent-progress/agent-brief.md');
  });

  test('the reviewer is sent the brief\'s call budget, its rework threshold and the Review brief to follow', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['one ticket is ready at a limit of 1'](), SCRIPT_SOURCE);
    const reviewer = run.calls.find((call) => call.kind === 'review');
    expect(reviewer?.prompt).toContain(`up to about ${reviewerBudget} API calls`);
    expect(reviewer?.prompt).toContain(`over ${reworkThresholdLines} lines of code`);
    expect(reviewer?.prompt).toContain('`## Review brief`');
  });
});
