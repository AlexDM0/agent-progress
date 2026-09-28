/** The Custom… preset's popover: the typed bounds with what each resolves to, the tick sizes, and applying or discarding them together. */

import type { StoredViewOverride }                    from '../@types/ViewerChoices.ts';
import { RANGE_FROM_ELEMENT_ID, RANGE_TO_ELEMENT_ID } from '../constants/TemplateIds.ts';
import { DomUtil }                                    from '../utils/DomUtil.ts';
import type { RangeBoundLine }                        from './CustomRangeDraft.ts';
import {
  customRangeDraftVerdict,
  customRangeOverride,
  EMPTY_FROM_BOUND_TEXT,
  EMPTY_TO_BOUND_TEXT,
  rangeBoundLine,
} from './CustomRangeDraft.ts';
import { AUTOMATIC_TICK_CHOICE } from './constants/ProgressChart.ts';

export interface CustomRangePopoverSources {
  resolveBound:      (text: string) => number | null;
  todayCalendarDate: () => string;
  readOverride:      () => StoredViewOverride;
  applyOverride:     (next: StoredViewOverride) => void;
}

export interface CustomRangePopover {
  wire(): void;
  isOpen(): boolean;
  /** Opens on the given bound texts, or on the applied range's when none are given. */
  open(fromText?: string, toText?: string): void;
}

const CUSTOM_BUTTON_ELEMENT_ID      = 'ap-range-custom';
const POPOVER_ELEMENT_ID            = 'ap-range-popover';
const FROM_RESOLVED_ELEMENT_ID      = 'ap-range-from-resolved';
const TO_RESOLVED_ELEMENT_ID        = 'ap-range-to-resolved';
const TICKS_ELEMENT_ID              = 'ap-range-ticks';
const APPLY_BUTTON_ELEMENT_ID       = 'ap-range-apply';
const CANCEL_BUTTON_ELEMENT_ID      = 'ap-range-cancel';
const POPOVER_GAP_PIXELS            = 6;
const POPOVER_EDGE_CLEARANCE_PIXELS = 8;

function tickChoiceOf(tickMinutes: number | null): string {
  return tickMinutes === null ? AUTOMATIC_TICK_CHOICE : String(tickMinutes);
}

