/**
 * The Custom… range's popover, as the static page's (`page/progress/CustomRangePopover.ts`): the typed bounds with what each resolves to,
 * the tick sizes, and applying or discarding them together. It opens on the applied range's texts with From focused; Enter or Apply
 * applies a readable draft, Esc or Cancel discards it and hands the focus back, and a click or focus outside discards it.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent
} from 'react';

import {
  customRangeDraftVerdict,
  customRangeOverride,
  EMPTY_FROM_BOUND_TEXT,
  EMPTY_TO_BOUND_TEXT,
  rangeBoundLine,
  type RangeBoundLine
} from './CustomRangeDraft.ts';
import { AUTOMATIC_TICK_CHOICE, TICK_MINUTE_CHOICES } from './constants/ProgressChart.ts';
import type { StoredViewOverride }                    from './utils/ChartPreferenceUtil.ts';

export interface CustomRangePopoverProps {
  readonly appliedOverride:   StoredViewOverride;
  readonly resolveBound:      (text: string) => number | null;
  readonly todayCalendarDate: string;
  readonly onApply:           (override: StoredViewOverride) => void;
  /** `returnFocus` is true when the viewer discarded the draft from inside it. */
  readonly onClose:           (returnFocus: boolean) => void;
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

function tickLabelOf(tickMinutes: number | null): string {
  if (tickMinutes === null) return 'Auto';
  if (tickMinutes % MINUTES_PER_DAY === 0) return `${tickMinutes / MINUTES_PER_DAY}d`;
  if (tickMinutes % MINUTES_PER_HOUR === 0) return `${tickMinutes / MINUTES_PER_HOUR}h`;
  return `${tickMinutes}m`;
}

function BoundLine({ line }: { readonly line: RangeBoundLine }) {
  return <span className="bridge-range-resolved" title={line.title} data-invalid={line.boundIsInvalid ? '' : undefined}>{line.text}</span>;
}

export function CustomRangePopover({
  appliedOverride, resolveBound, todayCalendarDate, onApply, onClose
}: CustomRangePopoverProps) {
  const [fromText, setFromText] = useState(appliedOverride.fromText ?? EMPTY_FROM_BOUND_TEXT);
  const [toText, setToText] = useState(appliedOverride.toText ?? EMPTY_TO_BOUND_TEXT);
  const [tickMinutes, setTickMinutes] = useState(appliedOverride.tickMinutes);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const fromInputRef = useRef<HTMLInputElement | null>(null);
  const verdict = customRangeDraftVerdict(fromText, toText, resolveBound);
  const fromLine = rangeBoundLine(verdict.from, fromText, todayCalendarDate);
  const toLine = rangeBoundLine(verdict.to, toText, todayCalendarDate);

  useEffect(() => {
    fromInputRef.current?.focus();
    fromInputRef.current?.select();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose(true);
    };
    const closeOnLeaving = (event: Event): void => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target) !== true) onClose(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnLeaving);
    document.addEventListener('focusin', closeOnLeaving);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnLeaving);
      document.removeEventListener('focusin', closeOnLeaving);
    };
  }, [onClose]);

  const applyDraft = (): void => {
    if (!verdict.draftIsApplicable) return;
    onApply(customRangeOverride(fromText, toText, tickMinutes));
    onClose(true);
  };

  const applyOnEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyDraft();
  };

  return (
    <div ref={popoverRef} className="bridge-range-popover" role="dialog" aria-label="Custom range">
      <label className="bridge-range-field">
        From
        <input
          ref={fromInputRef}
          value={fromText}
          aria-invalid={fromLine.boundIsInvalid}
          onChange={(event) => setFromText(event.target.value)}
          onKeyDown={applyOnEnter}
        />
        <BoundLine line={fromLine} />
      </label>
      <label className="bridge-range-field">
        To
        <input value={toText} aria-invalid={toLine.boundIsInvalid} onChange={(event) => setToText(event.target.value)} onKeyDown={applyOnEnter} />
        <BoundLine line={toLine} />
      </label>
      <div className="bridge-chips" role="group" aria-label="Ticks">
        {[null, ...TICK_MINUTE_CHOICES].map((choice) => (
          <button key={choice ?? AUTOMATIC_TICK_CHOICE} type="button" className="bridge-chip" aria-pressed={choice === tickMinutes} onClick={() => setTickMinutes(choice)}>
            {tickLabelOf(choice)}
          </button>
        ))}
      </div>
      <div className="bridge-range-actions">
        <button type="button" className="bridge-chip" onClick={() => onClose(true)}>Cancel</button>
        <button type="button" className="bridge-chip" disabled={!verdict.draftIsApplicable} onClick={applyDraft}>Apply</button>
      </div>
    </div>
  );
}
