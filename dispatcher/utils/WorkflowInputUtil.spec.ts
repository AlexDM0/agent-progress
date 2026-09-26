/**
 * The dispatcher's input edge. What the run relies on is that every guard the old script kept reads a malformed shape the same way: the
 * argument refusals in their order, the fallbacks for optional arguments and for an unstated model, effort or priority, a status block
 * the run cannot act on read as unreadable and its lists as unlisted, and the replies' few decided fields told apart from echoed text.
 */
import { describe, expect, test } from 'bun:test';

import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL } from '../../src/lib/tracker-model/constants/AgentSettings.ts';
import type { DispatchWork }                         from '../@types/DispatchWork.ts';
import { WorkflowInputUtil }                         from './WorkflowInputUtil.ts';

const {
  settingsVerdictOf,
  statusReadingOf,
  surveyReadingOf,
  ticketSettingsLookupOf,
  finishedReadingOf,
} = WorkflowInputUtil;

const REQUIRED_ARGUMENTS = { mainCheckout: '/scratch/example-repository', mainLine: 'main', checkCommand: 'example-check' };

const DEFAULT_AGENT_MODEL_AND_EFFORT = { model: DEFAULT_AGENT_MODEL, effort: DEFAULT_AGENT_EFFORT };

const STATUS_BLOCK = {
  limit:          2,
  agentsInFlight: 1,
  freeSlots:      1,
  readyTicketIds: ['001'],
  readyTickets:   [{
    id: '001', priority: 'high', model: 'sonnet', effort: 'high' 
  }],
  dispatcherState:       'running',
  inProgressTicketIds:   ['002'],
  inProgressReviewOfIds: ['003'],
  heldTicketIds:         ['004'],
};

const BUILD_WORK: DispatchWork = { kind: 'build', ticketId: '001', previousPass: null };

const REVIEW_WORK: DispatchWork = {
  kind: 'review', ticketId: '001', round: 1, rereviewFirst: false, earlierReviewerDied: false 
};

const REVIEWER_REPLY = {
  round:          1,
  verdict:        'released',
  releaseReason:  '',
  reworkedLines:  0,
  findings:       [{ class: 'naming', file: 'a.ts', summary: 'naming in a.ts' }],
  filedTicketIds: ['010'],
  status:         STATUS_BLOCK,
};

