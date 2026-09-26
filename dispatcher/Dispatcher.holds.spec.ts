/**
 * The dispatcher's reading of `ticket hold`, pinned like the rest of its decisions: each claim runs against the TypeScript port, bundled, where
 * it must hold, and against a mutant of the TypeScript module that holds the decision, where it must fail. The cases that matter are the ones a
 * paused ticket relies on: no builder or reviewer of a held ticket starts before a returned status block shows the hold lifted, the step starts
 * at the first block that does, a held ticket's row left running is released rather than holding a slot, the other tickets keep flowing within
 * the limit, and a run that ends first says what it left held.
 * A run that throws never counts as a claim holding, and a mutant that only crashes the script never counts as caught.
 */
import { describe, expect, test } from 'bun:test';

import { builtScriptTextOf, bundleDispatchScript } from './testing/DispatchScriptBundle';
import { runDispatchScript, type DispatchRun }     from './testing/DispatchScriptHarness';
import { HOLD_CLAIMS }                             from './testing/claims/HoldClaims';

const BUNDLE = await bundleDispatchScript();

function kindsAndTickets(run: DispatchRun): string[] {
  return run.calls.map((call) => (call.ticketId === null ? call.kind : `${call.kind} ${call.ticketId}`));
}

describe('the dispatcher script and a held ticket', () => {
  for (const claim of HOLD_CLAIMS) {
    test(claim.name, async () => {
      const run = await runDispatchScript(claim.scenarioFor(), builtScriptTextOf(BUNDLE));
      expect(run.ranAway).toBe(false);
      expect(run.threw).toBeNull();
      expect(claim.holds(run), JSON.stringify({ calls: kindsAndTickets(run), summary: run.summary, held: run.heldTicketIdsReturned })).toBe(true);
    });

    test(`${claim.name} — and fails against the mutant that breaks it`, async () => {
      const mutated = await bundleDispatchScript(claim.mutant);
      expect(mutated).toMatchObject({ verdict: 'built' });
      const run = await runDispatchScript(claim.scenarioFor(), builtScriptTextOf(mutated));
      expect(run.threw).toBeNull();
      expect(claim.holds(run)).toBe(false);
    });
  }
});
