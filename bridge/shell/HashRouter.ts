/**
 * The Bridge's routes are hash fragments, `#<tab>` or `#<tab>/<item>` (`#agents/J12`, `#tickets/42`), so a link survives an Overseer restart
 * and needs no server route. A fragment naming no tab falls back to the stored tab, then the first.
 */
import { useEffect, useState } from 'react';

export const BRIDGE_TABS = ['kanban', 'progress', 'tickets', 'agents', 'questions', 'assistant', 'intake'] as const;

export type BridgeTab = typeof BRIDGE_TABS[number];

export interface BridgeRoute {
  readonly tab:  BridgeTab;
  /** The item the fragment opens in its tab, `null` for the tab alone. */
  readonly item: string | null;
}

export const TAB_CHOICE_NAME = 'tab';
export const [DEFAULT_TAB] = BRIDGE_TABS;

function isBridgeTab(name: string | null): name is BridgeTab {
  return (BRIDGE_TABS as readonly (string | null)[]).includes(name);
}

function routeOf(fragment: string, storedTab: string | null): BridgeRoute {
  const [tabName = '', ...itemParts] = fragment.replace(/^#/, '').split('/');
  const item = itemParts.join('/');
  if (isBridgeTab(tabName)) return { tab: tabName, item: item === '' ? null : decodeURIComponent(item) };
  return { tab: isBridgeTab(storedTab) ? storedTab : DEFAULT_TAB, item: null };
}

function fragmentOf(route: BridgeRoute): string {
  return route.item === null ? `#${route.tab}` : `#${route.tab}/${encodeURIComponent(route.item)}`;
}

/** The route the address bar names, followed through every `hashchange`. */
function useHashRoute(storedTab: () => string | null): BridgeRoute {
  const [route, setRoute] = useState(() => routeOf(window.location.hash, storedTab()));
  useEffect(() => {
    const follow = (): void => setRoute(routeOf(window.location.hash, storedTab()));
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [storedTab]);
  return route;
}

export const HashRouter = Object.freeze({ routeOf, fragmentOf, useHashRoute });
