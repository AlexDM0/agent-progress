/** The log card: its entries, cut to the newest unless the viewer asked for all, and the toggle between the two. */

import type { WordedLogEntry }    from '../../src/shared/@types/WordedLogEntry.ts';
import type { ViewerPreferences } from '../preferences/ViewerPreferences.ts';
import { toggledLogVisibility }   from '../preferences/ViewerPreferences.ts';
import { DomUtil }                from '../utils/DomUtil.ts';
import { LogMarkupUtil }          from '../utils/LogMarkupUtil.ts';
import type { TimestampSlices }   from '../utils/TimeUtil.ts';
import { LogCapUtil }             from './utils/LogCapUtil.ts';

interface LogControllerSources {
  entries:               readonly WordedLogEntry[];
  slices:                TimestampSlices;
  preferences:           ViewerPreferences;
  readTodayCalendarDate: () => string;
}

export function createLogController(sources: LogControllerSources): { show(): void; wire(): void } {
  const {
    entries,
    slices,
    preferences,
    readTodayCalendarDate,
  } = sources;
  let logVisibility = preferences.readLogVisibility();

  const show = (): void => {
    const controlIsNeeded = LogCapUtil.logControlIsNeeded(entries.length);
    DomUtil.setMarkup('ap-log', LogMarkupUtil.logItemsMarkup(entries, slices, readTodayCalendarDate(), controlIsNeeded ? LogCapUtil.logEntryLimitFor(logVisibility) : null));
    DomUtil.setHidden('ap-log-empty', entries.length > 0);
    DomUtil.setText('ap-log-note', LogCapUtil.logNoteText(entries.length, logVisibility));
    DomUtil.setHidden('ap-log-control', !controlIsNeeded);
    const control = document.getElementById('ap-log-toggle');
    if (control !== null) {
      control.textContent = LogCapUtil.logControlText(entries.length);
      control.setAttribute('aria-pressed', String(logVisibility === 'all'));
    }
  };

  const wire = (): void => {
    document.getElementById('ap-log-toggle')?.addEventListener('click', () => {
      logVisibility = toggledLogVisibility(logVisibility);
      preferences.writeLogVisibility(logVisibility);
      show();
    });
  };

  return { show, wire };
}
