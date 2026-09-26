/**
 * The dispatcher's decisions, pinned by running the TypeScript port, bundled, against a fake board. Each claim runs twice: against the bundle,
 * where it must hold, and against a mutant of the TypeScript module that holds the decision, where it must fail. A mutant whose text is not in
 * its module exactly once fails the build; a run that throws never counts as a claim holding, nor a mutant that only crashes as caught.
 */
import { describe, expect, test } from 'bun:test';

import { builtScriptTextOf, bundleDispatchScript } from './testing/DispatchScriptBundle.ts';
import {
  BUILDER_CARRIES_ON_PAST_ITS_OWN_CLAIM,
  REVIEWER_SKIPS_A_REREVIEW_ALREADY_RUN,
  REVIEWER_TAKES_OVER_A_RUNNING_BAR,
  runDispatchScript
} from './testing/DispatchScriptHarness.ts';
import type { SourceMutant }                                                from './testing/SourceMutant.ts';
import { DECISION_CLAIMS, DECISION_SCENARIOS, modelsAndEffortsAreExplicit } from './testing/claims/DecisionClaims.ts';
import { DISPATCHER_MODULE_PATHS, kindsAndTickets, runSummaryOf }           from './testing/claims/DispatchClaim.ts';

const BUNDLE = await bundleDispatchScript();

function agentOptionLeftOut(find: string, replace: string): SourceMutant {
  return { modulePath: DISPATCHER_MODULE_PATHS.AGENT_STARTER, find, replace };
}

// Each of the four sites that start an agent, with its model line or its effort line taken out.
const AGENT_OPTIONS_LEFT_OUT: [string, SourceMutant][] = [
  ['the survey agents\' model', agentOptionLeftOut('      model:  DISPATCH_POLICY.SURVEY_AGENT.model,\n', '')],
  ['the survey agents\' effort', agentOptionLeftOut('      effort: DISPATCH_POLICY.SURVEY_AGENT.effort,\n', '')],
  ['the parking agent\'s model', agentOptionLeftOut('      model:  DISPATCH_POLICY.PARKING_AGENT.model,\n', '')],
  ['the parking agent\'s effort', agentOptionLeftOut('      effort: DISPATCH_POLICY.PARKING_AGENT.effort,\n', '')],
  ['the builder\'s model', agentOptionLeftOut('schema: AGENT_REPLY_SCHEMAS.BUILDER,\n        model,\n', 'schema: AGENT_REPLY_SCHEMAS.BUILDER,\n')],
  [
    'the builder\'s effort',
    agentOptionLeftOut('schema: AGENT_REPLY_SCHEMAS.BUILDER,\n        model,\n        effort,\n', 'schema: AGENT_REPLY_SCHEMAS.BUILDER,\n        model,\n'),
  ],
  ['the reviewer\'s model', agentOptionLeftOut('schema: AGENT_REPLY_SCHEMAS.REVIEWER,\n      model,\n', 'schema: AGENT_REPLY_SCHEMAS.REVIEWER,\n')],
  ['the reviewer\'s effort', agentOptionLeftOut('schema: AGENT_REPLY_SCHEMAS.REVIEWER,\n      model,\n      effort,\n', 'schema: AGENT_REPLY_SCHEMAS.REVIEWER,\n      model,\n')],
];

