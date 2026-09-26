/**
 * The dispatcher's prompts point every agent at the installed copy of `resources/templates/AgentBrief.md` for the blocks it follows, and state
 * three numbers of their own: the builder's call budget, the reviewer's, and the rework count above which a round is granted. Those three are read
 * here from the brief and from what the TypeScript port, bundled, actually sends and decides, and held to `DISPATCH_PROTOCOL`, so a change to one
 * that leaves another behind fails.
 */
import { describe, expect, test } from 'bun:test';

import { DISPATCH_PROTOCOL }                           from '../src/shared/constants/DispatchProtocol.ts';
import { agentBriefNumbers }                           from './testing/AgentBriefNumbers.ts';
import { builtScriptTextOf, bundleDispatchScript }     from './testing/DispatchScriptBundle.ts';
import { runDispatchScript, type RecordedDispatchRun } from './testing/DispatchScriptHarness.ts';
import { DECISION_SCENARIOS }                          from './testing/claims/DecisionClaims.ts';
import { RecordedDispatchRunUtil }                     from './testing/utils/RecordedDispatchRunUtil.ts';

const BUNDLE = await bundleDispatchScript();

function runWithRoundOneReworkOf(reworkedLines: number): Promise<RecordedDispatchRun> {
  return runDispatchScript({
    limit:          2,
    readyTicketIds: ['001'],
    reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines } : { verdict: 'released' }),
  }, builtScriptTextOf(BUNDLE));
}

function reviewerCountOf(run: RecordedDispatchRun): number {
  return run.calls.filter((call) => call.kind === 'review').length;
}

describe('the dispatcher and the agent brief', () => {
  const { builderApiCallBudget, reviewerApiCallBudget, reworkThresholdLines } = agentBriefNumbers();

  test('the brief states the three numbers the prompts repeat', () => {
    expect([builderApiCallBudget, reviewerApiCallBudget, reworkThresholdLines]).toEqual([150, 75, 750]);
  });

  test('the brief\'s three numbers are the dispatch protocol\'s', () => {
    expect([builderApiCallBudget, reviewerApiCallBudget, reworkThresholdLines]).toEqual([
      DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET,
      DISPATCH_PROTOCOL.REVIEWER_API_CALL_BUDGET,
      DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES,
    ]);
  });

  test('the builder is sent the brief\'s call budget and told to read the installed brief', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['one ticket is ready at a limit of 1'](), builtScriptTextOf(BUNDLE));
    const builder = run.calls.find((call) => call.kind === 'build');
    expect(builder?.prompt).toContain(`or at about ${builderApiCallBudget} API calls`);
    expect(builder?.prompt).toContain('/scratch/example-repository/.agent-progress/agent-brief.md');
  });

  test('the reviewer is sent the brief\'s call budget, its rework threshold and the Review brief to follow', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['one ticket is ready at a limit of 1'](), builtScriptTextOf(BUNDLE));
    const reviewer = run.calls.find((call) => call.kind === 'review');
    expect(reviewer?.prompt).toContain(`up to about ${reviewerApiCallBudget} API calls`);
    expect(reviewer?.prompt).toContain(`over ${reworkThresholdLines} lines of code`);
    expect(reviewer?.prompt).toContain('`## Review brief`');
  });

  // The prompt tells the reviewer the threshold, and the round decision must refuse and grant on that same number.
  test('the round decision refuses round 2 at the protocol\'s rework threshold and grants it one line above', async () => {
    const atTheThreshold = await runWithRoundOneReworkOf(DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES);
    expect(reviewerCountOf(atTheThreshold)).toBe(1);
    expect(RecordedDispatchRunUtil.mainSummaryOf(atTheThreshold).parked.map((parkedTicket) => parkedTicket.id)).toEqual(['001']);
    const aboveTheThreshold = await runWithRoundOneReworkOf(DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES + 1);
    expect(reviewerCountOf(aboveTheThreshold)).toBe(2);
    expect(RecordedDispatchRunUtil.mainSummaryOf(aboveTheThreshold).delivered).toEqual(['001']);
  });
});
