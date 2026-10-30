/**
 * The Epics view in a happy-dom document. What matters: an epic's description reaches the DOM only as the `srcdoc` of a frame whose
 * `sandbox` attribute is exactly the design's, so a planted image handler, script or `javascript:` link never becomes an element of the
 * Bridge's own document and runs nothing; and the cards carry the epic marks.
 */
import { cleanup, render, screen } from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { boardStateFixture, FIXTURE_NOW, PLANTED_DESCRIPTION_HTML } from '../../testing/BoardStateFixture.ts';
import { EpicsModel }                                               from './EpicsModel.ts';
import { EpicsView }                                                from './EpicsView.tsx';

function renderedEpics(): void {
  const { page } = boardStateFixture();
  if (page === undefined) throw new Error('the fixture carries a page');
  render(<EpicsView model={EpicsModel.epicsModelOf(page, 'all', FIXTURE_NOW.getTime())} />);
}

afterEach(() => {
  cleanup();
});

describe('the description sandbox', () => {
  test('the description is only the srcdoc of a frame sandboxed exactly as the design says', () => {
    renderedEpics();
    const frames = [...document.querySelectorAll('iframe')];
    expect(frames).toHaveLength(1);
    expect(frames[0]?.getAttribute('sandbox')).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    expect(frames[0]?.getAttribute('srcdoc')).toContain(PLANTED_DESCRIPTION_HTML);
  });

  test('the planted image, script and link are no elements of the Bridge\'s document and ran nothing', () => {
    renderedEpics();
    expect(document.querySelectorAll('img, script, a[href^="javascript:"]')).toHaveLength(0);
    expect((window as unknown as { plantedRan?: boolean }).plantedRan).toBeUndefined();
  });
});

describe('the epic marks', () => {
  test('each card carries its title, slot, done text and newest-first tickets', () => {
    renderedEpics();
    const cards = screen.getAllByRole('article');
    expect(cards.map((card) => [card.getAttribute('aria-label'), card.dataset['epicSlot']])).toEqual([['Example checkout', '1'], ['Example archive', '2']]);
    expect(cards[0]?.textContent).toContain('1 of 3 done');
    expect([...(cards[0]?.querySelectorAll('li a') ?? [])].map((link) => link.textContent)).toEqual(['#4', '#3', '#2']);
    expect(cards[0]?.hasAttribute('data-live')).toBe(true);
  });
});
