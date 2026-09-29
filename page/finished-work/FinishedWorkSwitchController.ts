/**
 * The finished-work switch in the tab row, shared by Kanban, Progress and Tickets: its pills with their counts and reach marks, the
 * custom popover with its pill row and day field, the hidden-work note and the spoken status. The rules are `FinishedWorkUtil`'s.
 */

import type { FinishedWorkChoice }     from '../@types/ViewerChoices.ts';
import { HIDDEN_WORK_NOTE_ELEMENT_ID } from '../constants/TemplateIds.ts';
import { FinishedWorkUtil }            from '../utils/FinishedWorkUtil.ts';
import { CUSTOM_FINISHED_WORK_SPANS }  from '../utils/FinishedWorkUtil.ts';
import type { DurationUnits }          from '../utils/TimeUtil.ts';
import { TimeUtil }                    from '../utils/TimeUtil.ts';

const SWITCH_ELEMENT_ID          = 'ap-finished-switch';
const CUSTOM_PILL_ELEMENT_ID     = 'ap-finished-custom';
const POPOVER_ELEMENT_ID         = 'ap-finished-popover';
const CUSTOM_PRESETS_ELEMENT_ID  = 'ap-finished-presets';
const SINCE_FIELD_ELEMENT_ID     = 'ap-finished-since';
const SINCE_RESOLVED_ELEMENT_ID  = 'ap-finished-since-resolved';
const STATUS_ELEMENT_ID          = 'ap-finished-status';
const CUSTOM_PILL_VALUE          = 'custom';
const PROGRESS_TAB_NAME          = 'progress';

const ARROW_KEY_STEP: Readonly<Record<string, number>> = {
  ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1,
};

/** When each task and each ticket on the board finished, null for the ones still open. */
export interface FinishedMoments {
  tasks:   readonly (number | null)[];
  tickets: readonly (number | null)[];
}

export interface FinishedWorkSwitchSources {
  initialChoice:       FinishedWorkChoice;
  units:               DurationUnits;
  readFinishedMoments: () => FinishedMoments;
  hiddenNoteTextOf:    (hiddenTaskCount: number, hiddenTicketCount: number) => string;
  /** Stores the choice and redraws every view by it. */
  applyChoice:         (choice: FinishedWorkChoice) => void;
}

