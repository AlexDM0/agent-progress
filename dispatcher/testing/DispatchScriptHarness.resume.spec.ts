/**
 * The dispatcher's resumption of a build an earlier run left paused, pinned like the rest of its decisions: each claim runs against the real
 * script, where it must hold, and against a mutant that breaks exactly that decision, where it must fail. The cases that matter are the ones a
 * stopped board relies on: a whole-board relaunch finds the paused build and delivers it with one builder that carries on past the old claim,
 * never a held ticket's nor a person's pause, all within the limit, and the stopped run names what it left paused and which reviews wait. A takeover
 * must also survive its own builder dying, admit a low build only as a low ticket is, and never outrank a ready ticket of a higher priority.
 */
import { describe, expect, test } from 'bun:test';

import { runDispatchScript, type DispatchRun } from './DispatchScriptHarness';
import { readDispatchScript }                  from './OldDispatchScript';
import type { TextMutant }                     from './claims/DispatchClaim';
import { RESUMPTION_CLAIMS }                   from './claims/ResumptionClaims';

const SCRIPT_SOURCE = readDispatchScript();

function kindsAndTickets(run: DispatchRun): string[] {
  return run.calls.map((call) => `${call.run} ${call.kind}${call.ticketId === null ? '' : ` ${call.ticketId}`}`);
}

function mutated(mutant: TextMutant): string {
  return SCRIPT_SOURCE.replace(mutant.find, mutant.replace);
}

describe('the dispatcher script and a build an earlier run left paused', () => {
  for (const claim of RESUMPTION_CLAIMS) {
    test(claim.name, async () => {
      const run = await runDispatchScript(claim.scenarioFor(), SCRIPT_SOURCE);
      expect(run.ranAway).toBe(false);
      expect(claim.holds(run), JSON.stringify({ calls: kindsAndTickets(run), summary: run.summary, relaunch: run.relaunchSummary })).toBe(true);
    });

    test(`${claim.name} — and fails against the mutant that breaks it`, async () => {
      expect(SCRIPT_SOURCE.split(claim.mutant.find).length - 1, `the mutant's text is in the script exactly once: ${claim.mutant.find}`).toBe(1);
      const run = await runDispatchScript(claim.scenarioFor(), mutated(claim.mutant));
      expect(claim.holds(run)).toBe(false);
    });
  }
});
