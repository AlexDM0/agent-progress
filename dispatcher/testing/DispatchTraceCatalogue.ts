/**
 * Every scenario the frozen trace table holds, keyed: the claim suites' and plain tests' scenarios, a builder × reviewer grid, the argument
 * refusals and fallbacks, and one lever per reply shape the dispatcher guards against.
 */
import type {
  AgentKind,
  AgentMisbehaviour,
  BuilderReply,
  DispatchScenario,
  RecordedAgentCall,
  ReviewerReply,
} from './DispatchScriptHarness.ts';
import { DECISION_CLAIMS, DECISION_SCENARIOS } from './claims/DecisionClaims.ts';
import { HOLD_CLAIMS }                         from './claims/HoldClaims.ts';
import { RESUMPTION_CLAIMS }                   from './claims/ResumptionClaims.ts';

export interface CatalogueEntry {
  key:         string;
  scenarioFor: () => DispatchScenario;
}

interface BuilderBehaviour {
  name:  string;
  reply: (pass: number) => BuilderReply | null;
}

interface ReviewerBehaviour {
  name:               string;
  reviewerReply?:     (ticketId: string, round: number) => ReviewerReply | null;
  agentMisbehaviour?: (call: RecordedAgentCall) => AgentMisbehaviour | undefined;
}

const GRID_TICKET_ID = '001';

const TWO_SLOTS_BUSY: DispatchScenario = {
  limit:                  2,
  readyTicketIds:         ['001', '002', '003'],
  reviewWaitingTicketIds: ['007'],
  otherAgentsInFlight:    1,
};

const ONE_READY_TICKET: DispatchScenario = { limit: 2, readyTicketIds: ['001'] };

const EXAMPLE_OUTAGE = 'Example outage';

const EXAMPLE_PAUSED_BUILD_NOTE = 'Built by the whole-board dispatcher run on ticket-004';

const BUILDER_BEHAVIOURS: readonly BuilderBehaviour[] = [
  { name: 'in-review', reply: () => ({ outcome: 'in-review' }) },
  { name: 'claim-refused', reply: () => ({ outcome: 'claim-refused', detail: 'refused by example' }) },
  { name: 'failed with a detail', reply: () => ({ outcome: 'failed', detail: 'stopped short' }) },
  { name: 'failed without a detail', reply: () => ({ outcome: 'failed' }) },
  { name: 'returns nothing', reply: () => null },
];

const ROUND_ONE_FINDING = { class: 'naming', file: 'a.ts', summary: 'naming in a.ts' };

const FOUR_ROUND_ONE_FINDINGS = [
  ROUND_ONE_FINDING,
  { class: 'typing', file: 'b.ts', summary: 'typing in b.ts' },
  { class: 'wording', file: 'c.ts', summary: 'wording in c.ts' },
  { class: 'ordering', file: 'd.ts', summary: 'ordering in d.ts' },
];

function roundRequestedOnRoundOne(reworkedLines: number): (ticketId: string, round: number) => ReviewerReply {
  return (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines, findings: [ROUND_ONE_FINDING] } : { verdict: 'released' });
}

const REVIEWER_BEHAVIOURS: readonly ReviewerBehaviour[] = [
  { name: 'released', reviewerReply: () => ({ verdict: 'released' }) },
  { name: 'round-requested at 751', reviewerReply: roundRequestedOnRoundOne(751) },
  { name: 'round-requested at 750', reviewerReply: roundRequestedOnRoundOne(750) },
  {
    name:          'round-requested at 900 every round',
    reviewerReply: (_ticketId, round) => ({ verdict: 'round-requested', reworkedLines: 900, findings: round === 1 ? FOUR_ROUND_ONE_FINDINGS : [ROUND_ONE_FINDING] }),
  },
  { name: 'does-not-hold', reviewerReply: () => ({ verdict: 'does-not-hold' }) },
  { name: 'not-released merge-refused', reviewerReply: () => ({ verdict: 'not-released', releaseReason: 'merge-refused' }) },
  { name: 'not-released main-moved', reviewerReply: () => ({ verdict: 'not-released', releaseReason: 'main-moved' }) },
  { name: 'returns nothing', reviewerReply: () => null },
  { name: 'throws', agentMisbehaviour: (call) => (call.kind === 'review' ? { throws: EXAMPLE_OUTAGE } : undefined) },
];

