/**
 * The epic marks, as the static page's `page/epics/EpicMarkup.spec.ts` held them, now on the view model. What matters: open epics show
 * before settled ones, the done text, roll-up segments in settled-first order and the facts read as the page's, ticket lines are newest
 * first with their display state, the description stays the rendered string for the sandbox, and a finished epic outside the window hides
 * behind the empty line naming it.
 */
import { describe, expect, test } from 'bun:test';

import {
  boardStateFixture,
  FINISHED_EPIC,
  FIXTURE_NOW,
  OPEN_EPIC,
  PLANTED_DESCRIPTION_HTML
} from '../../testing/BoardStateFixture.ts';
import { EpicsModel } from './EpicsModel.ts';

const PAGE = boardStateFixture().page ?? (() => {
  throw new Error('the fixture carries a page');
})();
const NOW = FIXTURE_NOW.getTime();

describe('the epic marks', () => {
  const { cards } = EpicsModel.epicsModelOf(PAGE, 'all', NOW);
  const [openCard, settledCard] = cards;

  test('open epics come first', () => {
    expect(cards.map((card) => card.key)).toEqual(['checkout', 'archive']);
  });

  test('the done text, the roll-up segments and the facts', () => {
    expect(openCard?.doneText).toBe('1 of 3 done');
    expect(settledCard?.doneText).toBe('all settled');
    expect(openCard?.segments).toEqual([{ state: 'delivered', count: 1 }, { state: 'in-progress', count: 1 }, { state: 'pending', count: 1 }]);
    expect(openCard?.facts).toEqual([
      { label: 'open', value: '2' },
      { label: 'done', value: '1' },
      { label: 'tokens', value: '12k' },
      { label: 'span', value: '2026-10-28T08:00:00 → now' },
    ]);
  });

  test('ticket lines newest first, a live one marked, and the description kept as rendered for the sandbox', () => {
    expect(openCard?.tickets.map((ticket) => [ticket.ticketId, ticket.displayState, ticket.isLive])).toEqual([
      ['4', 'pending', false], ['3', 'in-progress', true], ['2', 'delivered', false],
    ]);
    expect([openCard?.isLive, settledCard?.isLive]).toEqual([true, false]);
    expect(openCard?.descriptionHtml).toBe(PLANTED_DESCRIPTION_HTML);
  });

  test('an epic with no tickets reads no tickets', () => {
    expect(EpicsModel.doneTextOf({ ...OPEN_EPIC, ticketIds: [], ticketCountByStatus: {} })).toBe('no tickets');
  });
});

describe('the finished-work choice', () => {
  test('the last day hides the epic that ended last week', () => {
    expect(EpicsModel.epicsModelOf(PAGE, '1d', NOW).cards.map((card) => card.key)).toEqual(['checkout']);
  });

  test('with every epic hidden, one line names the window', () => {
    const page = { ...PAGE, payload: { ...PAGE.payload, boardFacts: { ...PAGE.payload.boardFacts, epics: [FINISHED_EPIC] } } };
    expect(EpicsModel.epicsModelOf(page, '1h', NOW)).toEqual({ cards: [], emptyText: 'No epic finished in the last hour.' });
  });
});
