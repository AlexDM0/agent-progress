/**
 * The verbs are literals here and, for the refusals that name a command to run, in `src/adapters/utils/StatusWordingUtil.ts`. What matters
 * is that the two never drift: every verb a refusal suggests for a ticket status is a subcommand this table answers.
 */
import { expect, test } from 'bun:test';

import { StatusWordingUtil }       from '../../src/adapters/utils/StatusWordingUtil.ts';
import { TICKET_STATUSES }         from '../../src/lib/tracker-model/constants/Statuses.ts';
import { TICKET_MOVE_SUBCOMMANDS } from './TicketMoveSubcommands.ts';

test('every verb a refusal names for a ticket status is a ticket subcommand', () => {
  expect(TICKET_STATUSES.length, 'the statuses were enumerated').toBeGreaterThan(5);
  for (const status of TICKET_STATUSES) expect(Object.hasOwn(TICKET_MOVE_SUBCOMMANDS, StatusWordingUtil.verbFor(status)), status).toBe(true);
});
