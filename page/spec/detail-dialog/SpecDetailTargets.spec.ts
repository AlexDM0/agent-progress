/**
 * The spec page's detail targets. The cases that matter: a card opens what it carries the key of and its selection selector finds it again,
 * a spec chip or spec title link opens the spec and is checked before a work item link, so a chip on a work card opens its spec; a spec shows
 * its title and lane and a work item its title, state and task lines, all escaped; and an id the snapshot does not hold opens nothing.
 */

import { describe, expect, test } from 'bun:test';

import type { SpecSnapshot }                             from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import { SPEC_DETAIL_LINK_OPENERS, specDetailTargetsOf } from './SpecDetailTargets.ts';

const EXAMPLE_SNAPSHOT = {
  specs: [{
    folderName: '001-example-checkout',
    title:      'Example <checkout>',
    lane:       'implement',
    workItems:  [{
      id:    '001-example-checkout-p03',
      title: 'Pay by Example Card',
      state: 'in-progress',
      tasks: [
        {
          id: 'T007', isDone: true, isParallel: true, storyNumber: 1, description: 'Write the <card> form',
        },
        {
          id: 'T008', isDone: false, isParallel: false, storyNumber: null, description: 'Example wiring',
        },
      ],
    }],
  }],
} as unknown as SpecSnapshot;

const TARGETS = specDetailTargetsOf(EXAMPLE_SNAPSHOT);

describe('specDetailTargetsOf', () => {
  test('a spec opens from its card\'s data-spec-key, which also marks it', () => {
    expect(TARGETS.spec.openerSelector).toBe('[data-spec-key]');
    expect(TARGETS.spec.selectorFor('X')).toBe('[data-spec-key="X"]');
  });

  test('a work item opens from its card\'s data-work-item-id, which also marks it', () => {
    expect(TARGETS['work-item'].openerSelector).toBe('[data-work-item-id]');
    expect(TARGETS['work-item'].selectorFor('X')).toBe('[data-work-item-id="X"]');
  });

  test('a spec shows its escaped title and its lane', () => {
    const markup = TARGETS.spec.markupOf('001-example-checkout');

    expect(markup).toContain('Example &lt;checkout&gt;');
    expect(markup).toContain('<div><b>lane</b><span>implement</span></div>');
  });

  test('a work item shows its title, its state and its task lines: id, done, [P], story label and escaped description', () => {
    const markup = TARGETS['work-item'].markupOf('001-example-checkout-p03');

    expect(markup).toContain('Pay by Example Card');
    expect(markup).toContain('<div><b>state</b><span>in-progress</span></div>');
    expect(markup).toContain('<li data-done="true"><code>T007</code><span class="ap-spec-task-done" title="Done">✓</span>'
      + '<span class="ap-spec-task-mark">[P]</span><span class="ap-spec-task-mark">[US1]</span><span>Write the &lt;card&gt; form</span></li>');
    expect(markup).toContain('<li data-done="false"><code>T008</code><span class="ap-spec-task-done" title="Not done">○</span><span>Example wiring</span></li>');
  });

  test('an id the snapshot does not hold has nothing to open', () => {
    expect([TARGETS.spec.markupOf('404-missing'), TARGETS['work-item'].markupOf('404-missing-p01')]).toEqual(['', '']);
  });
});

describe('SPEC_DETAIL_LINK_OPENERS', () => {
  test('a [data-spec] chip or a [data-open-spec] link opens the spec, checked before a [data-open-work-item] link', () => {
    expect(SPEC_DETAIL_LINK_OPENERS.map((opener) => [opener.kind, opener.selector])).toEqual([
      ['spec', '[data-spec], [data-open-spec]'],
      ['work-item', '[data-open-work-item]'],
    ]);
  });
});
