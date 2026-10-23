/**
 * The address-bar fragment, routed for the page: a tab's name selects that tab, an item fragment is the caller's own to open,
 * and any other fragment naming an element selects its panel, opens its disclosures and scrolls to it.
 */

import { DomUtil } from '../utils/DomUtil.ts';

const FALLBACK_PANEL_NAME = 'progress';

export interface FragmentRouterOptions {
  readonly tabNames:         readonly string[];
  /** Opens the item the fragment, without its `#`, names, and says whether it named one. */
  readonly openItemFragment: (target: string) => boolean;
}

export interface FragmentRouter {
  applyFragment(fragment: string): void;
  wireSameFragmentReclick(): void;
}

export function createFragmentRouter(options: FragmentRouterOptions): FragmentRouter {
  const { tabNames, openItemFragment } = options;

  const applyFragment = (fragment: string): void => {
    const target = fragment.replace(/^#/, '');
    if (target === '') {
      return;
    }
    const behaviour = DomUtil.templateBehaviour();
    if (tabNames.includes(target)) {
      behaviour?.selectTab(target);
      return;
    }
    if (openItemFragment(target)) {
      return;
    }
    const element = document.getElementById(target);
    if (element === null) {
      return;
    }
    const panel = element.closest('[data-panel]');
    if (panel instanceof HTMLElement) {
      behaviour?.selectTab(panel.dataset['panel'] ?? FALLBACK_PANEL_NAME);
    }
    for (const disclosure of [element.closest('details'), element.querySelector('details')]) {
      if (disclosure instanceof HTMLDetailsElement) {
        disclosure.open = true;
      }
    }
    element.scrollIntoView();
  };

  // A link to the item fragment already in the address bar fires no hashchange, so its item, closed since, would not reopen.
  const wireSameFragmentReclick = (): void => {
    document.addEventListener('click', (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
      const href = link?.getAttribute('href') ?? '';
      if (href !== '' && href === window.location.hash) {
        openItemFragment(href.slice(1));
      }
    });
  };

  return { applyFragment, wireSameFragmentReclick };
}
