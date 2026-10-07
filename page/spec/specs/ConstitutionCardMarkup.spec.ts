/**
 * The Specs tab's constitution card. The cases that matter: a filled constitution shows its version, dates, path and one chip per principle,
 * all escaped; a repository without one, or with spec-kit's unfilled template, shows the empty state naming `/speckit-constitution`.
 */

import { describe, expect, test } from 'bun:test';

import type { SnapshotConstitution } from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import { constitutionCardMarkup }    from './ConstitutionCardMarkup.ts';

const EXAMPLE_CONSTITUTION: SnapshotConstitution = {
  state:       'filled',
  version:     '1.2.0',
  ratified:    '2026-09-01',
  lastAmended: '2026-09-30',
  principles:  ['I. Example Library-First', 'II. Example <Test>-First'],
};

describe('constitutionCardMarkup', () => {
  test('shows the version, the ratified and last amended dates, the path and one escaped chip per principle', () => {
    const markup = constitutionCardMarkup(EXAMPLE_CONSTITUTION);

    expect(markup).toContain('Constitution <span class="ap-spec-constitution-version">v1.2.0</span>');
    expect(markup).toContain('<div><b>ratified</b><span>2026-09-01</span></div><div><b>last amended</b><span>2026-09-30</span></div>');
    expect(markup).toContain('<span class="ap-epic-key">.specify/memory/constitution.md</span>');
    expect([...markup.matchAll(/<li class="ap-spec-principle">([^<]*)<\/li>/g)].map((match) => match[1]))
      .toEqual(['I. Example Library-First', 'II. Example &lt;Test&gt;-First']);
  });

  test('without a constitution, or with the unfilled template, shows the empty state naming /speckit-constitution', () => {
    for (const constitution of [null, { ...EXAMPLE_CONSTITUTION, state: 'template' } as const]) {
      const markup = constitutionCardMarkup(constitution);

      expect(markup).toContain('<p class="ap-spec-constitution-empty">No constitution yet: run <code>/speckit-constitution</code> to write one.</p>');
      expect(markup).not.toContain('ap-spec-principle');
    }
  });
});