function gridScenarioFor(builderBehaviour: BuilderBehaviour, reviewerBehaviour: ReviewerBehaviour): DispatchScenario {
  const scenario: DispatchScenario = {
    ...TWO_SLOTS_BUSY,
    builderReply: (ticketId, pass) => (ticketId === GRID_TICKET_ID ? builderBehaviour.reply(pass) : { outcome: 'in-review' }),
  };
  if (reviewerBehaviour.reviewerReply !== undefined) scenario.reviewerReply = reviewerBehaviour.reviewerReply;
  if (reviewerBehaviour.agentMisbehaviour !== undefined) scenario.agentMisbehaviour = reviewerBehaviour.agentMisbehaviour;
  return scenario;
}

function misbehaviourOfKind(kind: AgentKind, misbehaviour: AgentMisbehaviour): (call: RecordedAgentCall) => AgentMisbehaviour | undefined {
  return (call) => (call.kind === kind ? misbehaviour : undefined);
}

const ARGUMENT_ENTRIES: readonly CatalogueEntry[] = [
  { key: 'arguments: installCommand given', scenarioFor: () => ({ ...ONE_READY_TICKET, argumentOverrides: { installCommand: 'example-install' } }) },
  {
    key:         'arguments: includeLowPriority given as a word rather than true',
    scenarioFor: () => ({ ...ONE_READY_TICKET, lowPriorityTicketIds: ['001'], argumentOverrides: { includeLowPriority: 'yes' } }),
  },
  { key: 'arguments: ticketIds empty', scenarioFor: () => ({ ...ONE_READY_TICKET, argumentOverrides: { ticketIds: [] } }) },
  { key: 'arguments: ticketIds repeating a ticket', scenarioFor: () => ({ ...ONE_READY_TICKET, argumentOverrides: { ticketIds: ['001', '001'] } }) },
  { key: 'arguments: checkCommand missing', scenarioFor: () => ({ ...ONE_READY_TICKET, argumentOverrides: { checkCommand: undefined } }) },
  { key: 'arguments: readyTickets not a list', scenarioFor: () => ({ ...ONE_READY_TICKET, argumentOverrides: { ticketIds: ['001'], readyTickets: 'none' } }) },
];

/** The argument entries the old script refuses with a thrown error. */
export const REFUSED_ARGUMENT_KEYS = ['arguments: ticketIds empty', 'arguments: checkCommand missing'] as const;

/** The two survey shapes the dispatcher does not guard, where the port keeps the old crash. */
export const KEPT_CRASH_KEYS = ['lever: survey without a list of reviews waiting', 'lever: survey with a null among the reviews waiting'] as const;

/** Levers whose guard reads the malformed reply exactly as the unmisbehaved one, so their trace equals their base's rather than differing from it. */
export const LEVERS_READ_AS_THEIR_BASE = ['lever: reviewer round not an integer', 'lever: paused builds holding a null entry and one without its worktree'] as const;

const PAUSED_BUILD_ON_THE_BOARD: DispatchScenario = { limit: 2, readyTicketIds: [], pausedBuildNotesByTicketId: { '004': EXAMPLE_PAUSED_BUILD_NOTE } };

const TWO_PAUSED_BUILDS_ONE_WITHOUT_ITS_WORKTREE: DispatchScenario = {
  limit:                         2,
  readyTicketIds:                [],
  pausedBuildNotesByTicketId:    { '004': EXAMPLE_PAUSED_BUILD_NOTE, '005': 'Built by the whole-board dispatcher run on ticket-005' },
  pausedBuildIdsWithoutWorktree: ['005'],
};

const PAUSED_BUILDS_AS_THE_SURVEY_STATES_THEM = [
  {
    id:             '004',
    note:           EXAMPLE_PAUSED_BUILD_NOTE,
    worktreeExists: true,
    priority:       'normal',
  },
  {
    id:             '005',
    note:           'Built by the whole-board dispatcher run on ticket-005',
    worktreeExists: false,
    priority:       'normal',
  },
];

const STATUS_WITHOUT_READY_TICKET_IDS = {
  limit:           2,
  agentsInFlight:  0,
  freeSlots:       2,
  dispatcherState: 'running',
  heldTicketIds:   [],
};

