/**
 * The dispatcher's decisions, pinned by running `templates/workflows/AgentProgressDispatch.js` against a fake board. Each claim runs twice: against
 * the real script, where it must hold, and against a mutant that breaks exactly the decision it pins, where it must fail — so every claim here was
 * watched failing, and keeps being watched. A mutant whose text has left the script fails loudly rather than passing by mutating nothing.
 */
import { describe, expect, test } from 'bun:test';

import {
  readDispatchScript,
  runDispatchScript,
  type DispatchRun,
  type DispatchScenario,
  type ReviewFinding
} from './DispatchScriptHarness';

interface Mutant {
  find:    string;
  replace: string;
}

interface Claim {
  name:     string;
  scenario: DispatchScenario;
  holds:    (run: DispatchRun) => boolean;
  mutant:   Mutant;
}

const SCRIPT_SOURCE = readDispatchScript();

function ticketIdsFrom(first: number, count: number): string[] {
  return Array.from({ length: count }, (_unused, i) => String(first + i).padStart(3, '0'));
}

function kindsAndTickets(run: DispatchRun): string[] {
  return run.calls.map((call) => (call.ticketId === null ? call.kind : `${call.kind} ${call.ticketId}`));
}

interface DispatchSummary {
  delivered:       string[];
  parked:          { id: string; reason: string }[];
  findingsFiled:   string[];
  agentsRun:       number;
  stoppedByBoard?: boolean;
}

function summaryOf(run: DispatchRun): DispatchSummary {
  return run.summary as DispatchSummary;
}

function parkedIds(run: DispatchRun): string[] {
  return summaryOf(run).parked.map((parkedTicket) => parkedTicket.id);
}

function reviewsOf(run: DispatchRun, ticketId: string): number {
  return run.calls.filter((call) => call.kind === 'review' && call.ticketId === ticketId).length;
}

function finding(findingClass: string, file: string): ReviewFinding {
  return { class: findingClass, file, summary: `${findingClass} in ${file}` };
}

/** Round 1 asks for round 2 with four findings; round 2 asks for round 3 with the findings given. */
function roundThreeScenario(roundTwoFindings: ReviewFinding[]): DispatchScenario {
  const roundOneFindings = [finding('naming', 'a.ts'), finding('naming', 'b.ts'), finding('ordering', 'a.ts'), finding('ordering', 'b.ts')];
  return {
    limit:          2,
    readyTicketIds: ['001'],
    reviewerReply:  (_ticketId, round) => {
      if (round === 1) return { verdict: 'round-requested', reworkedLines: 900, findings: roundOneFindings };
      if (round === 2) return { verdict: 'round-requested', reworkedLines: 900, findings: roundTwoFindings };
      return { verdict: 'released' };
    },
  };
}

const GRANT_ROUND_THREE_WITHOUT_CONVERGENCE: Mutant = { find: 'if (requestedRound === 2) return { granted: true };', replace: 'return { granted: true };' };

