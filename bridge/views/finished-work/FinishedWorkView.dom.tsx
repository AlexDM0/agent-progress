/**
 * The finished-work choice and list in a happy-dom document. What matters: the choice is read from and written to the static page's key,
 * `<STORAGE_PREFIX>:<trackerId>:visibility`, the default removing it; the list shows what the choice lets through, latest closed first.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { PRODUCT_NAMES }                                             from '../../../src/shared/constants/ProductNames.ts';
import type { PreferenceStore }                                      from '../../preferences/PreferenceStore.ts';
import { boardPreferenceStoreOf }                                    from '../../preferences/PreferenceStore.ts';
import { FIXTURE_NOW, FIXTURE_TICKETS }                              from '../../testing/BoardStateFixture.ts';
import { FinishedWorkMenu, FinishedWorkView, useFinishedWorkChoice } from './FinishedWorkView.tsx';

const STORED_KEY = `${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker:visibility`;

function storeOver(storage: Map<string, string>): PreferenceStore {
  return boardPreferenceStoreOf('example-tracker', () => ({
    getItem:    (key) => storage.get(key) ?? null,
    setItem:    (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  }));
}

function FinishedWork({ store }: { readonly store: PreferenceStore }) {
  const [choice, choose] = useFinishedWorkChoice(store);
  return (
    <>
      <FinishedWorkMenu choice={choice} onChoice={choose} hiddenCount={0} />
      <FinishedWorkView tickets={FIXTURE_TICKETS} choice={choice} nowEpochMilliseconds={FIXTURE_NOW.getTime()} />
    </>
  );
}

function shownTicketLinks(): (string | null)[] {
  return [...document.querySelectorAll('.bridge-finished-list a')].map((link) => link.textContent);
}

afterEach(() => {
  cleanup();
});

describe('the stored choice', () => {
  test('a stored choice under the page\'s key is read, and the default removes the key again', () => {
    const storage = new Map([[STORED_KEY, 'all']]);
    render(<FinishedWork store={storeOver(storage)} />);
    expect(shownTicketLinks()).toEqual(['#2', '#5', '#1']);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'last day' }));
    });
    expect(storage.has(STORED_KEY)).toBe(false);
    expect(shownTicketLinks()).toEqual(['#2', '#5']);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'last hour' }));
    });
    expect(storage.get(STORED_KEY)).toBe('1h');
    expect(screen.getByText('No ticket finished in the last hour.')).toBeDefined();
  });

  test('the retired recent reads as the default', () => {
    render(<FinishedWork store={storeOver(new Map([[STORED_KEY, 'recent']]))} />);
    expect(screen.getByRole('button', { name: 'last day' }).getAttribute('aria-pressed')).toBe('true');
  });
});
