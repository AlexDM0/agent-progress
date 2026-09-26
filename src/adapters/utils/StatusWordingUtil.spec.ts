/**
 * The verb names the subcommand a refusal tells the reader to run, and the moved phrase ends the line a move prints and the sentence a
 * ticket move logs. What callers rely on: every status has a verb, so no refusal falls back to a vaguer command; no two statuses share
 * one, so a verb read back as a subcommand reaches exactly one status; and both wordings stay byte for byte what they were. The frozen
 * tables were retaken from `git show 9c7a8e2:src/shared/constants/StatusVerbs.ts`, the `spoken` column of
 * `git show 9c7a8e2:cli/task/TaskCommand.ts` and `MOVE_PHRASE_FOR_KIND` in `git show 9c7a8e2:src/adapters/utils/LogUtil.ts`, where the
 * two phrase tables agree on the statuses they share.
 * The word tables give every status, ticket type, priority and dispatcher state the word the command line printed before they existed,
 * the value itself, retaken from `git show 75548d8:cli/tickets/TicketReading.ts` and `git show 75548d8:cli/tracking/status/StatusCommand.ts`.
 */
import { expect, test } from 'bun:test';

import type { DispatcherState }            from '../../lib/tracker-model/@types/ProgressFile';
import type { TaskStatus }                 from '../../lib/tracker-model/@types/Task';
import type { TicketPriority, TicketType } from '../../lib/tracker-model/@types/Ticket';
import { DISPATCHER_STATES }               from '../../lib/tracker-model/constants/DispatcherStates';
import { TASK_STATUSES, TICKET_STATUSES }  from '../../lib/tracker-model/constants/Statuses';
import { TICKET_PRIORITIES, TICKET_TYPES } from '../../lib/tracker-model/constants/TicketFields';
import type { MovedToStatus }              from './StatusWordingUtil';
import { StatusWordingUtil }               from './StatusWordingUtil';

const EXPECTED_WORD_FOR_STATUS: Readonly<Record<TaskStatus, string>> = Object.freeze({
  'pending':     'pending',
  'in-progress': 'in-progress',
  'paused':      'paused',
  'in-review':   'in-review',
  're-review':   're-review',
  'reviewed':    'reviewed',
  'delivered':   'delivered',
  'abandoned':   'abandoned',
});

const EXPECTED_WORD_FOR_TICKET_TYPE: Readonly<Record<TicketType, string>> = Object.freeze({
  bug:     'bug',
  change:  'change',
  feature: 'feature',
});

const EXPECTED_WORD_FOR_PRIORITY: Readonly<Record<TicketPriority, string>> = Object.freeze({
  low:    'low',
  normal: 'normal',
  high:   'high',
});

const EXPECTED_WORD_FOR_DISPATCHER_STATE: Readonly<Record<DispatcherState, string>> = Object.freeze({
  running:  'running',
  finished: 'finished',
  stopped:  'stopped',
});

const EXPECTED_VERB_FOR_STATUS: Readonly<Record<TaskStatus, string>> = Object.freeze({
  'pending':     'reopen',
  'in-progress': 'start',
  'paused':      'pause',
  'in-review':   'finish',
  're-review':   'rereview',
  'reviewed':    'approve',
  'delivered':   'deliver',
  'abandoned':   'abandon',
});

const EXPECTED_MOVED_PHRASE_FOR_STATUS: Readonly<Record<MovedToStatus, string>> = Object.freeze({
  'pending':     'reopened',
  'in-progress': 'started',
  'paused':      'paused',
  'in-review':   'in review',
  're-review':   'under review again',
  'reviewed':    'reviewed',
  'delivered':   'delivered',
});

test('every row status and every ticket status has a lowercase verb', () => {
  expect(TASK_STATUSES.length, 'the statuses were enumerated').toBeGreaterThan(5);
  for (const status of [...TASK_STATUSES, ...TICKET_STATUSES]) expect(StatusWordingUtil.verbFor(status), status).toMatch(/^[a-z]+$/);
});

test('no two statuses share a verb, so a verb names exactly one status', () => {
  const verbs = TASK_STATUSES.map((status) => StatusWordingUtil.verbFor(status));
  expect(new Set(verbs).size).toBe(TASK_STATUSES.length);
});

test('each status is worded as the verb it has always been', () => {
  expect(Object.keys(EXPECTED_VERB_FOR_STATUS).sort()).toEqual([...TASK_STATUSES].sort());
  for (const status of TASK_STATUSES) expect(StatusWordingUtil.verbFor(status), status).toBe(EXPECTED_VERB_FOR_STATUS[status]);
});

test('each status a move reaches is worded as the phrase it has always been', () => {
  const movedToStatuses = TASK_STATUSES.filter((status): status is MovedToStatus => status !== 'abandoned');
  expect(Object.keys(EXPECTED_MOVED_PHRASE_FOR_STATUS).sort()).toEqual([...movedToStatuses].sort());
  for (const status of movedToStatuses) expect(StatusWordingUtil.movedPhraseFor(status), status).toBe(EXPECTED_MOVED_PHRASE_FOR_STATUS[status]);
});

test('every row status and every ticket status is worded as the value the command line has always printed', () => {
  expect(Object.keys(EXPECTED_WORD_FOR_STATUS).sort()).toEqual([...TASK_STATUSES].sort());
  for (const status of [...TASK_STATUSES, ...TICKET_STATUSES]) expect(StatusWordingUtil.statusWordFor(status), status).toBe(EXPECTED_WORD_FOR_STATUS[status]);
});

test('every ticket type is worded as the value the command line has always printed', () => {
  expect(Object.keys(EXPECTED_WORD_FOR_TICKET_TYPE).sort()).toEqual([...TICKET_TYPES].sort());
  for (const type of TICKET_TYPES) expect(StatusWordingUtil.ticketTypeWordFor(type), type).toBe(EXPECTED_WORD_FOR_TICKET_TYPE[type]);
});

test('every ticket priority is worded as the value the command line has always printed', () => {
  expect(Object.keys(EXPECTED_WORD_FOR_PRIORITY).sort()).toEqual([...TICKET_PRIORITIES].sort());
  for (const priority of TICKET_PRIORITIES) expect(StatusWordingUtil.priorityWordFor(priority), priority).toBe(EXPECTED_WORD_FOR_PRIORITY[priority]);
});

test('every dispatcher state is worded as the value the command line has always printed', () => {
  expect(Object.keys(EXPECTED_WORD_FOR_DISPATCHER_STATE).sort()).toEqual([...DISPATCHER_STATES].sort());
  for (const state of DISPATCHER_STATES) expect(StatusWordingUtil.dispatcherStateWordFor(state), state).toBe(EXPECTED_WORD_FOR_DISPATCHER_STATE[state]);
});
