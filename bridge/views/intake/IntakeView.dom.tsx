/**
 * The Intake view against fake controls and a fake transcript stream. What matters: New request posts `intake-start`; each session shows
 * its drafts and its questions inline, sends follow-ups as `job-message` and closes with `intake-close`; a closed session keeps its
 * transcript and chat input, marked closed with no error styling, a message to it posts `job-message`, and once the Overseer resumes it
 * the session shows running again.
 */
import {
  cleanup,
  fireEvent,
  screen,
  within
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { ConversationBoardDocument }              from '../../@types/ConversationDocuments.ts';
import { clickSettled, fakeControls, fakeTranscripts } from '../../testing/FakeControls.ts';
import { IntakeView }                                  from './IntakeView.tsx';

const AT = '2026-10-29T20:00:00+01:00';

const BOARD: ConversationBoardDocument = {
  jobs: [{
    id: 'J7', kind: 'product-owner', ticketIds: [], state: 'running', intake: { text: 'Add an export' }
  }],
  decisions: [{
    id:        'E4',
    kind:      'agent-question',
    ticketIds: [],
    jobId:     'J7',
    askedBy:   'product-owner',
    context:   '',
    openedAt:  AT,
    questions: [{
      question: 'CSV or JSON?', header: 'Format', multiSelect: false, options: [{ label: 'CSV', description: '' }, { label: 'JSON', description: '' }]
    }],
  }],
  incidents: [],
  page:      {
    tickets: [{
      id: '060', title: 'Export as CSV', status: 'draft', filedByJob: 'J7'
    }, {
      id: '061', title: 'Older request', status: 'draft', filedByJob: 'J2'
    }]
  },
  questionHistory: [
    {
      kind: 'job-launched', at: AT, jobId: 'J2', fields: { kind: 'product-owner', ticketIds: [] }
    },
    {
      kind: 'job-ended', at: AT, jobId: 'J2', fields: { outcome: 'closed' }
    },
  ],
};

afterEach(() => {
  cleanup();
});

describe('the Intake view', () => {
  test('New request posts intake-start with the request text', async () => {
    const controls = fakeControls();
    controls.render(<IntakeView board={BOARD} followTranscript={fakeTranscripts().follow} />);
    const newRequest = screen.getByRole('region', { name: 'New request' });
    fireEvent.change(within(newRequest).getByLabelText('New request'), { target: { value: 'Add a CSV export' } });
    await clickSettled(within(newRequest).getByRole('button', { name: 'New request' }));
    expect(controls.sent).toEqual([{ kind: 'intake-start', text: 'Add a CSV export' }]);
  });

  test('a live session shows its drafts and questions inline, chats with job-message and closes with intake-close', async () => {
    const controls = fakeControls();
    const transcripts = fakeTranscripts();
    controls.render(<IntakeView board={BOARD} followTranscript={transcripts.follow} />);
    const session = screen.getByRole('listitem', { name: 'Intake J7' });
    expect(within(session).getByText('060 Export as CSV · draft')).toBeDefined();
    expect(within(within(session).getByRole('list', { name: 'Questions of J7' })).getByText('CSV or JSON?')).toBeDefined();
    transcripts.feed('J7', [{ cursor: '1.1', role: 'assistant', text: 'Which format do you need?' }]);
    expect(within(session).getByText('Which format do you need?')).toBeDefined();
    fireEvent.click(within(session).getByLabelText('a. CSV'));
    await clickSettled(within(session).getByRole('button', { name: 'Answer' }));
    fireEvent.change(within(session).getByLabelText('Message J7'), { target: { value: 'Also a header row' } });
    await clickSettled(within(session).getByRole('button', { name: 'Send' }));
    await clickSettled(within(session).getByRole('button', { name: 'Close intake' }));
    expect(controls.sent).toEqual([
      { kind: 'decision-answer', decisionId: 'E4', answer: { form: 'letters', choices: ['a'] } },
      { kind: 'job-message', jobId: 'J7', text: 'Also a header row' },
      { kind: 'intake-close', jobId: 'J7', proposedDraftSets: [] },
    ]);
  });

  test('a closed session keeps its transcript and chat, marked closed without error styling, and shows running once resumed', async () => {
    const controls = fakeControls();
    const transcripts = fakeTranscripts();
    const view = controls.render(<IntakeView board={BOARD} followTranscript={transcripts.follow} />);
    const closed = screen.getByRole('listitem', { name: 'Intake J2' });
    expect(closed.dataset['state']).toBe('closed');
    expect(closed.querySelector('.bridge-refusal, .bridge-banner-error, [role="alert"]')).toBeNull();
    expect(within(closed).getByText('closed: a message resumes it')).toBeDefined();
    expect(within(closed).queryByRole('button', { name: 'Close intake' })).toBeNull();
    transcripts.feed('J2', [{ cursor: '1.9', role: 'assistant', text: 'Filed 061 as a draft.' }]);
    expect(within(closed).getByText('Filed 061 as a draft.')).toBeDefined();
    fireEvent.change(within(closed).getByLabelText('Message J2'), { target: { value: 'One more thing' } });
    await clickSettled(within(closed).getByRole('button', { name: 'Send' }));
    expect(controls.sent).toEqual([{ kind: 'job-message', jobId: 'J2', text: 'One more thing' }]);
    const resumed = {
      ...BOARD,
      jobs: [...BOARD.jobs, {
        id: 'J2', kind: 'product-owner', ticketIds: [], state: 'running'
      }]
    };
    view.rerender(<IntakeView board={resumed} followTranscript={transcripts.follow} />);
    const reopened = screen.getAllByRole('listitem', { name: 'Intake J2' });
    expect(reopened).toHaveLength(1);
    expect(reopened[0]?.dataset['state']).toBe('open');
    expect(within(reopened[0] as HTMLElement).getByText('running')).toBeDefined();
  });
});