const CLAIMS: Claim[] = [
  {
    name:     'the agents running at once never exceed a board limit of 2',
    scenario: { limit: 2, readyTicketIds: ticketIdsFrom(1, 5) },
    holds:    (run) => run.mostAgentsAtOnce === 2 && summaryOf(run).delivered.length === 5,
    mutant:   { find: 'Math.min(board.limit, CONCURRENCY_CEILING_AGENTS)', replace: 'CONCURRENCY_CEILING_AGENTS' },
  },
  {
    name:     'never more than 10 run at once, even with a board limit of 12 and none in flight elsewhere',
    scenario: { limit: 12, readyTicketIds: ticketIdsFrom(1, 15) },
    holds:    (run) => run.mostAgentsAtOnce === 10 && summaryOf(run).delivered.length === 15,
    mutant:   { find: 'Math.min(board.limit, CONCURRENCY_CEILING_AGENTS)', replace: 'board.limit' },
  },
  {
    name:     'agents in flight elsewhere take their share of the board limit',
    scenario: { limit: 3, otherAgentsInFlight: 1, readyTicketIds: ticketIdsFrom(1, 5) },
    holds:    (run) => run.mostAgentsAtOnce === 2,
    mutant:   { find: 'board.agentsInFlight - ownAgentsInFlightAtBoardReading', replace: '0' },
  },
  {
    name:     'a waiting review starts before a ready ticket',
    scenario: { limit: 1, readyTicketIds: ['001', '002'] },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001, build 002, review 002',
    mutant:   {
      find:    'const review = reviewQueue.shift();',
      replace: 'const review = board.readyTicketIds.some((ticketId) => !ticketIdsTakenThisRun.has(ticketId)) ? undefined : reviewQueue.shift();',
    },
  },
  {
    name:     'a ticket filed mid-run, appearing in a returned status block, is dispatched',
    scenario: {
      limit:          1,
      readyTicketIds: ['001'],
      afterAgent:     (call, board) => { if (call.kind === 'build' && call.ticketId === '001') board.readyTicketIds.push('002'); },
    },
    holds:  (run) => kindsAndTickets(run).includes('build 002') && summaryOf(run).delivered.includes('002'),
    mutant: { find: 'if (finished.result !== null) adoptBoard(finished.result.status, inFlight.size);', replace: '' },
  },
  {
    name:     'round 2 is granted at 751 reworked lines',
    scenario: {
      limit:          2,
      readyTicketIds: ['001'],
      reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 751 } : { verdict: 'released' }),
    },
    holds:  (run) => reviewsOf(run, '001') === 2 && summaryOf(run).delivered.includes('001'),
    mutant: { find: 'current.reworkedLines <= REWORK_ROUND_THRESHOLD_LINES', replace: 'current.reworkedLines <= REWORK_ROUND_THRESHOLD_LINES + 1' },
  },
  {
    name:     'round 2 is refused at 750 reworked lines, and the ticket is parked',
    scenario: {
      limit:          2,
      readyTicketIds: ['001'],
      reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 750 } : { verdict: 'released' }),
    },
    holds:  (run) => reviewsOf(run, '001') === 1 && parkedIds(run).includes('001'),
    mutant: { find: 'current.reworkedLines <= REWORK_ROUND_THRESHOLD_LINES', replace: 'current.reworkedLines < REWORK_ROUND_THRESHOLD_LINES' },
  },
  {
    name:     'round 3 is refused when round 2 found more than half of round 1\'s findings',
    scenario: roundThreeScenario([finding('spacing', 'a.ts'), finding('spacing', 'b.ts'), finding('typing', 'a.ts')]),
    holds:    (run) => reviewsOf(run, '001') === 2 && parkedIds(run).includes('001'),
    mutant:   GRANT_ROUND_THREE_WITHOUT_CONVERGENCE,
  },
  {
    name:     'round 3 is refused when round 2 repeats a class an earlier round found',
    scenario: roundThreeScenario([finding('naming', 'a.ts')]),
    holds:    (run) => reviewsOf(run, '001') === 2 && parkedIds(run).includes('001'),
    mutant:   GRANT_ROUND_THREE_WITHOUT_CONVERGENCE,
  },
  {
    name:     'round 3 is refused when round 2 names a file no earlier round named',
    scenario: roundThreeScenario([finding('spacing', 'c.ts')]),
    holds:    (run) => reviewsOf(run, '001') === 2 && parkedIds(run).includes('001'),
    mutant:   GRANT_ROUND_THREE_WITHOUT_CONVERGENCE,
  },
  {
    name:     'round 3 is granted when round 2 converges: at most half the findings, a new class, known files',
    scenario: roundThreeScenario([finding('spacing', 'a.ts'), finding('typing', 'b.ts')]),
    holds:    (run) => reviewsOf(run, '001') === 3 && summaryOf(run).delivered.includes('001'),
    mutant:   { find: '  return { granted: true };\n}\n\nfunction settleReview', replace: '  return { granted: false, reason: \'mutant\' };\n}\n\nfunction settleReview' },
  },
  {
    name:     'a first does-not-hold sends a fresh builder, and a second parks the ticket',
    scenario: { limit: 2, readyTicketIds: ['001'], reviewerReply: () => ({ verdict: 'does-not-hold' }) },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001, build 001, review 001' && parkedIds(run).includes('001'),
    mutant:   { find: 'record.failedPasses >= FAILED_PASSES_BEFORE_PARKING', replace: 'record.failedPasses > FAILED_PASSES_BEFORE_PARKING' },
  },
  {
    name:     'a builder that returns nothing is a failed pass, and a fresh builder takes the ticket',
    scenario: { limit: 2, readyTicketIds: ['001'], builderReply: (_ticketId, pass) => (pass === 1 ? null : { outcome: 'in-review' }) },
    holds:    (run) => summaryOf(run).delivered.includes('001') && run.logs.some((message) => message.includes('#001: the builder returned no result')),
    mutant:   { find: 'countFailedPass(ticketId, \'the builder returned no result\', rebuild);', replace: 'park(ticketId, \'mutant\');' },
  },
  {
    name:     'a refused claim skips the ticket for this run, logged, while the rest go ahead',
    scenario: {
      limit:          2,
      readyTicketIds: ['001', '002'],
      builderReply:   (ticketId, pass) => (ticketId === '001' && pass === 1 ? { outcome: 'claim-refused', detail: 'waits on #009' } : { outcome: 'in-review' }),
    },
    holds: (run) => reviewsOf(run, '001') === 0
      && run.calls.filter((call) => call.ticketId === '001').length === 1
      && summaryOf(run).delivered.join() === '002'
      && run.logs.some((message) => message.includes('#001 skipped for this run')),
    mutant: { find: 'log(`#${ticketId} skipped for this run: the claim was refused (${result.detail}).`);', replace: 'rebuildQueue.push(ticketId);' },
  },
  {
    name:     'a release refused for a reason other than main-moved parks the ticket',
    scenario: { limit: 2, readyTicketIds: ['001'], reviewerReply: () => ({ verdict: 'not-released', releaseReason: 'main-checkout-dirty' }) },
    holds:    (run) => reviewsOf(run, '001') === 1 && summaryOf(run).parked.some((parkedTicket) => parkedTicket.reason.includes('main-checkout-dirty')),
    mutant:   { find: 'result.releaseReason !== \'main-moved\'', replace: 'false' },
  },
  {
    name:     'the run ends when nothing is ready or running, and returns the summary of what it did',
    scenario: {
      limit:          2,
      readyTicketIds: ['001', '002'],
      reviewerReply:  (ticketId) => (ticketId === '001' ? { verdict: 'released', filedTicketIds: ['009'] } : { verdict: 'not-released', releaseReason: 'branch-diverged' }),
    },
    holds: (run) => JSON.stringify(run.summary) === JSON.stringify({
      delivered:     ['001'],
      parked:        [{ id: '002', reason: 'the release was refused: branch-diverged' }],
      findingsFiled: ['009'],
      agentsRun:     5,
    }),
    mutant: { find: ': { delivered, parked, findingsFiled, agentsRun };', replace: ': { delivered, parked, findingsFiled };' },
  },
  {
    name:     'a board stopped mid-run starts no new agent, while the agents in flight finish and a reviewer among them still releases',
    scenario: {
      limit:                  2,
      reviewWaitingTicketIds: ['001'],
      readyTicketIds:         ['002', '003'],
      afterAgent:             (call, board) => { if (call.kind === 'review' && call.ticketId === '001') board.dispatcherState = 'stopped'; },
    },
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, review 001, build 002'
      && summaryOf(run).delivered.join() === '001'
      && summaryOf(run).stoppedByBoard === true,
    mutant: { find: 'while (!stoppedByBoard && inFlight.size < slotLimit)', replace: 'while (inFlight.size < slotLimit)' },
  },
  {
    name:     'a board stopped when the run starts dispatches nothing, and the summary says the board stopped it',
    scenario: { limit: 2, readyTicketIds: ['001'], dispatcherState: 'stopped' },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey' && JSON.stringify(run.summary) === JSON.stringify({
      delivered:      [],
      parked:         [],
      findingsFiled:  [],
      agentsRun:      1,
      stoppedByBoard: true,
    }),
    mutant: { find: 'stoppedByBoard ? { delivered, parked, findingsFiled, agentsRun, stoppedByBoard } : ', replace: '' },
  },
];

