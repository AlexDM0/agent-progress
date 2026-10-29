/**
 * What a fresh Assistant boots with. What matters: it runs Sonnet at medium effort while every other role stays Opus at medium; its first
 * message is chat 1, carrying every open incident, the newest incident records and the board; and an incident opened after its boot pass is
 * never put into a first message already sent. The launch command line it renders is held by the Assistant rows of
 * `src/services/runner/CrashMatrix.spec.ts`.
 */
import { describe, expect, test } from 'bun:test';

import type { Job, JobKind, JobRole }  from '../../lib/tracker-model/@types/Job.ts';
import { ASSISTANT_HISTORY_RECORDS }   from '../../shared/constants/RunnerLimits.ts';
import { boardFixture, ticketFixture } from '../../testing/BoardFixtures.ts';
import { AssistantBoot }               from './AssistantBoot.ts';

const FIXTURE_AT = '2026-10-28T10:00:00+01:00';

function jobOf(kind: JobKind, role: JobRole): Job {
  return {
    id:                 'J1',
    kind,
    role,
    ticketIds:          [],
    parentJobId:        null,
    attempt:            1,
    target:             null,
    state:              'running',
    hostInstance:       1,
    eventCursor:        { instance: 1, sequence: 0 },
    answeredRequestIds: [],
    crashResumes:       0,
  };
}

const ASSISTANT_LAUNCH = {
  kind: 'orchestrator', role: 'orchestrator', ticketIds: [], parentJobId: null, attempt: 1, target: null
} as const;

describe('the model and effort per role (A1)', () => {
  const roles: readonly [JobKind, JobRole, string, string][] = [
    ['build', 'builder', 'opus', 'medium'],
    ['review', 'reviewer', 'opus', 'medium'],
    ['merge-agent', 'merge-fix', 'opus', 'medium'],
    ['merge-agent', 'resolver', 'opus', 'medium'],
    ['merge-agent', 'resolution-review', 'opus', 'medium'],
    ['product-owner', 'product-owner', 'opus', 'medium'],
    ['orchestrator', 'orchestrator', 'sonnet', 'medium'],
  ];

  test.each(roles)('a %s job as %s launches --model %s --effort %s', (kind, role, model, effort) => {
    const settings = AssistantBoot.launchSettingsOf(jobOf(kind, role));
    expect([settings.model, settings.effort]).toEqual([model, effort]);
  });
});

describe('the first message comes from the board (A1)', () => {
  test('a booted Assistant is delivered every open incident as chat 1, with the newest incident records and the board summary', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-progress' })] });
    for (let i = 0; i <= ASSISTANT_HISTORY_RECORDS; i += 1) {
      board.openIncident({
        kind: 'blocked', ticketIds: ['001'], jobId: null, facts: { attempt: String(i) }, defaultMove: 'ticket-park'
      }, FIXTURE_AT);
    }
    const before = new Set(board.jobs().map((job) => job.id));
    const { job } = board.launchJob(ASSISTANT_LAUNCH, FIXTURE_AT);

    AssistantBoot.deliverOpenIncidentsAtBoot(board, before);
    const facts = AssistantBoot.assistantFactsOf(board, job);

    expect(facts?.incidents).toHaveLength(ASSISTANT_HISTORY_RECORDS + 1);
    expect(board.incidents().every((incident) => incident.deliveredInTurn?.jobId === job.id && incident.deliveredInTurn.chatSequence === 1)).toBe(true);
    expect(facts?.history).toHaveLength(ASSISTANT_HISTORY_RECORDS);
    expect(facts?.summary).toMatchObject({ ticketCountByStatus: { 'in-progress': 1 }, openDecisionCount: 0 });
  });

  test('an incident opened after the boot pass waits for the next idle point, never chat 1; no other job gets the facts', () => {
    const { board } = boardFixture();
    const { job } = board.launchJob(ASSISTANT_LAUNCH, FIXTURE_AT);
    const { incident } = board.openIncident({
      kind: 'blocked', ticketIds: [], jobId: null, facts: {}, defaultMove: 'ticket-park'
    }, FIXTURE_AT);

    AssistantBoot.deliverOpenIncidentsAtBoot(board, new Set([job.id]));

    expect(board.incidentById(incident?.id ?? '')?.deliveredInTurn).toBeNull();
    expect(AssistantBoot.assistantFactsOf(board, jobOf('build', 'builder'))).toBeNull();
  });
});
