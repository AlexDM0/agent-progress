/**
 * Which epic chips keep a ticket. The cases that matter: a ticket in two epics answers to either chip, a ticket in none only to the
 * no-epic chip, and no chip pressed keeps every ticket.
 */

import { describe, expect, test } from 'bun:test';
import type { PageTicket }        from '../../src/shared/@types/PagePayload.ts';
import { NO_EPIC_CHIP }           from '../constants/EpicChips.ts';
import { pageBoardFixture }       from '../testing/PageBoardFixture.ts';
import { EpicChipUtil }           from './EpicChipUtil.ts';

function exampleTicket(changes: Partial<PageTicket>): PageTicket {
  return {
    id:          '001',
    title:       'Example',
    type:        'change',
    status:      'pending',
    filed:       '2026-09-18T20:00:00+02:00',
    updated:     '2026-09-18T20:00:00+02:00',
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    '/example/.agent-progress/tickets/001-example.md',
    bodyHtml:    '',
    ...changes,
  };
}

const [IN_TWO_EPICS, IN_NONE] = pageBoardFixture({
  tasks:   [],
  tickets: [exampleTicket({ id: '001', epics: ['checkout', 'emails'] }), exampleTicket({ id: '002' })],
  epics:   [{
    key: 'checkout', title: 'Checkout', slot: 1, extra: []
  }, {
    key: 'emails', title: 'Emails', slot: 2, extra: []
  }],
}).tickets;

describe('EpicChipUtil', () => {
  test('answers a ticket\'s epics in order, or the no-epic chip for a ticket in none', () => {
    expect(IN_TWO_EPICS === undefined ? [] : EpicChipUtil.epicChipsOf(IN_TWO_EPICS)).toEqual(['checkout', 'emails']);
    expect(IN_NONE === undefined ? [] : EpicChipUtil.epicChipsOf(IN_NONE)).toEqual([NO_EPIC_CHIP]);
  });

  test('keeps a ticket on any one of its epics, a ticket in none on the no-epic chip, and every ticket while nothing is pressed', () => {
    if (IN_TWO_EPICS === undefined || IN_NONE === undefined) throw new Error('the fixture lost a ticket');

    expect(EpicChipUtil.pressedChipsKeep(IN_TWO_EPICS, ['emails'])).toBe(true);
    expect(EpicChipUtil.pressedChipsKeep(IN_TWO_EPICS, [NO_EPIC_CHIP])).toBe(false);
    expect(EpicChipUtil.pressedChipsKeep(IN_NONE, [NO_EPIC_CHIP])).toBe(true);
    expect(EpicChipUtil.pressedChipsKeep(IN_NONE, ['checkout'])).toBe(false);
    expect(EpicChipUtil.pressedChipsKeep(IN_NONE, [])).toBe(true);
  });
});
