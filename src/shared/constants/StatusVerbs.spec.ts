/**
 * The verb table names the subcommand a refusal tells the reader to run. What callers rely on: every status has a verb, so no refusal
 * falls back to a vaguer command, and no two statuses share one, so a verb read back as a subcommand reaches exactly one status.
 */
import { expect, test } from 'bun:test';

import { TASK_STATUSES, TICKET_STATUSES } from '../../lib/tracker-model/constants/Statuses';
import { VERB_FOR_STATUS }                from './StatusVerbs';

test('every row status and every ticket status has a verb', () => {
  expect(TASK_STATUSES.length, 'the statuses were enumerated').toBeGreaterThan(5);
  for (const status of [...TASK_STATUSES, ...TICKET_STATUSES]) expect(VERB_FOR_STATUS[status], status).toMatch(/^[a-z]+$/);
});

test('no two statuses share a verb, so a verb names exactly one status', () => {
  const verbs = TASK_STATUSES.map((status) => VERB_FOR_STATUS[status]);
  expect(new Set(verbs).size).toBe(TASK_STATUSES.length);
});