describe('the Workflow arguments', () => {
  test('valid arguments map to settings with every optional argument at its fallback', () => {
    expect(settingsVerdictOf(REQUIRED_ARGUMENTS)).toEqual({
      verdict:  'valid',
      settings: {
        ...REQUIRED_ARGUMENTS,
        installCommand:     '',
        includeLowPriority: false,
        ticketIds:          null,
        readyTickets:       [],
        runLabel:           'whole-board',
      },
    });
  });

  // The refusal sentence names one argument, so the first missing one in the stated order is the one it names.
  test('the first missing required argument is refused, in the order mainCheckout, mainLine, checkCommand', () => {
    expect(settingsVerdictOf({ ticketIds: [] })).toEqual({ verdict: 'invalid', reason: 'missing-argument', argumentName: 'mainCheckout' });
    expect(settingsVerdictOf({ mainCheckout: '/scratch/example-repository' })).toEqual({ verdict: 'invalid', reason: 'missing-argument', argumentName: 'mainLine' });
    expect(settingsVerdictOf({ ...REQUIRED_ARGUMENTS, checkCommand: undefined })).toEqual({ verdict: 'invalid', reason: 'missing-argument', argumentName: 'checkCommand' });
  });

  test('an empty or non-string required argument counts as missing', () => {
    expect(settingsVerdictOf({ ...REQUIRED_ARGUMENTS, mainLine: '' })).toMatchObject({ verdict: 'invalid', argumentName: 'mainLine' });
    expect(settingsVerdictOf({ ...REQUIRED_ARGUMENTS, mainLine: 7 })).toMatchObject({ verdict: 'invalid', argumentName: 'mainLine' });
  });

  test('arguments that are not an object read as none given', () => {
    expect(settingsVerdictOf(null)).toEqual({ verdict: 'invalid', reason: 'missing-argument', argumentName: 'mainCheckout' });
    expect(settingsVerdictOf('example')).toEqual({ verdict: 'invalid', reason: 'missing-argument', argumentName: 'mainCheckout' });
  });

  test('ticket ids given as anything but a non-empty list of non-empty strings are refused', () => {
    for (const ticketIds of [[], [''], ['001', 2], '001', null]) {
      expect(settingsVerdictOf({ ...REQUIRED_ARGUMENTS, ticketIds })).toEqual({ verdict: 'invalid', reason: 'invalid-ticket-ids' });
    }
  });

  test('ticket ids are deduplicated in first-seen order and name the run', () => {
    const verdict = settingsVerdictOf({ ...REQUIRED_ARGUMENTS, ticketIds: ['002', '001', '002'] });
    expect(verdict).toMatchObject({ verdict: 'valid', settings: { ticketIds: ['002', '001'], runLabel: 'ticket-002+001' } });
  });

  test('an install command is kept only when given as a string', () => {
    expect(settingsVerdictOf({ ...REQUIRED_ARGUMENTS, installCommand: 'example-install' })).toMatchObject({ settings: { installCommand: 'example-install' } });
    expect(settingsVerdictOf({ ...REQUIRED_ARGUMENTS, installCommand: 3 })).toMatchObject({ settings: { installCommand: '' } });
  });

  // Starting untriaged low work cannot be undone, so only an explicit true admits it.
  test('low priority is included only for an explicit true', () => {
    expect(settingsVerdictOf({ ...REQUIRED_ARGUMENTS, includeLowPriority: true })).toMatchObject({ settings: { includeLowPriority: true } });
    expect(settingsVerdictOf({ ...REQUIRED_ARGUMENTS, includeLowPriority: 'yes' })).toMatchObject({ settings: { includeLowPriority: false } });
  });

  test('ready ticket entries take the default model and effort for an absent or empty one, and read an unstated or unknown priority as low', () => {
    const verdict = settingsVerdictOf({
      ...REQUIRED_ARGUMENTS,
      readyTickets: [
        {
          id: '001', priority: 'high', model: 'sonnet', effort: 'high', held: true 
        },
        { id: '002', model: '', effort: '' },
        { id: '003', priority: 'urgent', held: 'yes' },
      ],
    });
    expect(verdict).toMatchObject({
      settings: {
        readyTickets: [
          {
            id: '001', priority: 'high', agentModelAndEffort: { model: 'sonnet', effort: 'high' }, held: true 
          },
          {
            id: '002', priority: 'low', agentModelAndEffort: DEFAULT_AGENT_MODEL_AND_EFFORT, held: false 
          },
          {
            id: '003', priority: 'low', agentModelAndEffort: DEFAULT_AGENT_MODEL_AND_EFFORT, held: false 
          },
        ],
      },
    });
  });

  test('ready tickets given as anything but a list read as none, and entries without an object or a string id are dropped', () => {
    expect(settingsVerdictOf({ ...REQUIRED_ARGUMENTS, readyTickets: 'none' })).toMatchObject({ settings: { readyTickets: [] } });
    const verdict = settingsVerdictOf({ ...REQUIRED_ARGUMENTS, readyTickets: [null, 'example', { id: 5 }, { id: '001' }] });
    expect(verdict).toMatchObject({ settings: { readyTickets: [{ id: '001' }] } });
  });
});