const EVERY_KIND_OF_AGENT: DispatchScenario = { limit: 2, readyTicketIds: ['001', '002'], reviewerReply: () => ({ verdict: 'does-not-hold' }) };

function modelsAreExplicit(run: DispatchRun): boolean {
  return run.calls.every((call) => call.model === (call.kind === 'survey' ? 'haiku' : 'opus'));
}

function mutated(mutant: Mutant): string {
  return SCRIPT_SOURCE.replace(mutant.find, mutant.replace);
}

describe('the dispatcher script', () => {
  for (const claim of CLAIMS) {
    test(claim.name, async () => {
      const run = await runDispatchScript(claim.scenario);
      expect(run.ranAway).toBe(false);
      expect(claim.holds(run), JSON.stringify({ calls: kindsAndTickets(run), summary: run.summary, most: run.mostAgentsAtOnce })).toBe(true);
    });

    test(`${claim.name} — and fails against the mutant that breaks it`, async () => {
      expect(SCRIPT_SOURCE.split(claim.mutant.find).length - 1, `the mutant's text is in the script exactly once: ${claim.mutant.find}`).toBe(1);
      const run = await runDispatchScript(claim.scenario, mutated(claim.mutant));
      expect(claim.holds(run)).toBe(false);
    });
  }

  // With nothing ready the survey is the whole run: a dispatcher that idled here would hold the orchestrator's turn for nothing.
  test('with nothing ready and nothing waiting, the survey is the only agent and the summary is empty', async () => {
    const run = await runDispatchScript({ limit: 2, readyTicketIds: [] });
    expect(kindsAndTickets(run)).toEqual(['survey']);
    expect(run.summary).toEqual({
      delivered:     [],
      parked:        [],
      findingsFiled: [],
      agentsRun:     1,
    });
  });

  // A model left out inherits the orchestrator's, which is how a fan-out once ran at the most expensive tier by accident.
  test('every agent is given its model explicitly: haiku for the survey, opus for every builder and reviewer', async () => {
    const run = await runDispatchScript(EVERY_KIND_OF_AGENT);
    expect(run.calls.length).toBeGreaterThan(4);
    expect(modelsAreExplicit(run)).toBe(true);
  });

  test.each([
    ['const SURVEY_MODEL = \'haiku\';', 'const SURVEY_MODEL = undefined;'],
    ['const WORKER_MODEL = \'opus\';', 'const WORKER_MODEL = undefined;'],
  ])('a model left out of the script (%s) fails the model check', async (find, replace) => {
    expect(SCRIPT_SOURCE.split(find).length - 1).toBe(1);
    expect(modelsAreExplicit(await runDispatchScript(EVERY_KIND_OF_AGENT, SCRIPT_SOURCE.replace(find, replace)))).toBe(false);
  });

  test('a review waiting when the run starts is started before any ready ticket', async () => {
    const run = await runDispatchScript({ limit: 1, readyTicketIds: ['002'], reviewWaitingTicketIds: ['001'] });
    expect(kindsAndTickets(run)).toEqual(['survey', 'review 001', 'build 002', 'review 002']);
  });

  test('a rebuild reuses the ticket worktree and tells the builder the last review is where it starts', async () => {
    const run = await runDispatchScript({
      limit:          2,
      readyTicketIds: ['001'],
      reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'does-not-hold' } : { verdict: 'released' }),
    });
    const builders = run.calls.filter((call) => call.kind === 'build');
    expect(builders).toHaveLength(2);
    for (const builder of builders) expect(builder.prompt).toContain('/scratch/example-repository/.claude/worktrees/ticket-001');
    expect(builders[1]?.prompt).toContain('does not hold');
    expect(builders[0]?.prompt).not.toContain('does not hold');
  });

  // The first builder's claim left the ticket in-progress, and the real `ticket claim` refuses that: a fresh builder that stopped on it would turn
  // the retry into a skip. The fake answers whatever the scenario says, so the prompt is where this is pinned.
  test('a fresh builder after one that stopped short of review carries on past its own run\'s claim, and is not told a reviewer found anything', async () => {
    const run = await runDispatchScript({ limit: 2, readyTicketIds: ['001'], builderReply: (_ticketId, pass) => (pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }) });
    const builders = run.calls.filter((call) => call.kind === 'build');
    expect(builders).toHaveLength(2);
    expect(builders[1]?.prompt).toContain('saying the ticket is in-progress, that is the claim of this run\'s earlier builder: carry on');
    expect(builders[1]?.prompt).not.toContain('does not hold');
    expect(builders[0]?.prompt).not.toContain('carry on');
  });

  // A reviewer that died left its bar running, and every status block after would count it as an agent in flight elsewhere.
  test('a fresh reviewer after one that returned nothing is told to close the bar the dead one left running', async () => {
    const run = await runDispatchScript({ limit: 2, readyTicketIds: ['001'], reviewerReply: (_ticketId, round) => (round === 1 ? null : { verdict: 'released' }) });
    const reviewers = run.calls.filter((call) => call.kind === 'review');
    expect(reviewers).toHaveLength(2);
    expect(reviewers[1]?.prompt).toContain('An earlier reviewer of this run returned nothing');
    expect(reviewers[0]?.prompt).not.toContain('An earlier reviewer of this run returned nothing');
    expect(summaryOf(run).delivered).toEqual(['001']);
  });
});
