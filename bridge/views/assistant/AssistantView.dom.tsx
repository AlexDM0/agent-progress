/**
 * The Assistant view against fake controls and a fake transcript stream. What matters: the live session's transcript shows, planted
 * markup as text; open and handled incidents show with their moves and escalations, an applied default in the warning state; no live
 * session shows "booting a fresh session"; and the chat box posts `job-message`, its message queued until a user line carries it.
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
import { AssistantView }                               from './AssistantView.tsx';

const AT = '2026-10-29T20:00:00+01:00';
const PLANTED = '<script>window.planted = true</script><img src=x onerror="window.planted = true">';

const BOARD: ConversationBoardDocument = {
  jobs: [{
    id: 'J9', kind: 'orchestrator', ticketIds: [], state: 'running'
  }],
  decisions: [],
  incidents: [{
    id:              'I3',
    kind:            'setup-failed',
    ticketIds:       ['042'],
    jobId:           'J4',
    facts:           { step: 'install' },
    defaultMove:     'worktree-repair',
    deliveredInTurn: { jobId: 'J9', chatSequence: 2 },
    openedAt:        AT
  }],
  questionHistory: [
    {
      kind: 'incident-opened', at: AT, incidentId: 'I1', fields: { kind: 'merge-gate-failed', ticketIds: ['040'] }
    },
    {
      kind: 'incident-opened', at: AT, incidentId: 'I2', fields: { kind: 'system-question', ticketIds: ['041'] }
    },
    {
      kind: 'incident-handled', at: AT, incidentId: 'I1', fields: { move: 'merge-fixer' }
    },
    {
      kind: 'incident-escalated', at: AT, incidentId: 'I2', fields: { decisionId: 'E5' }
    },
    {
      kind: 'incident-opened', at: AT, incidentId: 'I6', fields: { kind: 'quiet-job', ticketIds: ['043'] }
    },
    {
      kind: 'incident-defaulted', at: AT, incidentId: 'I6', fields: { move: 'open-quiet-job-decision', cause: 'turn-closed' }
    },
  ],
};

afterEach(() => {
  cleanup();
});

describe('the Assistant view', () => {
  test('follows the live session\'s transcript, planted markup reaching the DOM only as text', () => {
    const transcripts = fakeTranscripts();
    fakeControls().render(<AssistantView board={BOARD} followTranscript={transcripts.follow} />);
    expect(transcripts.followedJobs()).toEqual(['J9']);
    transcripts.feed('J9', [{ cursor: '1.1', role: 'assistant', text: `Reading the incidents ${PLANTED}` }]);
    expect(within(screen.getByRole('list', { name: 'Assistant transcript' })).getByText(`Reading the incidents ${PLANTED}`)).toBeDefined();
    expect(document.querySelector('img, script')).toBeNull();
  });

  test('shows open and handled incidents with their moves and escalations, an applied default in the warning state', () => {
    fakeControls().render(<AssistantView board={BOARD} followTranscript={fakeTranscripts().follow} />);
    const open = screen.getByRole('listitem', { name: 'Incident I3' });
    expect(within(open).getByText('setup-failed · ticket 042 · delivered · default worktree-repair')).toBeDefined();
    expect(within(screen.getByRole('listitem', { name: 'Incident I1' })).getByText('handled with merge-fixer')).toBeDefined();
    expect(within(screen.getByRole('listitem', { name: 'Incident I2' })).getByText('escalated to User as E5')).toBeDefined();
    const defaulted = screen.getByRole('listitem', { name: 'Incident I6' });
    expect(defaulted.dataset['state']).toBe('warning');
    expect(within(defaulted).getByText('default applied: open-quiet-job-decision (turn-closed)')).toBeDefined();
  });

  test('says a fresh session is booting while none is up, its chat disabled', () => {
    fakeControls().render(<AssistantView board={{ ...BOARD, jobs: [] }} followTranscript={fakeTranscripts().follow} />);
    expect(screen.getByRole('status').textContent).toBe('Booting a fresh session.');
    fireEvent.change(screen.getByLabelText('Message the Assistant'), { target: { value: 'Hello' } });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled).toBe(true);
  });

  test('the chat box sends job-message, queued until a user line of the transcript carries it', async () => {
    const controls = fakeControls();
    const transcripts = fakeTranscripts();
    controls.render(<AssistantView board={BOARD} followTranscript={transcripts.follow} />);
    fireEvent.change(screen.getByLabelText('Message the Assistant'), { target: { value: 'Look at 042 first' } });
    await clickSettled(screen.getByRole('button', { name: 'Send' }));
    expect(controls.sent).toEqual([{ kind: 'job-message', jobId: 'J9', text: 'Look at 042 first' }]);
    expect(screen.getByText('Queued until the Assistant is idle: Look at 042 first')).toBeDefined();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Message the Assistant').value).toBe('');
    expect(transcripts.followedJobs()).toEqual(['J9']);
    transcripts.feed('J9', [{ cursor: '1.2', role: 'user', text: 'Look at 042 first' }]);
    expect(within(screen.getByRole('list', { name: 'Assistant transcript' })).getByText('Look at 042 first')).toBeDefined();
    expect(screen.queryByText('Queued until the Assistant is idle: Look at 042 first')).toBeNull();
  });
});