describe('a status block', () => {
  test('a block with its list of ready ticket ids maps every field the run reads', () => {
    expect(statusReadingOf(STATUS_BLOCK)).toEqual({
      limit:          2,
      agentsInFlight: 1,
      readyTicketIds: ['001'],
      readyTickets:   [{
        id: '001', priority: 'high', agentModelAndEffort: { model: 'sonnet', effort: 'high' }, held: false 
      }],
      dispatcherIsStopped:   false,
      inProgressTicketIds:   ['002'],
      inProgressReviewOfIds: ['003'],
      heldTicketIds:         ['004'],
    });
  });

  test('nothing, a non-object or a block without an array of ready ticket ids is unreadable', () => {
    expect(statusReadingOf(null)).toBe('unreadable');
    expect(statusReadingOf('example')).toBe('unreadable');
    expect(statusReadingOf({ ...STATUS_BLOCK, readyTicketIds: '001' })).toBe('unreadable');
    expect(statusReadingOf({ limit: 2, agentsInFlight: 1, dispatcherState: 'running' })).toBe('unreadable');
  });

  // A block without these lists confirms nothing and keeps the last held set, which is not what an empty list says.
  test('the in-progress and held lists read as unlisted when they are not arrays, not as empty', () => {
    const reading = statusReadingOf({
      ...STATUS_BLOCK, inProgressTicketIds: undefined, inProgressReviewOfIds: null, heldTicketIds: 'none' 
    });
    expect(reading).toMatchObject({ inProgressTicketIds: 'unlisted', inProgressReviewOfIds: 'unlisted', heldTicketIds: 'unlisted' });
  });

  test('ready tickets that are not a list read as none', () => {
    expect(statusReadingOf({ ...STATUS_BLOCK, readyTickets: undefined })).toMatchObject({ readyTickets: [] });
  });

  test('only the stopped state stops the run', () => {
    expect(statusReadingOf({ ...STATUS_BLOCK, dispatcherState: 'stopped' })).toMatchObject({ dispatcherIsStopped: true });
    expect(statusReadingOf({ ...STATUS_BLOCK, dispatcherState: 'finished' })).toMatchObject({ dispatcherIsStopped: false });
  });
});

describe('the survey', () => {
  const survey = {
    status:               STATUS_BLOCK,
    reviewWaitingTickets: [{ id: '007', model: 'sonnet' }],
    pausedBuilds:         [],
  };

  test('a survey that returned nothing reads as nothing', () => {
    expect(surveyReadingOf(null)).toBeNull();
  });

  test('reviews waiting take their model and effort, defaulted where unstated', () => {
    expect(surveyReadingOf(survey)).toMatchObject({ reviewWaitingTickets: [{ id: '007', agentModelAndEffort: { model: 'sonnet', effort: DEFAULT_AGENT_EFFORT } }] });
  });

  // The old script crashed on these at the point it walked the list; the run keeps that crash, so the reading must say the list is unusable.
  test('a reviews list that is not an array, or holds an entry that is not an object, is unlisted', () => {
    expect(surveyReadingOf({ ...survey, reviewWaitingTickets: undefined })).toMatchObject({ reviewWaitingTickets: 'unlisted' });
    expect(surveyReadingOf({ ...survey, reviewWaitingTickets: [{ id: '007' }, null] })).toMatchObject({ reviewWaitingTickets: 'unlisted' });
  });

  test('paused builds keep only object entries whose worktree exists, with a missing note read as empty', () => {
    const reading = surveyReadingOf({
      ...survey,
      pausedBuilds: [
        null,
        {
          id: '004', note: 'Paused by Alex Example', worktreeExists: false, priority: 'high' 
        },
        { id: '005', note: 'Paused by Alex Example', priority: 'high' },
        {
          id: '006', worktreeExists: true, priority: 'urgent', effort: 'high' 
        },
      ],
    });
    expect(reading?.pausedBuilds).toEqual([{
      id: '006', note: '', priority: 'low', agentModelAndEffort: { model: DEFAULT_AGENT_MODEL, effort: 'high' } 
    }]);
  });

  // The claim-note filter is a decision of the run, which a mutant of the run must be able to break, so the edge passes every note on.
  test('a paused build with a person\'s note is still read, since telling claims apart is the run\'s decision', () => {
    const reading = surveyReadingOf({
      ...survey,
      pausedBuilds: [{
        id: '004', note: 'Paused by Alex Example', worktreeExists: true, priority: 'normal' 
      }] 
    });
    expect(reading?.pausedBuilds).toMatchObject([{ id: '004', note: 'Paused by Alex Example', priority: 'normal' }]);
  });

  test('paused builds that are not a list read as none', () => {
    expect(surveyReadingOf({ ...survey, pausedBuilds: 'none' })?.pausedBuilds).toEqual([]);
  });

  test('a survey without a readable status block says so, beside its other lists', () => {
    expect(surveyReadingOf({ ...survey, status: null })).toMatchObject({ status: 'unreadable' });
  });
});

