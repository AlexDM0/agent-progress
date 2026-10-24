/**
 * The filter line at the end of the tab row and the menu it opens. The line names the finished-work window and, on the Kanban, the
 * pressed epic; the menu's Finished work section (every tab) is this controller's, its Kanban-only sections belong to their own
 * controllers and show only while the Kanban is selected. The rules are `FinishedWorkUtil`'s.
 */

import type { FinishedWorkChoice }                        from '../@types/ViewerChoices.ts';
import { HIDDEN_WORK_COUNT_ELEMENT_ID, KANBAN_TAB_NAME }  from '../constants/TemplateIds.ts';
import type { EpicFilterLabel }                           from '../kanban/KanbanEpicFilterController.ts';
import { DEFAULT_FINISHED_WORK_CHOICE, FinishedWorkUtil } from '../utils/FinishedWorkUtil.ts';
import type { DurationUnits }                             from '../utils/TimeUtil.ts';
import { TimeUtil }                                       from '../utils/TimeUtil.ts';

const FILTER_LINE_ELEMENT_ID      = 'ap-filter-line';
const FILTER_RANGE_ELEMENT_ID     = 'ap-filter-range';
const FILTER_EPIC_ELEMENT_ID      = 'ap-filter-epic';
const FILTER_MENU_ELEMENT_ID      = 'ap-filter-menu';
const FILTER_RESET_ELEMENT_ID     = 'ap-filter-reset';
const FINISHED_SPANS_ELEMENT_ID   = 'ap-finished-spans';
const SINCE_FIELD_ELEMENT_ID      = 'ap-finished-since';
const SINCE_RESOLVED_ELEMENT_ID   = 'ap-finished-since-resolved';
const SHOW_ALL_ELEMENT_ID         = 'ap-show-all-finished';
const STATUS_ELEMENT_ID           = 'ap-finished-status';
const PROGRESS_TAB_NAME           = 'progress';

/** When each task, ticket and epic on the board finished, null for the ones still open. */
export interface FinishedMoments {
  tasks:   readonly (number | null)[];
  tickets: readonly (number | null)[];
  epics:   readonly (number | null)[];
}

export interface FilterMenuSources {
  initialChoice:       FinishedWorkChoice;
  units:               DurationUnits;
  readFinishedMoments: () => FinishedMoments;
  hiddenNoteTextOf:    (hiddenTicketCount: number, hiddenEpicCount: number) => string;
  /** Stores the choice and redraws every view by it. */
  applyChoice:         (choice: FinishedWorkChoice) => void;
  readEpicLabel:       () => EpicFilterLabel | null;
  /** Clears the Kanban's epic filter and To do order; the finished-work choice that follows redraws the board. */
  resetKanbanFilters:  () => void;
}

