/**
 * The ticket command's argument readers, pinned against their contract: an absent option reads as undefined, a known word passes through,
 * and an unknown one is refused with its exact words naming the vocabulary, since a script matches them. The dependency list splits on
 * spaces and commas and keeps each id once, padded, because every other command compares padded ids. The texts are frozen from
 * `cli/ticket/TicketCommand.ts` at 6284cab; retake them with `git show 6284cab:cli/ticket/TicketCommand.ts`.
 */
import { describe, expect, test } from 'bun:test';

import { refusalIsOperationRefusal, type OperationRefusal } from '../../../src/shared/OperationRefusal';
import { TicketArgumentUtil }                               from './TicketArgumentUtil';

const {
  requirePriority,
  priorityFrom,
  ticketTypeFrom,
  agentModelFrom,
  agentEffortFrom,
  dependencyListFrom,
  refuseAnUnknownTicketStatus,
} = TicketArgumentUtil;

function refusalFrom(action: () => unknown): OperationRefusal {
  try {
    action();
  } catch (error) {
    if (refusalIsOperationRefusal(error)) return error;
    throw error;
  }
  throw new Error('the call was expected to refuse and it returned instead');
}

describe('TicketArgumentUtil vocabulary readers', () => {
  test('an absent option reads as undefined and a known word passes through', () => {
    expect(priorityFrom(undefined)).toBeUndefined();
    expect(ticketTypeFrom(undefined)).toBeUndefined();
    expect(agentModelFrom(undefined)).toBeUndefined();
    expect(agentEffortFrom(undefined)).toBeUndefined();

    expect(requirePriority('high')).toBe('high');
    expect(priorityFrom('low')).toBe('low');
    expect(ticketTypeFrom('bug')).toBe('bug');
    expect(agentModelFrom('sonnet')).toBe('sonnet');
    expect(agentEffortFrom('xhigh')).toBe('xhigh');
  });

  test.each([
    ['priority', () => requirePriority('urgent'), '"urgent" is not a ticket priority. The priorities are low, normal, high.'],
    ['priority option', () => priorityFrom('urgent'), '"urgent" is not a ticket priority. The priorities are low, normal, high.'],
    ['type', () => ticketTypeFrom('chore'), '"chore" is not a ticket type. The types are bug, change, feature.'],
    ['model', () => agentModelFrom('gpt'), '"gpt" is not an agent model. The models are haiku, sonnet, opus, fable.'],
    ['effort', () => agentEffortFrom('huge'), '"huge" is not an agent effort. The efforts are low, medium, high, xhigh, max.'],
  ])('an unknown %s is refused naming the vocabulary', (_description, action, expectedMessage) => {
    const refusal = refusalFrom(action);

    expect(refusal.status).toBe('refused');
    expect(refusal.message).toBe(expectedMessage);
  });
});

describe('TicketArgumentUtil.dependencyListFrom', () => {
  test('splits on spaces and commas, pads every id and keeps each one once, in the order first written', () => {
    expect(dependencyListFrom(['3, 1', '#3  007,,1'])).toEqual(['003', '001', '007']);
  });

  test('an empty text is an empty list, which clears the dependencies', () => {
    expect(dependencyListFrom([''])).toEqual([]);
    expect(dependencyListFrom([])).toEqual([]);
  });

  test('a part that is not a ticket id is refused with the forms an id takes', () => {
    const refusal = refusalFrom(() => dependencyListFrom(['2 importer']));

    expect(refusal.status).toBe('refused');
    expect(refusal.message).toBe('"importer" is not a ticket id. Write it as `3`, `003` or `#3`.');
  });
});

describe('TicketArgumentUtil.refuseAnUnknownTicketStatus', () => {
  test('a retired status word is refused naming the word that replaced it, with the caller\'s retry advice', () => {
    const refusal = refusalFrom(() => refuseAnUnknownTicketStatus('done', (renamedStatus) => `pass --status ${renamedStatus}`));

    expect(refusal.status).toBe('refused');
    expect(refusal.message).toBe('"done" is the old name of the ticket status reviewed; pass --status reviewed.');
  });

  test('any other word is refused naming every status, and an inherited property name is not mistaken for a retired word', () => {
    for (const writtenStatus of ['finished-ish', 'constructor']) {
      const refusal = refusalFrom(() => refuseAnUnknownTicketStatus(writtenStatus, () => 'unused advice'));

      expect(refusal.status).toBe('refused');
      expect(refusal.message).toBe(
        `"${writtenStatus}" is not a ticket status. The statuses are pending, in-progress, in-review, reviewed, delivered, abandoned.`,
      );
    }
  });
});