export interface FinishedWorkSwitchController {
  readChoice(): FinishedWorkChoice;
  choose(choice: FinishedWorkChoice): void;
  render(): void;
  wire(): void;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function selectedTabName(): string {
  const tab = document.querySelector<HTMLElement>('#ap-tabs [aria-selected="true"]');
  return tab?.dataset['tab'] ?? '';
}

function radiosOf(switchElement: HTMLElement | null): HTMLElement[] {
  return switchElement === null ? [] : [...switchElement.querySelectorAll<HTMLElement>('[role="radio"]')];
}

/** The thumb takes the checked pill's exact box, fractions included, measured inside the switch's border. */
function placeThumb(switchElement: HTMLElement | null): void {
  if (switchElement === null) {
    return;
  }
  const checked = switchElement.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
  if (checked === null) {
    switchElement.setAttribute('data-thumb-empty', '');
    return;
  }
  if (checked.offsetWidth === 0) {
    return;
  }
  const switchBox = switchElement.getBoundingClientRect();
  const pillBox   = checked.getBoundingClientRect();
  switchElement.style.setProperty('--thumb-x', `${pillBox.left - switchBox.left - switchElement.clientLeft}px`);
  switchElement.style.setProperty('--thumb-w', `${pillBox.width}px`);
  switchElement.removeAttribute('data-thumb-empty');
  if (!switchElement.hasAttribute('data-thumb-ready')) {
    requestAnimationFrame(() => switchElement.setAttribute('data-thumb-ready', ''));
  }
}

export function createFinishedWorkSwitchController(sources: FinishedWorkSwitchSources): FinishedWorkSwitchController {
  const {
    units,
    readFinishedMoments,
    hiddenNoteTextOf,
    applyChoice,
  } = sources;
  let choice             = sources.initialChoice;
  let lastCustomChoice   = FinishedWorkUtil.choiceIsCustom(choice) ? choice : null;
  const finishedSwitch   = document.getElementById(SWITCH_ELEMENT_ID);
  const customPill       = document.getElementById(CUSTOM_PILL_ELEMENT_ID);
  const popover          = document.getElementById(POPOVER_ELEMENT_ID);
  const customPresets    = document.getElementById(CUSTOM_PRESETS_ELEMENT_ID);
  const sinceField       = document.getElementById(SINCE_FIELD_ELEMENT_ID);
  const sinceResolved    = document.getElementById(SINCE_RESOLVED_ELEMENT_ID);
  const hiddenNoteButton = document.getElementById(HIDDEN_WORK_NOTE_ELEMENT_ID);

  const renderPill = (radio: HTMLElement, pillChoice: FinishedWorkChoice | null, now: number, moments: readonly (number | null)[], oldest: number | null, noun: string): void => {
    const count = radio.querySelector('.ap-finished-count');
    const reach = radio.querySelector<HTMLElement>('.ap-finished-reach > i');
    const name  = radio.querySelector('.ap-finished-name')?.textContent ?? '';
    if (pillChoice === null) {
      if (count !== null) {
        count.textContent = '';
      }
      reach?.style.setProperty('--reach', '0%');
      radio.setAttribute('aria-label', 'custom: pick a span or a day');
      return;
    }
    const cutoff     = FinishedWorkUtil.cutoffEpochMillisecondsOf(pillChoice, now, units);
    const shownCount = FinishedWorkUtil.shownFinishedCountOf(moments, cutoff);
    if (count !== null) {
      count.textContent = String(shownCount);
    }
    reach?.style.setProperty('--reach', `${FinishedWorkUtil.reachPercentOf(cutoff, oldest, now).toFixed(1)}%`);
    const changeHint = radio === customPill ? ', change the choice' : '';
    radio.setAttribute('aria-label', `${name}: ${plural(shownCount, `finished ${noun}`)} shown${changeHint}`);
  };

  const renderSinceField = (now: number): void => {
    if (!(sinceField instanceof HTMLInputElement) || sinceResolved === null) {
      return;
    }
    sinceField.max = TimeUtil.calendarDateOf(now);
    sinceField.removeAttribute('aria-invalid');
    sinceResolved.removeAttribute('data-invalid');
    const calendarDate = FinishedWorkUtil.sinceCalendarDateOf(choice);
    const dayStart     = calendarDate === null ? null : FinishedWorkUtil.dayStartEpochMillisecondsOf(calendarDate);
    if (calendarDate === null || dayStart === null) {
      sinceField.value = '';
      sinceField.removeAttribute('data-chosen');
      sinceResolved.textContent = '';
      return;
    }
    sinceField.value = calendarDate;
    sinceField.setAttribute('data-chosen', '');
    sinceResolved.textContent = `from ${TimeUtil.fullInstantText(dayStart)} · ${TimeUtil.formatDuration(now - dayStart, units) ?? ''} back`;
  };

  const renderHiddenNote = (now: number, announce: boolean): void => {
    const moments = readFinishedMoments();
    const cutoff  = FinishedWorkUtil.cutoffEpochMillisecondsOf(choice, now, units);
    const text    = hiddenNoteTextOf(FinishedWorkUtil.hiddenCountOf(moments.tasks, cutoff), FinishedWorkUtil.hiddenCountOf(moments.tickets, cutoff));
    if (hiddenNoteButton !== null) {
      if (announce && hiddenNoteButton.textContent !== text) {
        hiddenNoteButton.removeAttribute('data-changed');
        // Reading the layout between the removal and the setting restarts the flash.
        void hiddenNoteButton.offsetWidth;
        hiddenNoteButton.setAttribute('data-changed', '');
      }
      hiddenNoteButton.textContent = text;
      hiddenNoteButton.hidden      = text === '';
    }
    if (announce) {
      const status = document.getElementById(STATUS_ELEMENT_ID);
      if (status !== null) {
        status.textContent = `Showing unfinished work and work finished ${FinishedWorkUtil.windowPhraseOf(choice)}. ${text === '' ? 'Nothing hidden.' : `${text}.`}`;
      }
    }
  };

  const render = (announce = false): void => {
    const now          = Date.now();
    const onProgress   = selectedTabName() === PROGRESS_TAB_NAME;
    const allMoments   = readFinishedMoments();
    const moments      = onProgress ? allMoments.tasks : allMoments.tickets;
    const noun         = onProgress ? 'task' : 'ticket';
    const finished     = moments.filter((moment): moment is number => moment !== null);
    const oldest       = finished.length === 0 ? null : Math.min(...finished);
    const choiceIsCustom = FinishedWorkUtil.choiceIsCustom(choice);
    for (const radio of radiosOf(finishedSwitch)) {
      const pillValue = radio.dataset['finished'] ?? '';
      const isCustom  = pillValue === CUSTOM_PILL_VALUE;
      const checked   = isCustom ? choiceIsCustom : pillValue === choice;
      radio.setAttribute('aria-checked', String(checked));
      radio.tabIndex = checked ? 0 : -1;
      const pillChoice = isCustom ? (checked ? choice : null) : FinishedWorkUtil.choiceFrom(pillValue);
      if (isCustom) {
        const name = radio.querySelector('.ap-finished-name');
        if (name !== null) {
          name.textContent = pillChoice === null ? CUSTOM_PILL_VALUE : FinishedWorkUtil.labelOf(pillChoice);
        }
      }
      renderPill(radio, pillChoice, now, moments, oldest, noun);
    }
    const presetRadios = radiosOf(customPresets);
    const checkedSpan  = CUSTOM_FINISHED_WORK_SPANS.find((span) => span === choice) ?? null;
    presetRadios.forEach((radio, index) => {
      const presetChoice = FinishedWorkUtil.choiceFrom(radio.dataset['customPreset']);
      const checked      = presetChoice !== null && presetChoice === checkedSpan;
      radio.setAttribute('aria-checked', String(checked));
      radio.tabIndex = checked || (checkedSpan === null && index === 0) ? 0 : -1;
      renderPill(radio, presetChoice, now, moments, oldest, noun);
    });
    placeThumb(finishedSwitch);
    placeThumb(customPresets);
    renderSinceField(now);
    renderHiddenNote(now, announce);
  };

  const choose = (next: FinishedWorkChoice): void => {
    choice = next;
    if (FinishedWorkUtil.choiceIsCustom(next)) {
      lastCustomChoice = next;
    }
    applyChoice(next);
    render(true);
  };

  const popoverIsOpen = (): boolean => popover !== null && !popover.hidden;

  const closePopover = (returnFocus: boolean): void => {
    if (!popoverIsOpen() || popover === null) {
      return;
    }
    popover.hidden = true;
    customPill?.setAttribute('aria-expanded', 'false');
    if (returnFocus) {
      customPill?.focus();
    }
  };

  const openPopover = (): void => {
    if (popover === null) {
      return;
    }
    popover.hidden = false;
    customPill?.setAttribute('aria-expanded', 'true');
    render();
    const checkedPreset = customPresets?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? null;
    const firstPreset   = radiosOf(customPresets)[0] ?? null;
    const focusTarget   = checkedPreset ?? (FinishedWorkUtil.sinceCalendarDateOf(choice) === null ? firstPreset : sinceField);
    focusTarget?.focus();
  };

  /** Arrow keys move and check like any radio group; arriving on custom checks the last custom choice, or only moves focus while none is. */
  const moveWithArrows = (event: KeyboardEvent, radios: readonly HTMLElement[], choiceOfRadio: (radio: HTMLElement) => FinishedWorkChoice | null): void => {
    const step = Object.hasOwn(ARROW_KEY_STEP, event.key) ? ARROW_KEY_STEP[event.key] : undefined;
    if (step === undefined || radios.length === 0) {
      return;
    }
    event.preventDefault();
    const current = radios.findIndex((radio) => radio === document.activeElement);
    const next    = radios[(current + step + radios.length) % radios.length];
    if (next === undefined) {
      return;
    }
    const nextChoice = choiceOfRadio(next);
    if (nextChoice !== null) {
      choose(nextChoice);
    }
    next.focus();
  };

  const wireSinceField = (): void => {
    if (!(sinceField instanceof HTMLInputElement)) {
      return;
    }
    sinceField.addEventListener('input', () => {
      const next = FinishedWorkUtil.sinceChoiceFor(sinceField.value);
      if (sinceResolved === null) {
        return;
      }
      if (next === null) {
        sinceResolved.removeAttribute('data-invalid');
        sinceResolved.textContent = 'Pick a day, or a span above';
        return;
      }
      if (sinceField.value > TimeUtil.calendarDateOf(Date.now())) {
        sinceField.setAttribute('aria-invalid', 'true');
        sinceResolved.setAttribute('data-invalid', '');
        sinceResolved.textContent = 'That is after today';
        return;
      }
      choose(next);
    });
    sinceField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        closePopover(true);
      }
    });
  };

  const wire = (): void => {
    finishedSwitch?.addEventListener('click', (event) => {
      const radio = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-finished]') : null;
      if (radio === null) {
        return;
      }
      if (radio === customPill) {
        if (popoverIsOpen()) {
          closePopover(true);
        } else {
          openPopover();
        }
        return;
      }
      closePopover(false);
      const next = FinishedWorkUtil.choiceFrom(radio.dataset['finished']);
      if (next !== null) {
        choose(next);
      }
    });
    finishedSwitch?.addEventListener('keydown', (event) => {
      moveWithArrows(event, radiosOf(finishedSwitch), (radio) => {
        closePopover(false);
        return radio === customPill ? lastCustomChoice : FinishedWorkUtil.choiceFrom(radio.dataset['finished']);
      });
    });
    customPresets?.addEventListener('click', (event) => {
      const radio = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-custom-preset]') : null;
      const next  = FinishedWorkUtil.choiceFrom(radio?.dataset['customPreset']);
      if (radio !== null && next !== null) {
        choose(next);
        radio.focus();
      }
    });
    customPresets?.addEventListener('keydown', (event) => {
      moveWithArrows(event, radiosOf(customPresets), (radio) => FinishedWorkUtil.choiceFrom(radio.dataset['customPreset']));
    });
    wireSinceField();
    hiddenNoteButton?.addEventListener('click', () => {
      choose('all');
      customPill?.focus();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && popoverIsOpen()) {
        closePopover(true);
      }
    });
    document.addEventListener('pointerdown', (event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (popoverIsOpen() && target !== null && !(popover?.contains(target) ?? false) && !(customPill?.contains(target) ?? false)) {
        closePopover(false);
      }
    });
    // The counts are the selected tab's: tasks on Progress, tickets elsewhere. The template's own tab listener runs first.
    document.getElementById('ap-tabs')?.addEventListener('click', () => render());
    if (typeof ResizeObserver === 'function') {
      const thumbObserver = new ResizeObserver(() => {
        placeThumb(finishedSwitch);
        placeThumb(customPresets);
      });
      for (const radio of [...radiosOf(finishedSwitch), ...radiosOf(customPresets)]) {
        thumbObserver.observe(radio);
      }
    }
  };

  return {
    readChoice: () => choice,
    choose,
    render:     () => render(),
    wire,
  };
}
