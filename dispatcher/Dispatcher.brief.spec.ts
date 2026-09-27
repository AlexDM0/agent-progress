/**
 * The dispatcher's prompts point every agent at the installed agent brief for the blocks it follows, and state three numbers of their own:
 * the builder's call budget, the reviewer's, and the rework count above which a round is granted. What the TypeScript port, bundled,
 * actually sends and decides is held here to `DISPATCH_PROTOCOL`; `init` and `update` generate the installed brief from the same constant,
 * which `cli/adoption/InstalledFileGeneration.spec.ts` pins.
 */
import { describe, expect, test } from 'bun:test';

import { DISPATCH_PROTOCOL }                       from '../src/shared/constants/DispatchProtocol.ts';
import type { RecordedDispatchRun }                from './testing/@types/RecordedDispatchRun.ts';
import { builtScriptTextOf, bundleDispatchScript } from './testing/DispatchScriptBundle.ts';
import { runDispatchScript }                       from './testing/DispatchScriptHarness.ts';
import { DECISION_SCENARIOS }                      from './testing/claims/DecisionClaims.ts';
import { RecordedDispatchRunUtil }                 from './testing/utils/RecordedDispatchRunUtil.ts';

const BUNDLE = await bundleDispatchScript();

function runWithRoundOneReworkOf(reworkedLines: number): Promise<RecordedDispatchRun> {
  return runDispatchScript({
    limit:          2,
    readyTicketIds: ['001'],
    reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines } : { verdict: 'released' }),
  }, builtScriptTextOf(BUNDLE));
}

describe('the dispatcher and the agent brief', () => {
  test('the builder is sent the protocol\'s call budget and told to read the installed brief', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['one ticket is ready at a limit of 1'](), builtScriptTextOf(BUNDLE));
    const builder = run.calls.find((call) => call.kind === 'build');
    expect(builder?.prompt).toContain(`or at about ${DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET} API calls`);
    expect(builder?.prompt).toContain(`/scratch/example-repository/${DISPATCH_PROTOCOL.AGENT_BRIEF_PATH_IN_REPOSITORY}`);
  });

  test('the reviewer is sent the protocol\'s call budget and rework threshold, the installed brief and the Review brief to follow', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['one ticket is ready at a limit of 1'](), builtScriptTextOf(BUNDLE));
    const reviewer = run.calls.find((call) => call.kind === 'review');
    expect(reviewer?.prompt).toContain(`up to about ${DISPATCH_PROTOCOL.REVIEWER_API_CALL_BUDGET} API calls`);
    expect(reviewer?.prompt).toContain(`over ${DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES} lines of code`);
    expect(reviewer?.prompt).toContain(`/scratch/example-repository/${DISPATCH_PROTOCOL.AGENT_BRIEF_PATH_IN_REPOSITORY}`);
    expect(reviewer?.prompt).toContain('`## Review brief`');
  });

  // The prompt tells the reviewer the threshold, and the round decision must refuse and grant on that same number.
  test('the round decision refuses round 2 at the protocol\'s rework threshold and grants it one line above', async () => {
    const atTheThreshold = await runWithRoundOneReworkOf(DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES);
    expect(RecordedDispatchRunUtil.reviewCountOf(atTheThreshold)).toBe(1);
    expect(RecordedDispatchRunUtil.mainSummaryOf(atTheThreshold).parked.map((parkedTicket) => parkedTicket.id)).toEqual(['001']);
    const aboveTheThreshold = await runWithRoundOneReworkOf(DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES + 1);
    expect(RecordedDispatchRunUtil.reviewCountOf(aboveTheThreshold)).toBe(2);
    expect(RecordedDispatchRunUtil.mainSummaryOf(aboveTheThreshold).delivered).toEqual(['001']);
  });
});
