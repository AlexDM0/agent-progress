/**
 * The guards that stand between text from outside (argv, a hand-edited file) and the model's unions. What callers rely on:
 * each accepts exactly its own tuple, and nothing that merely looks like a member, including a name every object inherits.
 */
import { expect, test } from 'bun:test';

import { AGENT_EFFORTS, AGENT_MODELS }     from '../constants/AgentSettings.ts';
import { TASK_STATUSES, TICKET_STATUSES }  from '../constants/Statuses.ts';
import { TICKET_PRIORITIES, TICKET_TYPES } from '../constants/TicketFields.ts';
import { VocabularyUtil }                  from './VocabularyUtil.ts';

const {
  agentEffortIsKnown,
  agentModelIsKnown,
  taskStatusIsKnown,
  ticketPriorityIsKnown,
  ticketStatusIsKnown,
  ticketTypeIsKnown,
} = VocabularyUtil;

test('each guard accepts every member of its own tuple', () => {
  expect(TASK_STATUSES.filter((status) => !taskStatusIsKnown(status))).toEqual([]);
  expect(TICKET_STATUSES.filter((status) => !ticketStatusIsKnown(status))).toEqual([]);
  expect(TICKET_TYPES.filter((type) => !ticketTypeIsKnown(type))).toEqual([]);
  expect(TICKET_PRIORITIES.filter((priority) => !ticketPriorityIsKnown(priority))).toEqual([]);
});

test('a guard refuses a plausible near-miss rather than rounding it to the nearest member', () => {
  for (const nearMiss of ['', 'Pending', 'in progress', 'complete', 'todo', 'delivered ', 'pendin']) {
    expect(taskStatusIsKnown(nearMiss), `task status "${nearMiss}"`).toBe(false);
    expect(ticketStatusIsKnown(nearMiss), `ticket status "${nearMiss}"`).toBe(false);
    expect(ticketTypeIsKnown(nearMiss), `ticket type "${nearMiss}"`).toBe(false);
  }
});

test('a guard refuses a name inherited from Object.prototype', () => {
  for (const inheritedName of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    expect(taskStatusIsKnown(inheritedName), inheritedName).toBe(false);
    expect(ticketStatusIsKnown(inheritedName), inheritedName).toBe(false);
    expect(ticketTypeIsKnown(inheritedName), inheritedName).toBe(false);
  }
});

test('the priority guard refuses a near miss and an inherited name', () => {
  for (const nearMiss of ['', 'Low', 'medium', 'urgent', 'constructor', 'normal ']) {
    expect(ticketPriorityIsKnown(nearMiss), `priority "${nearMiss}"`).toBe(false);
  }
});

// argv reaches these guards, so an inherited property name and a near miss must both be refused.
test('the agent guards accept every tuple member and nothing that merely looks like one', () => {
  for (const model of AGENT_MODELS) expect(agentModelIsKnown(model)).toBe(true);
  for (const effort of AGENT_EFFORTS) expect(agentEffortIsKnown(effort)).toBe(true);
  for (const impostor of ['Opus', 'claude-opus-5-5', 'inherit', 'constructor', '']) expect(agentModelIsKnown(impostor)).toBe(false);
  for (const impostor of ['Medium', 'extra-high', 'constructor', '']) expect(agentEffortIsKnown(impostor)).toBe(false);
});
