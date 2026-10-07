/**
 * The spec page's detail targets. The cases that matter: each kind's opener and its selection selector name the attributes the views will
 * write, a spec shows its title and lane and a work item its title and state, both escaped, and an id the snapshot does not hold opens nothing.
 */

import { describe, expect, test } from 'bun:test';

import type { SpecSnapshot }   from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import { specDetailTargetsOf } from './SpecDetailTargets.ts';

const EXAMPLE_SNAPSHOT = {
  specs: [{
    folderName: '001-example-checkout',
    title:      'Example <checkout>',
    lane:       'implement',
    workItems:  [{ id: '001-example-checkout-p03', title: 'Pay by Example Card', state: 'in-progress' }],
  }],
} as unknown as SpecSnapshot;

const TARGETS = specDetailTargetsOf(EXAMPLE_SNAPSHOT);

describe('specDetailTargetsOf', () => {
  test('a spec opens from [data-open-spec] and is marked by its data-spec-key', () => {
    expect(TARGETS.spec.openerSelector).toBe('[data-open-spec]');
    expect(TARGETS.spec.selectorFor('X')).toBe('[data-open-spec][data-spec-key="X"]');
  });

  test('a work item opens from [data-open-work-item] and is marked by its data-work-item-id', () => {
    expect(TARGETS['work-item'].openerSelector).toBe('[data-open-work-item]');
    expect(TARGETS['work-item'].selectorFor('X')).toBe('[data-open-work-item][data-work-item-id="X"]');
  });

  test('a spec shows its escaped title and its lane', () => {
    const markup = TARGETS.spec.markupOf('001-example-checkout');

    expect(markup).toContain('Example &lt;checkout&gt;');
    expect(markup).toContain('<div><b>lane</b><span>implement</span></div>');
  });

  test('a work item shows its title and its state', () => {
    const markup = TARGETS['work-item'].markupOf('001-example-checkout-p03');

    expect(markup).toContain('Pay by Example Card');
    expect(markup).toContain('<div><b>state</b><span>in-progress</span></div>');
  });

  test('an id the snapshot does not hold has nothing to open', () => {
    expect([TARGETS.spec.markupOf('404-missing'), TARGETS['work-item'].markupOf('404-missing-p01')]).toEqual(['', '']);
  });
});
