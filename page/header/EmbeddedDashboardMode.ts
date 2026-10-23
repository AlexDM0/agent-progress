/**
 * The tracker page framed by agent-dashboard, `progress.html?embedded=dashboard`. The dashboard shows the status, the project title, the
 * statistics and a theme switch of its own, so the page hides those, folds the activity banner to one line and ends the tab row with
 * today's figures. Its styles arrive with the page script, so the page opened without the parameter stays the template byte for byte.
 */

/** The theme switch stays in the document, only undisplayed: the dashboard sets the board's theme by clicking its buttons. */
export const EMBEDDED_DASHBOARD_STYLES = `
html[data-embedded="dashboard"] .ap-head { gap: 12px; }
html[data-embedded="dashboard"] .ap-head-title-row { display: none; }
html[data-embedded="dashboard"] #ap-status { display: none; }
html[data-embedded="dashboard"] #ap-project { display: none; }
html[data-embedded="dashboard"] #ap-summary { display: none; }
html[data-embedded="dashboard"] #ap-theme { display: none; }
html[data-embedded="dashboard"] .ap-activity {
  display: flex; flex-wrap: nowrap; align-items: center; gap: 24px; overflow: hidden;
  padding: 6px 12px; border-radius: 10px;
}
html[data-embedded="dashboard"] .ap-activity[hidden] { display: none; }
html[data-embedded="dashboard"] .ap-activity-row { flex: 0 1 auto; gap: 8px; font-size: var(--fs-small); }
html[data-embedded="dashboard"] .ap-activity-title { flex: 0 1 auto; max-width: 320px; }
html[data-embedded="dashboard"] .ap-tab-bar {
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  grid-template-areas: "tabs note finished today";
}
html[data-embedded="dashboard"] .ap-tab-bar > .ap-tab-today {
  grid-area: today; justify-self: end; margin-left: auto;
  font: 400 var(--fs-small)/1.5 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--ink-muted); white-space: nowrap;
}
`;

export const TODAY_FIGURES_ELEMENT_ID = 'ap-today';

const EMBEDDED_QUERY_PARAMETER = 'embedded';
const DASHBOARD_EMBEDDING      = 'dashboard';
const EMBEDDED_ATTRIBUTE       = 'data-embedded';
const TAB_BAR_SELECTOR         = '.ap-tab-bar';

/** Only the literal `dashboard` embeds the page; any other value, or none, is the normal page. */
export function embedsInDashboard(locationSearch: string): boolean {
  return new URLSearchParams(locationSearch).get(EMBEDDED_QUERY_PARAMETER) === DASHBOARD_EMBEDDING;
}

export function enterEmbeddedDashboardMode(): void {
  document.documentElement.setAttribute(EMBEDDED_ATTRIBUTE, DASHBOARD_EMBEDDING);
  const styles       = document.createElement('style');
  styles.textContent = EMBEDDED_DASHBOARD_STYLES;
  document.head.append(styles);
  const todayFigures     = document.createElement('span');
  todayFigures.id        = TODAY_FIGURES_ELEMENT_ID;
  todayFigures.className = 'ap-tab-today';
  document.querySelector(TAB_BAR_SELECTOR)?.append(todayFigures);
}