export interface FilterMenuController {
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

function spanButtonsOf(spans: HTMLElement | null): HTMLElement[] {
  return spans === null ? [] : [...spans.querySelectorAll<HTMLElement>('[data-finished]')];
}

export function createFilterMenuController(sources: FilterMenuSources): FilterMenuController {
  const {
    units,
    readFinishedMoments,
    hiddenNoteTextOf,
    applyChoice,
    readEpicLabel,
  } = sources;
  let choice          = sources.initialChoice;
  const filterLine    = document.getElementById(FILTER_LINE_ELEMENT_ID);
  const menu          = document.getElementById(FILTER_MENU_ELEMENT_ID);
  const spans         = document.getElementById(FINISHED_SPANS_ELEMENT_ID);
  const sinceField    = document.getElementById(SINCE_FIELD_ELEMENT_ID);
  const sinceResolved = document.getElementById(SINCE_RESOLVED_ELEMENT_ID);
  const showAll       = document.getElementById(SHOW_ALL_ELEMENT_ID);

  const renderSpans = (now: number, onProgress: boolean): void => {
    const allMoments = readFinishedMoments();
    const moments    = onProgress ? allMoments.tasks : allMoments.tickets;
    const noun       = onProgress ? 'task' : 'ticket';
    for (const button of spanButtonsOf(spans)) {
      const spanChoice = FinishedWorkUtil.choiceFrom(button.dataset['finished']);
      if (spanChoice === null) {
        continue;
      }
      const shownCount = FinishedWorkUtil.shownFinishedCountOf(moments, FinishedWorkUtil.cutoffEpochMillisecondsOf(spanChoice, now, units));
      const count      = button.querySelector('.ap-chip-count');
      if (count !== null) {
        count.textContent = String(shownCount);
      }
      button.setAttribute('aria-pressed', String(spanChoice === choice));
      button.setAttribute('aria-label', `${FinishedWorkUtil.labelOf(spanChoice)}: ${plural(shownCount, `finished ${noun}`)} shown`);
    }
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

  const renderLine = (hiddenItemCount: number, onKanban: boolean): void => {
    const range = document.getElementById(FILTER_RANGE_ELEMENT_ID);
    if (range !== null) {
      const { lead, window } = FinishedWorkUtil.filterLineTextOf(choice, hiddenItemCount);
      const windowElement    = document.createElement('strong');
      windowElement.textContent = window;
      range.replaceChildren(lead, ...(window === '' ? [] : [windowElement]));
      range.title = `Unfinished work always shows; work finished ${FinishedWorkUtil.windowPhraseOf(choice)} shows beside it`;
    }
    const epicPart  = document.getElementById(FILTER_EPIC_ELEMENT_ID);
    const epicLabel = onKanban ? readEpicLabel() : null;
    if (epicPart !== null) {
      epicPart.hidden = epicLabel === null;
      const swatch = epicPart.querySelector<HTMLElement>('.ap-epic-swatch');
      const name   = epicPart.querySelector<HTMLElement>('.ap-filter-epic-name');
      epicPart.toggleAttribute('data-no-swatch', epicLabel?.slot === null);
      swatch?.setAttribute('data-epic-slot', String(epicLabel?.slot ?? ''));
      if (name !== null) {
        name.textContent = epicLabel?.title ?? '';
        name.title       = epicLabel?.title ?? '';
      }
    }
  };

  const render = (announce = false): void => {
    const now        = Date.now();
    const tabName    = selectedTabName();
    const moments    = readFinishedMoments();
    const cutoff     = FinishedWorkUtil.cutoffEpochMillisecondsOf(choice, now, units);
    const hiddenTickets = FinishedWorkUtil.hiddenCountOf(moments.tickets, cutoff);
    const hiddenEpics   = FinishedWorkUtil.hiddenCountOf(moments.epics, cutoff);
    const hiddenText    = hiddenNoteTextOf(hiddenTickets, hiddenEpics);
    menu?.setAttribute('data-tab', tabName);
    renderSpans(now, tabName === PROGRESS_TAB_NAME);
    renderSinceField(now);
    const hiddenCount = document.getElementById(HIDDEN_WORK_COUNT_ELEMENT_ID);
    if (hiddenCount !== null) {
      hiddenCount.textContent = hiddenText === '' ? 'Nothing hidden' : hiddenText;
    }
    if (showAll !== null) {
      showAll.hidden = hiddenText === '';
    }
    renderLine(hiddenTickets + hiddenEpics, tabName === KANBAN_TAB_NAME);
    if (announce) {
      const status = document.getElementById(STATUS_ELEMENT_ID);
      if (status !== null) {
        status.textContent = `Showing unfinished work and work finished ${FinishedWorkUtil.windowPhraseOf(choice)}. ${hiddenText === '' ? 'Nothing hidden.' : `${hiddenText}.`}`;
      }
    }
  };

  const choose = (next: FinishedWorkChoice): void => {
    choice = next;
    applyChoice(next);
    render(true);
  };

  const menuIsOpen = (): boolean => menu !== null && !menu.hidden;

  const closeMenu = (returnFocus: boolean): void => {
    if (!menuIsOpen() || menu === null) {
      return;
    }
    menu.hidden = true;
    filterLine?.setAttribute('aria-expanded', 'false');
    if (returnFocus) {
      filterLine?.focus();
    }
  };

  const openMenu = (): void => {
    if (menu === null) {
      return;
    }
    menu.hidden = false;
    filterLine?.setAttribute('aria-expanded', 'true');
    render();
    const pressedSpan = spans?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? null;
    (pressedSpan ?? (FinishedWorkUtil.sinceCalendarDateOf(choice) === null ? spanButtonsOf(spans)[0] : sinceField))?.focus();
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
        closeMenu(true);
      }
    });
  };

  const wire = (): void => {
    filterLine?.addEventListener('click', () => {
      if (menuIsOpen()) {
        closeMenu(true);
      } else {
        openMenu();
      }
    });
    spans?.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-finished]') : null;
      const next   = FinishedWorkUtil.choiceFrom(button?.dataset['finished']);
      if (next !== null) {
        choose(next);
      }
    });
    wireSinceField();
    showAll?.addEventListener('click', () => {
      choose('all');
      spans?.querySelector<HTMLElement>('[data-finished="all"]')?.focus();
    });
    document.getElementById(FILTER_RESET_ELEMENT_ID)?.addEventListener('click', () => {
      sources.resetKanbanFilters();
      choose(DEFAULT_FINISHED_WORK_CHOICE);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menuIsOpen()) {
        closeMenu(true);
      }
    });
    document.addEventListener('pointerdown', (event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (menuIsOpen() && target !== null && !(menu?.contains(target) ?? false) && !(filterLine?.contains(target) ?? false)) {
        closeMenu(false);
      }
    });
    // The counts are the selected tab's (tasks on Progress, tickets elsewhere) and the Kanban sections are its alone. Watched on the
    // tabs themselves, since a summary stat or a link selects a tab without a click on it.
    const tabs = document.getElementById('ap-tabs');
    if (tabs !== null && typeof MutationObserver === 'function') {
      new MutationObserver(() => render()).observe(tabs, { subtree: true, attributeFilter: ['aria-selected'] });
    }
  };

  return {
    choose,
    render: () => render(),
    wire,
  };
}