describe('the dispatcher script', () => {
  for (const claim of DECISION_CLAIMS) {
    test(claim.name, async () => {
      const run = await runDispatchScript(claim.scenarioFor(), builtScriptTextOf(BUNDLE));
      expect(run.ranAway).toBe(false);
      expect(run.threw).toBeNull();
      expect(claim.holds(run), JSON.stringify({ calls: kindsAndTickets(run), summary: run.summary, most: run.mostAgentsAtOnce })).toBe(true);
    });

    test(`${claim.name} — and fails against the mutant that breaks it`, async () => {
      const mutated = await bundleDispatchScript(claim.mutant);
      expect(mutated).toMatchObject({ verdict: 'built' });
      const run = await runDispatchScript(claim.scenarioFor(), builtScriptTextOf(mutated));
      expect(run.threw).toBeNull();
      expect(claim.holds(run)).toBe(false);
    });
  }

  // With nothing ready the survey is the whole run: a dispatcher that idled here would hold the orchestrator's turn for nothing.
  test('with nothing ready and nothing waiting, the survey is the only agent and the summary is empty', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['nothing is ready and nothing waits'](), builtScriptTextOf(BUNDLE));
    expect(kindsAndTickets(run)).toEqual(['survey']);
    expect(run.summary).toEqual({
      delivered:     [],
      parked:        [],
      findingsFiled: [],
      agentsRun:     1,
    });
  });

  // A model or effort left out inherits the orchestrator's, which is how a fan-out once ran at the most expensive tier by accident.
  test('every agent is given its model and effort explicitly: haiku at low for the survey and the parking agents, the defaults for every builder and reviewer', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['every kind of agent runs'](), builtScriptTextOf(BUNDLE));
    expect(run.calls.length).toBeGreaterThan(4);
    expect(new Set(run.calls.map((call) => call.kind))).toEqual(new Set(['survey', 'build', 'review', 'park']));
    expect(modelsAndEffortsAreExplicit(run)).toBe(true);
  });

  test.each(AGENT_OPTIONS_LEFT_OUT)('an agent started without its model or effort (%s) fails the check', async (_optionLeftOut, mutant) => {
    const mutated = await bundleDispatchScript(mutant);
    expect(mutated).toMatchObject({ verdict: 'built' });
    const run = await runDispatchScript(DECISION_SCENARIOS['every kind of agent runs'](), builtScriptTextOf(mutated));
    expect(modelsAndEffortsAreExplicit(run)).toBe(false);
  });

  // The script reads a ticket's priority, model and effort only from what the agents copy, so every prompt names the one list to copy.
  test('every agent is told to return the status document\'s readyTickets verbatim', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['every kind of agent runs'](), builtScriptTextOf(BUNDLE));
    expect(run.calls.length).toBeGreaterThan(4);
    for (const call of run.calls) expect(call.prompt).toContain('`readyTickets` (the same document\'s top-level `readyTickets` list, verbatim)');
  });

  test('a review waiting when the run starts is started before any ready ticket', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['a review waits beside one ready ticket at a limit of 1'](), builtScriptTextOf(BUNDLE));
    expect(kindsAndTickets(run)).toEqual(['survey', 'review 001', 'build 002', 'review 002']);
  });

  test('a rebuild reuses the ticket worktree and tells the builder the last review is where it starts', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['a review that does not hold sends a rebuild'](), builtScriptTextOf(BUNDLE));
    const builders = run.calls.filter((call) => call.kind === 'build');
    expect(builders).toHaveLength(2);
    for (const builder of builders) expect(builder.prompt).toContain('/scratch/example-repository/.claude/worktrees/ticket-001');
    expect(builders[1]?.prompt).toContain('does not hold');
    expect(builders[0]?.prompt).not.toContain('does not hold');
  });

  // An earlier attempt's claim leaves the ticket in-progress, and the real `ticket claim` refuses that. Any builder may be a restarted or resumed
  // one, so every prompt carries the rule; only one that follows a builder of this run that stopped short is told so.
  test('every builder carries on past a claim refused while its worktree exists, and only a fresh one is told an earlier builder stopped short', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['a builder stops short and a fresh builder carries on'](), builtScriptTextOf(BUNDLE));
    const builders = run.calls.filter((call) => call.kind === 'build');
    expect(builders).toHaveLength(2);
    for (const builder of builders) {
      const ownClaimClause = '"Built by the whole-board dispatcher run on ticket-001" and /scratch/example-repository/.claude/worktrees/ticket-001 exists';
      expect(builder.prompt).toContain(`${ownClaimClause}, ${BUILDER_CARRIES_ON_PAST_ITS_OWN_CLAIM}`);
      expect(builder.prompt).toContain('keeping every uncommitted edit it holds');
    }
    expect(builders[1]?.prompt).toContain('An earlier builder of this run stopped before review');
    expect(builders[0]?.prompt).not.toContain('An earlier builder of this run');
    expect(builders[1]?.prompt).not.toContain('does not hold');
  });

  test('every reviewer takes a running bar that reviews its ticket as its own rather than adding a second', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['a reviewer returns nothing on round 1 at a limit of 2'](), builtScriptTextOf(BUNDLE));
    const reviewers = run.calls.filter((call) => call.kind === 'review');
    expect(reviewers).toHaveLength(2);
    for (const reviewer of reviewers) expect(reviewer.prompt).toContain('`reviewOf` is 001, it is this review\'s own');
    for (const reviewer of reviewers) expect(reviewer.prompt).toContain(REVIEWER_TAKES_OVER_A_RUNNING_BAR);
    expect(run.reviewBarsAdded).toEqual(['review 001']);
  });

  test('only a round-2 reviewer runs ticket rereview, and its prompt skips it when the bar named for its round already runs', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['a reviewer asks for round 2'](), builtScriptTextOf(BUNDLE));
    const reviewers = run.calls.filter((call) => call.kind === 'review');
    expect(reviewers).toHaveLength(2);
    expect(reviewers[0]?.prompt).not.toContain('ticket rereview 001');
    expect(reviewers[1]?.prompt).toContain('is named `Review <your round> #001 — …`');
    expect(reviewers[1]?.prompt).toContain(REVIEWER_SKIPS_A_REREVIEW_ALREADY_RUN);
    expect(run.rereviewsRun).toEqual(['rereview 001 round 2']);
  });

  // A reviewer that died left its bar running, and every status block after would count it as an agent in flight elsewhere.
  test('a fresh reviewer after one that returned nothing is told the dead one\'s bar may still be running', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['a reviewer returns nothing on round 1 at a limit of 2'](), builtScriptTextOf(BUNDLE));
    const reviewers = run.calls.filter((call) => call.kind === 'review');
    expect(reviewers).toHaveLength(2);
    expect(reviewers[1]?.prompt).toContain('An earlier reviewer of this run returned nothing');
    expect(reviewers[0]?.prompt).not.toContain('An earlier reviewer of this run returned nothing');
    expect(runSummaryOf(run).delivered).toEqual(['001']);
  });

  // At a limit of 1 no status block follows a dead reviewer, so its bar is never read as another's: this pins the case, it decides nothing new.
  test('with a limit of 1, a reviewer that returned nothing with its bar left running is followed by a fresh reviewer that releases', async () => {
    const run = await runDispatchScript(DECISION_SCENARIOS['a reviewer returns nothing on round 1 at a limit of 1'](), builtScriptTextOf(BUNDLE));
    expect(kindsAndTickets(run)).toEqual(['survey', 'build 001', 'review 001', 'review 001']);
    expect(runSummaryOf(run).delivered).toEqual(['001']);
    expect(run.mostAgentsInFlightAtOnce).toBe(1);
  });
});
