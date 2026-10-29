/**
 * What the Bridge sets on the document before React's first paint: the theme from the stored choice or the system's, and the embedded
 * mark for agent-dashboard's frame. `board.css` keeps the body hidden until `data-theme` is set, so no wrong theme flashes.
 */
import type { PreferenceStore } from '../preferences/PreferenceStore.ts';

export type ThemeChoice = 'auto' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_CHOICE_NAME = 'theme';
export const DEFAULT_THEME_CHOICE: ThemeChoice = 'auto';
const EMBEDDED_DASHBOARD = 'dashboard';
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export interface DocumentSurroundings {
  readonly root:              HTMLElement;
  readonly search:            string;
  readonly systemPrefersDark: () => boolean;
}

function themeChoiceOf(stored: string | null): ThemeChoice {
  return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME_CHOICE;
}

function themeOf(choice: ThemeChoice, systemPrefersDark: () => boolean): Theme {
  if (choice === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return choice;
}

function applyTheme(root: HTMLElement, theme: Theme, choice: ThemeChoice): void {
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-theme-choice', choice);
}

/** Only the literal `?embedded=dashboard` marks the document embedded. */
function isEmbeddedInDashboard(search: string): boolean {
  return new URLSearchParams(search).get('embedded') === EMBEDDED_DASHBOARD;
}

function browserSurroundings(): DocumentSurroundings {
  return {
    root:              document.documentElement,
    search:            window.location.search,
    systemPrefersDark: () => window.matchMedia(DARK_SCHEME_QUERY).matches,
  };
}

function applyBeforeFirstPaint(store: PreferenceStore, surroundings: DocumentSurroundings = browserSurroundings()): { embedded: boolean } {
  const choice = themeChoiceOf(store.readChoice(THEME_CHOICE_NAME));
  applyTheme(surroundings.root, themeOf(choice, surroundings.systemPrefersDark), choice);
  const embedded = isEmbeddedInDashboard(surroundings.search);
  if (embedded) surroundings.root.setAttribute('data-embedded', EMBEDDED_DASHBOARD);
  return { embedded };
}

/** A viewer's choice, stored and applied at once. */
function chooseTheme(store: PreferenceStore, choice: ThemeChoice, surroundings: DocumentSurroundings = browserSurroundings()): void {
  store.writeChoice(THEME_CHOICE_NAME, choice, DEFAULT_THEME_CHOICE);
  applyTheme(surroundings.root, themeOf(choice, surroundings.systemPrefersDark), choice);
}

/** A theme the embedding parent sends: applied, never stored, since it is the dashboard's choice and not this viewer's. */
function applyParentTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  applyTheme(root, theme, theme);
}

export const ThemeBootstrap = Object.freeze({
  applyBeforeFirstPaint, chooseTheme, applyParentTheme, themeChoiceOf,
});