describe('the ticket settings lookup', () => {
  test('a lookup with a list of tickets maps them like ready ticket entries', () => {
    expect(ticketSettingsLookupOf({ tickets: [{ id: '001', model: 'sonnet' }] })).toEqual([
      {
        id: '001', priority: 'low', agentModelAndEffort: { model: 'sonnet', effort: DEFAULT_AGENT_EFFORT }, held: false 
      },
    ]);
  });

  test('nothing, or tickets that are not a list, is unread', () => {
    expect(ticketSettingsLookupOf(null)).toBe('unread');
    expect(ticketSettingsLookupOf({ tickets: 'none' })).toBe('unread');
  });
});

describe('a finished agent\'s reply', () => {
  test('an agent that returned nothing reads as nothing, whatever its work', () => {
    expect(finishedReadingOf(BUILD_WORK, null)).toBeNull();
    expect(finishedReadingOf(REVIEW_WORK, null)).toBeNull();
    expect(finishedReadingOf({ kind: 'park', ticketId: '001', release: { cause: 'held' } }, null)).toBeNull();
  });

  test('a builder\'s reply keeps its outcome, detail and claim note', () => {
    const reading = finishedReadingOf(BUILD_WORK, {
      outcome: 'claim-refused', detail: '#001 is in-progress', claimNote: 'Paused by Alex Example', status: STATUS_BLOCK 
    });
    expect(reading).toMatchObject({
      kind: 'build', outcome: 'claim-refused', detail: '#001 is in-progress', claimNote: 'Paused by Alex Example', status: { limit: 2 } 
    });
  });

  test('a reviewer\'s reply maps every field the run decides on', () => {
    expect(finishedReadingOf(REVIEW_WORK, REVIEWER_REPLY)).toEqual({
      kind:           'review',
      round:          1,
      verdict:        'released',
      releaseRefusal: { statedReason: '' },
      reworkedLines:  0,
      findings:       [{ class: 'naming', file: 'a.ts', summary: 'naming in a.ts' }],
      filedTicketIds: ['010'],
      status:         statusReadingOf(STATUS_BLOCK),
    });
  });

  // The run then takes the round it asked for, which is what the old script did with a round it could not read.
  test('a round that is not an integer is unstated', () => {
    expect(finishedReadingOf(REVIEW_WORK, { ...REVIEWER_REPLY, round: 1.5 })).toMatchObject({ round: 'unstated' });
    expect(finishedReadingOf(REVIEW_WORK, { ...REVIEWER_REPLY, round: '1' })).toMatchObject({ round: 'unstated' });
  });

  // A moved main line gets another round; any other refusal parks the ticket with the reviewer's words, so only this one is a decision.
  test('a main line that moved is told apart from every other release refusal, which is kept as stated', () => {
    expect(finishedReadingOf(REVIEW_WORK, { ...REVIEWER_REPLY, verdict: 'not-released', releaseReason: 'main-moved' })).toMatchObject({ releaseRefusal: 'main-moved' });
    expect(finishedReadingOf(REVIEW_WORK, { ...REVIEWER_REPLY, verdict: 'not-released', releaseReason: 'merge-refused' }))
      .toMatchObject({ releaseRefusal: { statedReason: 'merge-refused' } });
  });

  test('a parking agent\'s reply carries only its status block', () => {
    expect(finishedReadingOf({ kind: 'park', ticketId: '001', release: { cause: 'held' } }, { status: null })).toEqual({ kind: 'park', status: 'unreadable' });
  });
});
