/**
 * The custom range popover in a happy-dom document. What matters: it opens on the applied range's bounds with From focused and each bound's
 * resolved stamp under it; an unreadable bound or a To not after From says so and holds Apply back; Apply and Enter apply the draft with
 * its tick size and close it handing the focus back; Esc and Cancel discard it handing the focus back; and a click outside discards it.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  mock,
  test
} from 'bun:test';

import { CustomRangePopover }                           from './CustomRangePopover.tsx';
import { EMPTY_VIEW_OVERRIDE, type StoredViewOverride } from './utils/ChartPreferenceUtil.ts';

const NOW_EPOCH_MILLISECONDS = new Date(2026, 8, 18, 15, 40).getTime();
const START_EPOCH_MILLISECONDS = new Date(2026, 8, 18, 12, 0).getTime();
const HOUR_MILLISECONDS = 60 * 60 * 1000;

/** `start`, `now` and `-<n>h` only, enough to drive the popover. */
function resolveExampleBound(text: string): number | null {
  if (text === 'start') return START_EPOCH_MILLISECONDS;
  if (text === 'now') return NOW_EPOCH_MILLISECONDS;
  const hours = /^-(\d+)h$/.exec(text)?.[1];
  return hours === undefined ? null : NOW_EPOCH_MILLISECONDS - Number(hours) * HOUR_MILLISECONDS;
}

function renderPopover(appliedOverride: StoredViewOverride = EMPTY_VIEW_OVERRIDE) {
  const onApply = mock((override: StoredViewOverride) => override);
  const onClose = mock((returnFocus: boolean) => returnFocus);
  render(
    <>
      <CustomRangePopover appliedOverride={appliedOverride} resolveBound={resolveExampleBound} todayCalendarDate="2026-09-18" onApply={onApply} onClose={onClose} />
      <button type="button">Outside</button>
    </>,
  );
  return {
    onApply, onClose, fromInput: screen.getByRole('textbox', { name: /From/ }), toInput: screen.getByRole('textbox', { name: /To/ })
  };
}

afterEach(cleanup);

describe('the custom range popover', () => {
  test('opens on the applied bounds with From focused and each bound\'s stamp under it', () => {
    const { fromInput, toInput } = renderPopover({
      presetKey: null, fromText: '-2h', toText: 'now', tickMinutes: 60
    });

    expect((fromInput as HTMLInputElement).value).toBe('-2h');
    expect((toInput as HTMLInputElement).value).toBe('now');
    expect(document.activeElement).toBe(fromInput);
    expect(screen.getByText('→ 13:40')).not.toBeNull();
    expect(screen.getByText('→ 15:40')).not.toBeNull();
    expect(screen.getByRole('button', { name: '1h' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('says which bound it cannot read and holds Apply back', () => {
    const { fromInput, onApply } = renderPopover();
    fireEvent.change(fromInput, { target: { value: '-2x' } });

    expect(screen.getByText('Can\'t read \'-2x\'')).not.toBeNull();
    expect(fromInput.getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(fromInput, { key: 'Enter' });
    expect(onApply).not.toHaveBeenCalled();
  });

  test('says a To not after From and holds Apply back', () => {
    const { fromInput, toInput } = renderPopover();
    fireEvent.change(fromInput, { target: { value: 'now' } });
    fireEvent.change(toInput, { target: { value: '-1h' } });

    expect(screen.getByText('→ 14:40 is not after From')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('applies the draft with its tick size on Apply, closing and handing the focus back', () => {
    const { fromInput, onApply, onClose } = renderPopover();
    fireEvent.change(fromInput, { target: { value: ' -3h ' } });
    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply.mock.calls).toEqual([[{
      presetKey: null, fromText: '-3h', toText: 'now', tickMinutes: 15
    }]]);
    expect(onClose.mock.calls).toEqual([[true]]);
  });

  test('applies on Enter in a field', () => {
    const { toInput, onApply } = renderPopover();
    fireEvent.keyDown(toInput, { key: 'Enter' });

    expect(onApply.mock.calls).toEqual([[{
      presetKey: null, fromText: 'start', toText: 'now', tickMinutes: null
    }]]);
  });

  test('discards the draft on Esc and Cancel, handing the focus back, and on a click outside, leaving it', () => {
    const { onApply, onClose } = renderPopover();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));

    expect(onClose.mock.calls).toEqual([[true], [true], [false]]);
    expect(onApply).not.toHaveBeenCalled();
  });
});
