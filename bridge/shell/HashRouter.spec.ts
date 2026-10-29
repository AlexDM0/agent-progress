/**
 * The hash routes. What matters: `#<tab>` and `#<tab>/<item>` round-trip, an item is decoded, and a fragment naming no tab falls back to
 * the stored tab, then the first.
 */
import { describe, expect, test } from 'bun:test';

import { HashRouter } from './HashRouter.ts';

describe('the hash router', () => {
  test('a tab and a tab with an item round-trip', () => {
    expect(HashRouter.routeOf('#agents/J12', null)).toEqual({ tab: 'agents', item: 'J12' });
    expect(HashRouter.routeOf('#tickets', null)).toEqual({ tab: 'tickets', item: null });
    expect(HashRouter.fragmentOf({ tab: 'agents', item: 'J12' })).toBe('#agents/J12');
    expect(HashRouter.routeOf(HashRouter.fragmentOf({ tab: 'tickets', item: 'a/b c' }), null)).toEqual({ tab: 'tickets', item: 'a/b c' });
  });

  test('a fragment naming no tab falls back to the stored tab, then the first', () => {
    expect(HashRouter.routeOf('', 'questions')).toEqual({ tab: 'questions', item: null });
    expect(HashRouter.routeOf('#nowhere', 'not-a-tab')).toEqual({ tab: 'kanban', item: null });
  });
});
