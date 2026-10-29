/**
 * The Questions inbox against fake controls. What matters: each decision shows its questions and options exactly as asked, an escalated
 * report as the agent wrote it, and the answer posts `decision-answer` with the chosen letters or free text; the first answer wins and a
 * later one shows the Overseer's refusal verbatim; the open-question count leads the tab title and a new decision raises one notification;
 * the triage list offers Ready, Edit and Abandon as their commands; and planted markup in a question reaches the DOM only as text.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { ConversationBoardDocument, DecisionDocument } from '../../@types/ConversationDocuments.ts';
import { clickSettled, fakeControls }                       from '../../testing/FakeControls.ts';
import { QuestionAlerts, type QuestionNotifier }            from './QuestionAlerts.ts';
import { QuestionsView }                                    from './QuestionsView.tsx';

const AT = '2026-10-29T20:00:00+01:00';
const PLANTED = '<img src=x onerror="window.planted = true">';

const AGENT_QUESTION: DecisionDocument = {
  id:        'E2',
  kind:      'agent-question',
  ticketIds: ['042'],
  jobId:     'J3',
  askedBy:   'builder',
  context:   '',
  openedAt:  AT,
  questions: [{
    question:    `Which store should the cache use? ${PLANTED}`,
    header:      'Store',
    multiSelect: false,
    options:     [{ label: 'Disk', description: 'Survives a restart' }, { label: 'Memory', description: 'Faster' }],
  }],
};

const ESCALATED: DecisionDocument = {
  ...AGENT_QUESTION,
  id:        'E3',
  questions: [
    {
      question: 'The Brief names bridge/old/, which does not exist. Where?', header: 'ticket', multiSelect: false, options: [{ label: 'bridge/views/', description: '' }]
    },
    {
      question: 'Which targets?', header: 'Targets', multiSelect: true, options: [{ label: 'main', description: '' }, { label: 'group', description: '' }]
    },
  ],
};

const BOARD: ConversationBoardDocument = {
  jobs: [{
    id: 'J3', kind: 'build', ticketIds: ['042'], state: 'waiting-for-answer'
  }],
  decisions: [AGENT_QUESTION, ESCALATED],
  incidents: [],
  notices:   [{ kind: 'dirty-main-checkout' }],
  page:      {
    tickets: [{
      id: '050', title: 'Finding for User', status: 'draft', priority: 'low', filedByJob: 'J3', findingRoute: 'user'
    }]
  },
  questionHistory: [{
    kind: 'incident-escalated', at: AT, incidentId: 'I4', fields: { decisionId: 'E3' }
  }],
};

function notifierSpy(): QuestionNotifier & { readonly titles: string[]; readonly notified: string[] } {
  const titles: string[] = [];
  const notified: string[] = [];
  return {
    titles,
    notified,
    allowance:         () => 'granted',
    askAllowance:      () => Promise.resolve('granted'),
    notify:            (title) => notified.push(title),
    setDocumentTitle:  (title) => titles.push(title),
    baseDocumentTitle: 'agent-progress',
  };
}

afterEach(() => {
  cleanup();
});

describe('the Questions inbox', () => {
  test('shows each question and its options exactly as asked, planted markup as text, and the escalated report marked', () => {
    fakeControls().render(<QuestionsView board={BOARD} notifier={notifierSpy()} />);
    const card = screen.getByRole('listitem', { name: 'Question E2' });
    expect(within(card).getByText(`Which store should the cache use? ${PLANTED}`)).toBeDefined();
    expect(within(card).getByLabelText('a. Disk')).toBeDefined();
    expect(within(card).getByText('Survives a restart')).toBeDefined();
    expect(document.querySelector('img')).toBeNull();
    const escalated = screen.getByRole('listitem', { name: 'Question E3' });
    expect(within(escalated).getByText('The Brief names bridge/old/, which does not exist. Where?')).toBeDefined();
    expect(within(escalated).getByText(/escalated by the Assistant/)).toBeDefined();
  });

  test('answers with decision-answer: an option letter, or free text', async () => {
    const controls = fakeControls();
    controls.render(<QuestionsView board={BOARD} notifier={notifierSpy()} />);
    const card = screen.getByRole('listitem', { name: 'Question E2' });
    const answer = within(card).getByRole<HTMLButtonElement>('button', { name: 'Answer' });
    expect(answer.disabled).toBe(true);
    fireEvent.click(within(card).getByLabelText('b. Memory'));
    await clickSettled(answer);
    fireEvent.change(within(card).getByLabelText('Free-text answer to E2'), { target: { value: 'Disk, but bounded' } });
    await clickSettled(answer);
    expect(controls.sent).toEqual([
      { kind: 'decision-answer', decisionId: 'E2', answer: { form: 'letters', choices: ['b'] } },
      { kind: 'decision-answer', decisionId: 'E2', answer: { form: 'text', text: 'Disk, but bounded' } },
    ]);
  });

  test('a multi-select question takes several letters, and every question needs a choice', async () => {
    const controls = fakeControls();
    controls.render(<QuestionsView board={BOARD} notifier={notifierSpy()} />);
    const card = screen.getByRole('listitem', { name: 'Question E3' });
    const answer = within(card).getByRole<HTMLButtonElement>('button', { name: 'Answer' });
    fireEvent.click(within(card).getByLabelText('a. bridge/views/'));
    expect(answer.disabled).toBe(true);
    fireEvent.click(within(card).getByLabelText('b. group'));
    fireEvent.click(within(card).getByLabelText('a. main'));
    await clickSettled(answer);
    expect(controls.sent).toEqual([{ kind: 'decision-answer', decisionId: 'E3', answer: { form: 'letters', choices: ['a', 'ab'] } }]);
  });

  test('the first answer wins: a later one shows the Overseer\'s refusal verbatim', async () => {
    const controls = fakeControls();
    controls.render(<QuestionsView board={BOARD} notifier={notifierSpy()} />);
    const card = screen.getByRole('listitem', { name: 'Question E2' });
    fireEvent.click(within(card).getByLabelText('a. Disk'));
    controls.answerNextWith({ verdict: 'refused', refusal: 'Decision E2 is already answered.' });
    await clickSettled(within(card).getByRole('button', { name: 'Answer' }));
    expect(within(card).getByRole('status').textContent).toBe('Decision E2 is already answered.');
  });

  test('shows the notices and an answered decision from the log', () => {
    const answeredBoard = {
      ...BOARD,
      questionHistory: [{
        kind: 'decision-answered', at: AT, decisionId: 'E1', fields: { answer: { 'Which?': 'Disk' } }
      }]
    };
    fakeControls().render(<QuestionsView board={answeredBoard} notifier={notifierSpy()} />);
    expect(within(screen.getByRole('region', { name: 'Notices' })).getByText('dirty-main-checkout')).toBeDefined();
    expect(within(screen.getByRole('listitem', { name: 'Answered E1' })).getByText('Which? Disk')).toBeDefined();
  });
});

describe('the Low-priority triage list', () => {
  test('shows the job and ticket it was found on and whether the agent asked, and offers Ready, Edit and Abandon', async () => {
    const controls = fakeControls();
    controls.render(<QuestionsView board={BOARD} notifier={notifierSpy()} />);
    const entry = screen.getByRole('listitem', { name: 'Triage 050' });
    expect(within(entry).getByText('draft · found by job J3 · on ticket 042 · the agent asked for User\'s input')).toBeDefined();
    await clickSettled(within(entry).getByRole('button', { name: 'Ready' }));
    await clickSettled(within(entry).getByRole('button', { name: 'Abandon' }));
    fireEvent.click(within(entry).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(entry).getByLabelText('Title of 050'), { target: { value: 'Finding for User, sharpened' } });
    await clickSettled(within(entry).getByRole('button', { name: 'Save' }));
    expect(controls.sent).toEqual([
      { kind: 'ticket-ready', ticketReferences: ['050'] },
      { kind: 'ticket-abandon', ticketReference: '050' },
      {
        kind: 'ticket-edit', ticketReference: '050', title: 'Finding for User, sharpened', bodyText: null, appendsBody: false, allowsPastPending: false
      },
    ]);
    expect(screen.getByRole('heading', { name: 'Open questions (2)' })).toBeDefined();
  });
});

describe('questions reach User wherever User is', () => {
  function AlertsProbe({ decisions, notifier }: { readonly decisions: readonly DecisionDocument[] | null; readonly notifier: QuestionNotifier }) {
    QuestionAlerts.useOpenQuestionAlerts(decisions, notifier);
    return null;
  }

  test('the count leads the tab title, and only a decision opened after the first board raises a notification', () => {
    const notifier = notifierSpy();
    const view = render(<AlertsProbe decisions={[AGENT_QUESTION]} notifier={notifier} />);
    act(() => view.rerender(<AlertsProbe decisions={[AGENT_QUESTION, ESCALATED]} notifier={notifier} />));
    act(() => view.rerender(<AlertsProbe decisions={[]} notifier={notifier} />));
    expect(notifier.titles).toEqual(['(1) agent-progress', '(2) agent-progress', 'agent-progress']);
    expect(notifier.notified).toEqual(['Question E3']);
  });

  test('the notification permission is asked for only from a click', async () => {
    let asked = 0;
    const notifier = {
      ...notifierSpy(),
      allowance:    () => 'default' as const,
      askAllowance: () => {
        asked += 1;
        return Promise.resolve('granted' as const);
      }
    };
    fakeControls().render(<QuestionsView board={BOARD} notifier={notifier} />);
    expect(asked).toBe(0);
    await clickSettled(screen.getByRole('button', { name: 'Notify me of new questions' }));
    expect(asked).toBe(1);
    expect(screen.queryByRole('button', { name: 'Notify me of new questions' })).toBeNull();
  });
});
