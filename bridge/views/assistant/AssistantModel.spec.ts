/**
 * The Assistant view's model. What matters: no live Assistant reads as booting; an open incident shows its default and whether it was
 * delivered; a settled one is read back from the log with every move, note and escalation, a defaulted one as such; and a message stays
 * queued until a `user` line of the transcript carries it.
 */
import { describe, expect, test } from 'bun:test';

import type { ConversationBoardDocument } from '../../@types/ConversationDocuments.ts';
import { AssistantModelUtil }             from './AssistantModel.ts';

const AT = '2026-10-29T20:00:00+01:00';

const BOARD: ConversationBoardDocument = {
  jobs: [{
    id: 'J9', kind: 'orchestrator', ticketIds: [], state: 'running'
  }],
  decisions: [],
  incidents: [{
    id: 'I3', kind: 'setup-failed', ticketIds: ['042'], jobId: 'J4', facts: { step: 'install' }, defaultMove: 'worktree-repair', deliveredInTurn: null, openedAt: AT
  }],
  questionHistory: [
    {
      kind: 'incident-opened', at: AT, incidentId: 'I1', fields: { kind: 'merge-gate-failed', ticketIds: ['040'] }
    },
    {
      kind: 'incident-opened', at: AT, incidentId: 'I2', fields: { kind: 'system-question', ticketIds: ['041'] }
    },
    {
      kind: 'incident-opened', at: AT, incidentId: 'I3', fields: { kind: 'setup-failed', ticketIds: ['042'] }
    },
    {
      kind: 'incident-noted', at: AT, incidentId: 'I2', fields: { text: 'Needs the owner' }
    },
    {
      kind: 'incident-escalated', at: AT, incidentId: 'I2', fields: { decisionId: 'E5' }
    },
    {
      kind: 'incident-defaulted', at: AT, incidentId: 'I1', fields: { move: 'merge-abort', cause: 'no-orchestrator' }
    },
  ],
};

describe('AssistantModelUtil.assistantModelOf', () => {
  test('a running Assistant job is the session, and one still launching reads as booting', () => {
    expect(AssistantModelUtil.assistantModelOf(BOARD).assistantJobId).toBe('J9');
    expect(AssistantModelUtil.assistantModelOf({
      ...BOARD,
      jobs: [{
        id: 'J10', kind: 'orchestrator', ticketIds: [], state: 'launching'
      }]
    }).assistantJobId).toBeNull();
    expect(AssistantModelUtil.assistantModelOf({ ...BOARD, jobs: [] }).assistantJobId).toBeNull();
  });

  test('an open incident carries its default, its facts and whether it was delivered', () => {
    expect(AssistantModelUtil.assistantModelOf(BOARD).openIncidents).toEqual([{
      incidentId: 'I3', kind: 'setup-failed', ticketIds: ['042'], settlement: 'open', defaultMove: 'worktree-repair', delivered: false, facts: [['step', 'install']], steps: []
    }]);
  });

  test('settled incidents come back from the log, newest first, with their moves, notes and escalations', () => {
    const { settledIncidents } = AssistantModelUtil.assistantModelOf(BOARD);
    expect(settledIncidents.map(({ incidentId, settlement, steps }) => ({ incidentId, settlement, steps: steps.map((step) => step.text) }))).toEqual([
      { incidentId: 'I2', settlement: 'escalated', steps: ['note: Needs the owner', 'escalated to User as E5'] },
      { incidentId: 'I1', settlement: 'defaulted', steps: ['default applied: merge-abort (no-orchestrator)'] },
    ]);
  });
});

describe('AssistantModelUtil.queuedMessagesOf', () => {
  test('a sent message is queued until a user line carries it', () => {
    const entries = [{ cursor: '1.4', role: 'user', text: 'User says: look at 042 first' }];
    expect(AssistantModelUtil.queuedMessagesOf(['look at 042 first', 'then 043'], entries)).toEqual(['then 043']);
  });
});