const LEVER_ENTRIES: readonly CatalogueEntry[] = [
  {
    key:         'lever: an agent that throws',
    scenarioFor: () => ({ ...ONE_READY_TICKET, agentMisbehaviour: (call) => (call.kind === 'build' && call.ordinal === 1 ? { throws: EXAMPLE_OUTAGE } : undefined) }),
  },
  { key: 'lever: survey returns nothing', scenarioFor: () => ({ ...ONE_READY_TICKET, agentMisbehaviour: misbehaviourOfKind('survey', { returns: 'nothing' }) }) },
  { key: 'lever: survey status null', scenarioFor: () => ({ ...ONE_READY_TICKET, agentMisbehaviour: misbehaviourOfKind('survey', { replacesFields: { status: null } }) }) },
  {
    key:         'lever: survey status without a list of ready tickets',
    scenarioFor: () => ({ ...ONE_READY_TICKET, agentMisbehaviour: misbehaviourOfKind('survey', { replacesFields: { status: STATUS_WITHOUT_READY_TICKET_IDS } }) }),
  },
  {
    key:         'lever: ticket settings lookup returns nothing',
    scenarioFor: () => ({ ...ONE_READY_TICKET, argumentOverrides: { ticketIds: ['001'] }, agentMisbehaviour: misbehaviourOfKind('settings', { returns: 'nothing' }) }),
  },
  {
    key:         'lever: ticket settings lookup without a list of tickets',
    scenarioFor: () => ({
      ...ONE_READY_TICKET,
      argumentOverrides: { ticketIds: ['001'] },
      agentMisbehaviour: misbehaviourOfKind('settings', { replacesFields: { tickets: 'none' } }),
    }),
  },
  {
    key:         'lever: parking agent returns nothing',
    scenarioFor: () => ({
      ...ONE_READY_TICKET,
      reviewerReply:     () => ({ verdict: 'not-released', releaseReason: 'merge-refused' }),
      agentMisbehaviour: misbehaviourOfKind('park', { returns: 'nothing' }),
    }),
  },
  {
    key:         'lever: reviewer round not an integer',
    scenarioFor: () => ({
      ...ONE_READY_TICKET,
      reviewerReply:     roundRequestedOnRoundOne(751),
      agentMisbehaviour: misbehaviourOfKind('review', { replacesFields: { round: 1.5 } }),
    }),
  },
  {
    key:         'lever: paused builds null',
    scenarioFor: () => ({ ...PAUSED_BUILD_ON_THE_BOARD, agentMisbehaviour: misbehaviourOfKind('survey', { replacesFields: { pausedBuilds: null } }) }),
  },
  {
    key:         'lever: paused builds holding a null entry and one without its worktree',
    scenarioFor: () => ({
      ...TWO_PAUSED_BUILDS_ONE_WITHOUT_ITS_WORKTREE,
      agentMisbehaviour: misbehaviourOfKind('survey', { replacesFields: { pausedBuilds: [null, ...PAUSED_BUILDS_AS_THE_SURVEY_STATES_THEM] } }),
    }),
  },
  {
    key:         'lever: survey without a list of reviews waiting',
    scenarioFor: () => ({ ...ONE_READY_TICKET, agentMisbehaviour: misbehaviourOfKind('survey', { replacesFields: { reviewWaitingTickets: undefined } }) }),
  },
  {
    key:         'lever: survey with a null among the reviews waiting',
    scenarioFor: () => ({ ...ONE_READY_TICKET, agentMisbehaviour: misbehaviourOfKind('survey', { replacesFields: { reviewWaitingTickets: [null] } }) }),
  },
];

export function dispatchTraceCatalogue(): CatalogueEntry[] {
  const entries: CatalogueEntry[] = [
    ...DECISION_CLAIMS.map((claim) => ({ key: `decisions: ${claim.name}`, scenarioFor: claim.scenarioFor })),
    ...HOLD_CLAIMS.map((claim) => ({ key: `holds: ${claim.name}`, scenarioFor: claim.scenarioFor })),
    ...RESUMPTION_CLAIMS.map((claim) => ({ key: `resumption: ${claim.name}`, scenarioFor: claim.scenarioFor })),
    ...Object.entries(DECISION_SCENARIOS).map(([name, scenarioFor]) => ({ key: `scenario: ${name}`, scenarioFor })),
    ...BUILDER_BEHAVIOURS.flatMap((builderBehaviour) => REVIEWER_BEHAVIOURS.map((reviewerBehaviour) => ({
      key:         `grid: ${builderBehaviour.name} × ${reviewerBehaviour.name}`,
      scenarioFor: () => gridScenarioFor(builderBehaviour, reviewerBehaviour),
    }))),
    ...ARGUMENT_ENTRIES,
    ...LEVER_ENTRIES,
  ];
  const keysSeen = new Set<string>();
  for (const entry of entries) {
    if (keysSeen.has(entry.key)) throw new Error(`The dispatch trace catalogue names "${entry.key}" twice.`);
    keysSeen.add(entry.key);
  }
  return entries;
}
