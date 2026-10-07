/**
 * The Specs tab's spec cards over the shared example repository and a few edited copies of its specs. The cases that matter: every spec has
 * a card, the done ones last; an implementing spec reads its phases done, its stories with priority and their phase's badge, and every
 * file present; a spec before `tasks.md` reads `not cut yet` and its open clarifications; a spec of only `spec.md` mutes every other file,
 * a template copy is marked as one; and no tracker value (a ticket id, tokens, an owner) and no rendered Markdown reach a card.
 */

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import type { SnapshotSpec }                              from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import { deriveSpecSnapshot }                             from '../../../src/lib/spec-snapshot/SpecSnapshotDerivation.ts';
import { scannedExampleSpecKitRepository }                from '../../../src/testing/ScannedExampleSpecKitRepository.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import type { GroupMarkupFormat }                         from '../../@types/GroupMarks.ts';
import { EXAMPLE_PAGE_LIMITS }                            from '../../testing/PageLimitsFixture.ts';
import { SpecCardMarkup }                                 from './SpecCardMarkup.ts';

const EXAMPLE_NOW = new Date('2026-10-06T12:00:00+02:00');

const EXAMPLE_FORMAT: GroupMarkupFormat = { limits: EXAMPLE_PAGE_LIMITS, todayCalendarDate: '2026-10-06', nowEpochMilliseconds: EXAMPLE_NOW.getTime() };

const scratchDirectory = createScratchDirectory('spec-cards');
const EXAMPLE_SNAPSHOT = deriveSpecSnapshot(scannedExampleSpecKitRepository(scratchDirectory), EXAMPLE_NOW);

afterAll(() => removeScratchDirectory(scratchDirectory));

function exampleSpec(folderPrefix: string): SnapshotSpec {
  const spec = EXAMPLE_SNAPSHOT.specs.find((candidate) => candidate.folderName.startsWith(folderPrefix));
  if (spec === undefined) {
    throw new Error(`the example repository has no spec ${folderPrefix}`);
  }
  return spec;
}

function cardOf(spec: SnapshotSpec): string {
  return SpecCardMarkup.specCardsMarkup([spec], EXAMPLE_FORMAT);
}

function fileStatesOf(markup: string): string[] {
  return [...markup.matchAll(/data-file-state="([a-z]+)"[^>]*>([a-z./-]+)/g)].map((match) => `${match[2]}:${match[1]}`);
}

describe('specCardsMarkup', () => {
  test('shows one card per example spec, the done spec 001 last', () => {
    const markup  = SpecCardMarkup.specCardsMarkup(EXAMPLE_SNAPSHOT.specs, EXAMPLE_FORMAT);
    const openers = [...markup.matchAll(/data-open-spec="([^"]+)"/g)].map((match) => match[1]);

    expect(openers).toHaveLength(8);
    expect(openers.at(-1)).toBe('001-customer-login');
  });

  test('002 reads 3 of 6 phases done, three stories P1 to P3 with US1 done, and every file present', () => {
    const markup = cardOf(exampleSpec('002'));

    expect(markup).toContain('<span class="ap-epic-done-mark">3 of 6 phases done</span>');
    expect([...markup.matchAll(/<span class="ap-card-note">(P\d)<\/span>/g)].map((match) => match[1])).toEqual(['P1', 'P2', 'P3']);
    expect(markup).toContain('<span class="ap-ticket-id">US1</span>');
    expect(markup).toMatch(/US1<\/span><span class="ap-epic-ticket-title">[^<]+ <span class="ap-card-note">P1<\/span><\/span><span class="ap-badge" data-state="delivered">Done</);
    expect(fileStatesOf(markup)).toEqual(['spec.md', 'plan.md', 'research.md', 'data-model.md', 'contracts/', 'quickstart.md', 'tasks.md'].map((name) => `${name}:filled`));
    expect(markup).toContain('<div><b>tasks ticked</b><span>18/41</span></div>');
  });

  test('a story opens its tasks.md phase as a work item', () => {
    expect(cardOf(exampleSpec('002'))).toContain('data-open-work-item="002-product-search-p03"');
  });

  test('008 shows its two open clarifications and reads not cut yet', () => {
    const markup = cardOf(exampleSpec('008'));

    expect(markup).toContain('<div><b>open clarifications</b><span>2</span></div>');
    expect(markup).toContain('<span class="ap-epic-done-mark" title="Work items are cut from tasks.md">not cut yet</span>');
    expect(markup).not.toContain('tasks ticked');
  });

  test('a spec of only spec.md mutes every other file', () => {
    const markup = cardOf(exampleSpec('008'));

    expect(fileStatesOf(markup)).toEqual([
      'spec.md:filled', 'plan.md:missing', 'research.md:missing', 'data-model.md:missing', 'contracts/:missing', 'quickstart.md:missing', 'tasks.md:missing',
    ]);
  });

  test('contracts/ counts its files, and a contracts artefact without a count shows the name alone', () => {
    const spec        = exampleSpec('002');
    const withCount   = (fileCount: number | undefined) => spec.artefacts.map((artefact) => {
      if (artefact.kind !== 'contracts') return artefact;
      const { fileCount: _storedCount, ...uncounted } = artefact;
      return fileCount === undefined ? uncounted : { ...uncounted, fileCount };
    });

    expect(cardOf(spec)).toContain('data-file-state="filled">contracts/<span class="ap-spec-file-mark">2</span></li>');
    expect(cardOf({ ...spec, artefacts: withCount(3) })).toContain('data-file-state="filled">contracts/<span class="ap-spec-file-mark">3</span></li>');
    expect(cardOf({ ...spec, artefacts: withCount(undefined) })).toContain('data-file-state="filled">contracts/</li>');
  });

  test('the title is the bare feature name, spec-kit\'s prefix dropped', () => {
    expect(cardOf(exampleSpec('007'))).toContain('Store Pickup');
    expect(cardOf(exampleSpec('007'))).not.toContain('Feature Specification');
  });

  test('a template copy of plan.md is marked as one', () => {
    const spec = exampleSpec('005');
    const markup = cardOf({ ...spec, artefacts: spec.artefacts.map((artefact) => (artefact.kind === 'plan' ? { ...artefact, state: 'template' } : artefact)) });

    expect(markup).toContain('data-file-state="template"');
    expect(markup).toContain('plan.md<span class="ap-spec-file-mark">template</span>');
  });

  test('shows the span from spec.md\'s creation, naming the source only when it is a modification time', () => {
    const spec           = exampleSpec('002');
    const modifiedOnly   = spec.artefacts.map((artefact) => (artefact.kind === 'spec' && artefact.created !== null
      ? { ...artefact, created: { ...artefact.created, source: 'modification-time' } }
      : artefact));

    expect(cardOf(spec)).toMatch(/<b>span<\/b><span title="[^"]+ → still open">[^<(]+ → now/);
    expect(cardOf({ ...spec, artefacts: modifiedOnly })).toContain('(from file modified) → now');
  });

  test('a card carries no tracker value and no rendered Markdown', () => {
    const markup = SpecCardMarkup.specCardsMarkup(EXAMPLE_SNAPSHOT.specs, EXAMPLE_FORMAT);

    expect(markup).not.toMatch(/#\d|tokens|owner|data-row|data-ticket/);
    expect(markup).not.toMatch(/<(p|h\d|em|strong)>/);
  });

  test('a repository with no specs has no cards', () => {
    expect(SpecCardMarkup.specCardsMarkup([], EXAMPLE_FORMAT)).toBe('');
  });
});
