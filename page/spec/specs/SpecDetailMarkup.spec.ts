/**
 * A spec's detail over the shared example repository. The cases that matter: it holds what the card holds; it lists the tasks ticked per
 * `tasks.md` phase, read as text in phase order; it shows each stage's dates with their file and source, an open stage as still open; and it
 * names the folder's path.
 */

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import { deriveSpecSnapshot }                             from '../../../src/lib/spec-snapshot/SpecSnapshotDerivation.ts';
import { scannedExampleSpecKitRepository }                from '../../../src/testing/ScannedExampleSpecKitRepository.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import type { GroupMarkupFormat }                         from '../../@types/GroupMarks.ts';
import { EXAMPLE_PAGE_LIMITS }                            from '../../testing/PageLimitsFixture.ts';
import { specDetailMarkup }                               from './SpecDetailMarkup.ts';

const EXAMPLE_NOW = new Date('2026-10-06T12:00:00+02:00');

const EXAMPLE_FORMAT: GroupMarkupFormat = { limits: EXAMPLE_PAGE_LIMITS, todayCalendarDate: '2026-10-06', nowEpochMilliseconds: EXAMPLE_NOW.getTime() };

const scratchDirectory = createScratchDirectory('spec-detail');
const EXAMPLE_SNAPSHOT = deriveSpecSnapshot(scannedExampleSpecKitRepository(scratchDirectory, EXAMPLE_NOW), EXAMPLE_NOW);

afterAll(() => removeScratchDirectory(scratchDirectory));

const PRODUCT_SEARCH = EXAMPLE_SNAPSHOT.specs.find((spec) => spec.folderName === '002-product-search');

function textOf(markup: string): string {
  return markup.replaceAll(/<[^>]+>/g, '');
}

describe('specDetailMarkup', () => {
  if (PRODUCT_SEARCH === undefined) {
    throw new Error('the example repository has no 002-product-search');
  }
  const markup = specDetailMarkup(PRODUCT_SEARCH, EXAMPLE_FORMAT);

  test('lists the tasks ticked per tasks.md phase as text, in phase order', () => {
    const phases = [...markup.matchAll(/<li data-state="[a-z-]+"><span class="ap-spec-task-phase-name">[\s\S]*?<\/li>/g)].map((match) => textOf(match[0]));

    expect(phases).toEqual(['Setup  3/3', 'Foundational  6/6', 'US1  9/9', 'US2  0/11', 'US3  0/8', 'Polish  0/4']);
  });

  test('shows the three stages\' dates with their file and source, the open one as still open', () => {
    const stages = [...markup.matchAll(/<li><span class="ap-spec-stage-name">[\s\S]*?<\/li>/g)].map((match) => textOf(match[0]));

    expect(stages).toHaveLength(3);
    expect(stages[0]).toMatch(/^Specify .+ \(spec\.md, file created\) → .+ \(plan\.md, file created\)$/);
    expect(stages[1]).toMatch(/^Plan .+ \(plan\.md, file created\) → .+ \(tasks\.md, file created\)$/);
    expect(stages[2]).toMatch(/^Implement .+ \(tasks\.md, file created\) → still open$/);
  });

  test('holds the card\'s parts and the folder\'s path', () => {
    expect(markup).toContain('<div><b>folder</b><code>specs/002-product-search/</code></div>');
    expect(markup).toContain('class="ap-spec-steps" data-size="full"');
    expect(markup).toContain('<ul class="ap-spec-files"');
    expect(markup).toContain('<ul class="ap-epic-tickets">');
    expect(markup).toContain('<div class="ap-epic-progress"');
    expect(markup).toContain('<span class="ap-detail-type">3 of 6 phases done</span>');
  });

  test('shows the bare title and contracts/ with its file count', () => {
    expect(markup).toContain('Product Search');
    expect(markup).not.toContain('Feature Specification');
    expect(markup).toContain('contracts/<span class="ap-spec-file-mark">2</span>');
  });
});
