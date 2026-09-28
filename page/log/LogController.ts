/** The log card: its filter, the newest matching entries and more on request, and the ticket links inside its lines. */

import type { IdentifiedLogEntry }                                            from '../../src/shared/@types/WordedLogEntry.ts';
import { LOG_ENTRIES_ELEMENT_ID, LOG_FILTER_ELEMENT_ID, LOG_NOTE_ELEMENT_ID } from '../constants/TemplateIds.ts';
import { DomUtil }                                                            from '../utils/DomUtil.ts';
import { MarkupUtil }                                                         from '../utils/MarkupUtil.ts';
import type { TimestampSlices }                                               from '../utils/TimeUtil.ts';
import { LogCapUtil }                                                         from './utils/LogCapUtil.ts';
import { LogFilterUtil }                                                      from './utils/LogFilterUtil.ts';

const LOG_CONTROL_ELEMENT_ID = 'ap-log-control';
const LOG_MORE_ELEMENT_ID    = 'ap-log-more';

interface LogControllerSources {
  entries:               readonly IdentifiedLogEntry[];
  linkedTicketIds:       ReadonlySet<string>;
  slices:                TimestampSlices;
  readTodayCalendarDate: () => string;
  openTicketDetail:      (ticketId: string) => void;
}

export interface LogController {
  show(): void;
  wire(): void;
  /** Filters the log as if the viewer had typed the text, which the input then shows. */
  applyFilter(filterText: string): void;
}

export function createLogController(sources: LogControllerSources): LogController {
  const {
    entries,
    linkedTicketIds,
    slices,
    readTodayCalendarDate,
    openTicketDetail,
  } = sources;
  let filterText      = '';
  let matchingEntries = [...entries];
  let shownCount      = LogCapUtil.firstShownCount(matchingEntries.length);

  const showControlAndNote = (): void => {
    DomUtil.setText(LOG_NOTE_ELEMENT_ID, LogCapUtil.logNoteText(shownCount, matchingEntries.length, filterText));
    DomUtil.setHidden(LOG_CONTROL_ELEMENT_ID, !LogCapUtil.moreAreHidden(shownCount, matchingEntries.length));
    DomUtil.setText(LOG_MORE_ELEMENT_ID, LogCapUtil.moreControlText(shownCount, matchingEntries.length));
  };

  const itemsMarkup = (start: number, end: number): string => MarkupUtil.logItemsMarkup(matchingEntries, slices, readTodayCalendarDate(), {
    shownRange: { start, end },
    linkedTicketIds,
  });

  const show = (): void => {
    DomUtil.setMarkup(LOG_ENTRIES_ELEMENT_ID, itemsMarkup(0, shownCount));
    DomUtil.setHidden('ap-log-empty', entries.length > 0);
    showControlAndNote();
  };

  const showMore = (): void => {
    const nextCount = LogCapUtil.nextShownCount(shownCount, matchingEntries.length);
    DomUtil.appendMarkup(LOG_ENTRIES_ELEMENT_ID, itemsMarkup(shownCount, nextCount));
    shownCount = nextCount;
    showControlAndNote();
  };

  const filterBy = (text: string): void => {
    filterText      = text;
    matchingEntries = LogFilterUtil.entriesMatchingQuery(entries, text);
    shownCount      = LogCapUtil.firstShownCount(matchingEntries.length);
    show();
  };

  const wire = (): void => {
    document.getElementById(LOG_MORE_ELEMENT_ID)?.addEventListener('click', showMore);
    document.getElementById(LOG_FILTER_ELEMENT_ID)?.addEventListener('input', (event) => {
      if (event.target instanceof HTMLInputElement) {
        filterBy(event.target.value);
      }
    });
    // Enter on a focused link arrives here as a click too, so the keyboard opens the same detail.
    document.getElementById(LOG_ENTRIES_ELEMENT_ID)?.addEventListener('click', (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[data-log-ticket-id]') : null;
      if (link instanceof HTMLElement) {
        event.preventDefault();
        openTicketDetail(link.dataset['logTicketId'] ?? '');
      }
    });
  };

  const applyFilter = (text: string): void => {
    const input = document.getElementById(LOG_FILTER_ELEMENT_ID);
    if (input instanceof HTMLInputElement) {
      input.value = text;
    }
    filterBy(text);
  };

  return { show, wire, applyFilter };
}