function tickMinutesOf(choice: string): number | null {
  const minutes = choice === AUTOMATIC_TICK_CHOICE ? Number.NaN : Number(choice);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function inputOf(elementId: string): HTMLInputElement | null {
  const element = document.getElementById(elementId);
  return element instanceof HTMLInputElement ? element : null;
}

function showBoundLine(input: HTMLInputElement | null, lineElementId: string, line: RangeBoundLine): void {
  input?.setAttribute('aria-invalid', String(line.boundIsInvalid));
  const lineElement = document.getElementById(lineElementId);
  if (lineElement === null) {
    return;
  }
  lineElement.textContent = line.text;
  lineElement.toggleAttribute('data-invalid', line.boundIsInvalid);
  if (line.title === null) {
    lineElement.removeAttribute('title');
  } else {
    lineElement.setAttribute('title', line.title);
  }
}

export function createCustomRangePopover(sources: CustomRangePopoverSources): CustomRangePopover {
  const {
    resolveBound,
    todayCalendarDate,
    readOverride,
    applyOverride,
  } = sources;
  let draftTickMinutes: number | null = null;

  const popover      = (): HTMLElement | null => document.getElementById(POPOVER_ELEMENT_ID);
  const customButton = (): HTMLElement | null => document.getElementById(CUSTOM_BUTTON_ELEMENT_ID);
  const isOpen       = (): boolean => popover()?.hidden === false;

  const validateDraft = (): boolean => {
    const fromInput = inputOf(RANGE_FROM_ELEMENT_ID);
    const toInput   = inputOf(RANGE_TO_ELEMENT_ID);
    const fromText  = fromInput?.value ?? '';
    const toText    = toInput?.value ?? '';
    const verdict   = customRangeDraftVerdict(fromText, toText, resolveBound);
    const today     = todayCalendarDate();
    showBoundLine(fromInput, FROM_RESOLVED_ELEMENT_ID, rangeBoundLine(verdict.from, fromText, today));
    showBoundLine(toInput, TO_RESOLVED_ELEMENT_ID, rangeBoundLine(verdict.to, toText, today));
    const applyButton = document.getElementById(APPLY_BUTTON_ELEMENT_ID);
    if (applyButton instanceof HTMLButtonElement) {
      applyButton.disabled = !verdict.draftIsApplicable;
    }
    return verdict.draftIsApplicable;
  };

  const placeUnderCustomButton = (popoverElement: HTMLElement, button: HTMLElement): void => {
    const rangeBar = popoverElement.offsetParent;
    if (!(rangeBar instanceof HTMLElement)) {
      return;
    }
    const rangeBarBox  = rangeBar.getBoundingClientRect();
    const buttonBox    = button.getBoundingClientRect();
    const furthestLeft = rangeBarBox.width - popoverElement.offsetWidth - POPOVER_EDGE_CLEARANCE_PIXELS;
    popoverElement.style.top  = `${buttonBox.bottom - rangeBarBox.top + POPOVER_GAP_PIXELS}px`;
    popoverElement.style.left = `${Math.max(POPOVER_EDGE_CLEARANCE_PIXELS, Math.min(buttonBox.left - rangeBarBox.left, furthestLeft))}px`;
  };

  const open = (fromText?: string, toText?: string): void => {
    const popoverElement = popover();
    const button         = customButton();
    if (popoverElement === null || button === null) {
      return;
    }
    const override  = readOverride();
    const fromInput = inputOf(RANGE_FROM_ELEMENT_ID);
    const toInput   = inputOf(RANGE_TO_ELEMENT_ID);
    if (fromInput !== null) {
      fromInput.value = fromText ?? override.fromText ?? EMPTY_FROM_BOUND_TEXT;
    }
    if (toInput !== null) {
      toInput.value = toText ?? override.toText ?? EMPTY_TO_BOUND_TEXT;
    }
    draftTickMinutes = override.tickMinutes;
    DomUtil.reflectSegment(TICKS_ELEMENT_ID, 'tick', tickChoiceOf(draftTickMinutes));
    popoverElement.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    placeUnderCustomButton(popoverElement, button);
    validateDraft();
    fromInput?.focus();
    fromInput?.select();
  };

  const close = (returnFocus: boolean): void => {
    const popoverElement = popover();
    if (popoverElement === null || popoverElement.hidden) {
      return;
    }
    popoverElement.hidden = true;
    const button = customButton();
    button?.setAttribute('aria-expanded', 'false');
    if (returnFocus) {
      button?.focus();
    }
  };

  const applyDraft = (): void => {
    if (!validateDraft()) {
      return;
    }
    const next = customRangeOverride(inputOf(RANGE_FROM_ELEMENT_ID)?.value ?? '', inputOf(RANGE_TO_ELEMENT_ID)?.value ?? '', draftTickMinutes);
    close(true);
    applyOverride(next);
  };

  const wire = (): void => {
    const popoverElement = popover();
    const button         = customButton();
    if (popoverElement === null || button === null) {
      return;
    }
    button.addEventListener('click', () => {
      if (isOpen()) {
        close(true);
      } else {
        open();
      }
    });
    for (const elementId of [RANGE_FROM_ELEMENT_ID, RANGE_TO_ELEMENT_ID]) {
      document.getElementById(elementId)?.addEventListener('input', validateDraft);
    }
    popoverElement.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        applyDraft();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen()) {
        event.preventDefault();
        close(true);
      }
    });
    document.getElementById(APPLY_BUTTON_ELEMENT_ID)?.addEventListener('click', applyDraft);
    document.getElementById(CANCEL_BUTTON_ELEMENT_ID)?.addEventListener('click', () => close(true));
    document.getElementById(TICKS_ELEMENT_ID)?.addEventListener('click', (event) => {
      const tickButton = event.target instanceof Element ? event.target.closest('[data-tick]') : null;
      if (!(tickButton instanceof HTMLElement)) {
        return;
      }
      draftTickMinutes = tickMinutesOf(tickButton.dataset['tick'] ?? AUTOMATIC_TICK_CHOICE);
      DomUtil.reflectSegment(TICKS_ELEMENT_ID, 'tick', tickChoiceOf(draftTickMinutes));
    });
    const leavesPopover = (target: EventTarget | null): boolean => target instanceof Node && !popoverElement.contains(target) && !button.contains(target);
    document.addEventListener('pointerdown', (event) => {
      if (isOpen() && leavesPopover(event.target)) {
        close(false);
      }
    });
    document.addEventListener('focusin', (event) => {
      if (isOpen() && leavesPopover(event.target)) {
        close(false);
      }
    });
  };

  return {
    wire,
    isOpen,
    open,
  };
}
