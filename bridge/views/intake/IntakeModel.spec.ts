/**
 * The Intake view's model. What matters: live product-owner sessions come from the board and closed ones from the log, a session reopened
 * by a message shows once, as live; an intake stopped any other way is not offered a chat; each session carries its own drafts and
 * questions.
 */
import { describe, expect, test } from 'bun:test';

import type { ConversationBoardDocument } from '../../@types/ConversationDocuments.ts';
import { IntakeModelUtil }                from './IntakeModel.ts';

const AT = '2026-10-29T20:00:00+01:00';

function launched(jobId: string, kind: string) {
  return {
    kind: 'job-launched', at: AT, jobId, fields: { kind, ticketIds: [] }
  };
}

function ended(jobId: string, outcome: string) {
  return {
    kind: 'job-ended', at: AT, jobId, fields: { outcome }
  };
}

const BOARD: ConversationBoardDocument = {
  jobs: [{
    id: 'J7', kind: 'product-owner', ticketIds: [], state: 'running', intake: { text: 'Add an export' }
  }],
  decisions: [{
    id: 'E4', kind: 'agent-question', ticketIds: [], jobId: 'J7', askedBy: 'product-owner', questions: [], context: '', openedAt: AT
  }],
  incidents: [],
  page:      {
    tickets: [{
      id: '060', title: 'Export as CSV', status: 'draft', filedByJob: 'J7'
    }, {
      id: '061', title: 'Older', status: 'draft', filedByJob: 'J2'
    }]
  },
  questionHistory: [
    launched('J2', 'product-owner'),
    ended('J2', 'closed'),
    launched('J5', 'product-owner'),
    ended('J5', 'stopped'),
    launched('J7', 'product-owner'),
    ended('J7', 'closed'),
    launched('J8', 'orchestrator'),
    ended('J8', 'closed'),
  ],
};

describe('IntakeModelUtil.intakeSessionsOf', () => {
  test('lists the live sessions, then the closed ones, each with its drafts and questions', () => {
    expect(IntakeModelUtil.intakeSessionsOf(BOARD).map(({
      jobId, state, closed, requestText, drafts, questions
    }) => ({
      jobId, state, closed, requestText, drafts: drafts.map((ticket) => ticket.id), questions: questions.map((decision) => decision.id)
    }))).toEqual([
      {
        jobId: 'J7', state: 'running', closed: false, requestText: 'Add an export', drafts: ['060'], questions: ['E4']
      },
      {
        jobId: 'J2', state: 'closed', closed: true, requestText: null, drafts: ['061'], questions: []
      },
    ]);
  });
});
