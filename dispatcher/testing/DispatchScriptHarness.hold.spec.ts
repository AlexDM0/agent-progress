/**
 * The dispatcher's reading of `ticket hold`, pinned like the rest of its decisions: each claim runs against the real script, where it must hold,
 * and against a mutant that breaks exactly that decision, where it must fail. The cases that matter are the ones a paused ticket relies on: no
 * builder or reviewer of a held ticket starts before a returned status block shows the hold lifted, the step starts at the first block that does,
 * a held ticket's row left running is released rather than holding a slot, the other tickets keep flowing within the limit, and a run that ends
 * first says what it left held.
 */
import { describe, expect, test } from 'bun:test';

import { runDispatchScript, type DispatchRun } from './DispatchScriptHarness';
import { readDispatchScript }                  from './OldDispatchScript';
import type { TextMutant }                     from './claims/DispatchClaim';
import { HOLD_CLAIMS }                         from './claims/HoldClaims';

const SCRIPT_SOURCE = readDispatchScript();

function kindsAndTickets(run: DispatchRun): string[] {
  return run.calls.map((call) => (call.ticketId === null ? call.kind : `${call.kind} ${call.ticketId}`));
}

function mutated(mutant: TextMutant): string {
  return SCRIPT_SOURCE.replace(mutant.find, mutant.replace);
}

describe('the dispatcher script and a held ticket', () => {
  for (const claim of HOLD_CLAIMS) {
    test(claim.name, async () => {
      const run = await runDispatchScript(claim.scenarioFor(), SCRIPT_SOURCE);
      expect(run.ranAway).toBe(false);
      expect(claim.holds(run), JSON.stringify({ calls: kindsAndTickets(run), summary: run.summary, held: run.heldTicketIdsReturned })).toBe(true);
    });

    test(`${claim.name} — and fails against the mutant that breaks it`, async () => {
      expect(SCRIPT_SOURCE.split(claim.mutant.find).length - 1, `the mutant's text is in the script exactly once: ${claim.mutant.find}`).toBe(1);
      const run = await runDispatchScript(claim.scenarioFor(), mutated(claim.mutant));
      expect(claim.holds(run)).toBe(false);
    });
  }

  test('every agent is told to return heldTicketIds with the concurrency block, and the schema requires it', () => {
    expect(SCRIPT_SOURCE).toContain('(limit, agentsInFlight, freeSlots, readyTicketIds, dispatcherState, heldTicketIds)');
    expect(SCRIPT_SOURCE).toMatch(/required: \[[^\]]*'heldTicketIds'\]/);
  });
});
