/**
 * The spec view rendered end to end over the example spec-kit repository. What matters: it writes exactly `progress-spec.json` and
 * `progress-spec.html`, creating the tracker folder when there is none and leaving every tracker file byte for byte when there is; the page
 * carries the design's style block once, the tracker page's limits and the project name in its heading; only a spec render builds the spec
 * bundle, never a tracker render; and a failed bundle still writes the banner-only page.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import { resourceFilePathOf }                             from '../../shared/ResourceFilePath.ts';
import { islandContentsOf }                               from '../../testing/RenderedIslandText.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { writeExampleSpecKitRepository }                  from '../../testing/SpecKitRepositoryFixtures.ts';
import { renderDashboardDocument }                        from './DashboardDocument.ts';
import { designStylesOf }                                 from './DesignStyleExtraction.ts';
import type { PageBundleOutcome, PageBundler }            from './PageBundler.ts';
import type { RenderState }                               from './RenderState.ts';
import { createRenderState }                              from './RenderState.ts';
import { renderSpecPage }                                 from './SpecPageRendering.ts';

const GENERATED_AT = new Date('2026-10-07T09:00:00Z');

const TRACKER_FILE_CONTENTS: Readonly<Record<string, string>> = {
  'progress.json': '{ "version": "held byte for byte" }\n',
  'log.jsonl':     '{"at":"2026-10-07T09:00:00+02:00"}\n',
  'progress.html': '<!doctype html><title>held byte for byte</title>\n',
  'version.json':  '{ "installVersion": 1 }\n',
};

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function exampleRepository(): { specKitRootDirectory: string; trackerDirectory: string } {
  const specKitRootDirectory = createScratchDirectory('spec-page');
  scratchDirectories.push(specKitRootDirectory);
  writeExampleSpecKitRepository(specKitRootDirectory, { datesFilesInThePast: true });
  return { specKitRootDirectory, trackerDirectory: join(specKitRootDirectory, '.agent-progress') };
}

function countingBundler(outcome: PageBundleOutcome): PageBundler & { buildCount(): number } {
  let calls = 0;
  return {
    bundlePageScript(): Promise<PageBundleOutcome> {
      calls += 1;
      return Promise.resolve(outcome);
    },
    buildCount: () => calls,
  };
}

function firstDesignRuleOf(): string {
  const designStyles = designStylesOf(readFileSync(resourceFilePathOf('template.html'), 'utf8'), 'resources/template.html');
  return designStyles.slice(0, designStyles.indexOf('}') + 1);
}

function occurrencesOf(text: string, searched: string): number {
  return text.split(searched).length - 1;
}

const renderState = createRenderState();

describe('renderSpecPage', () => {
  test('with no tracker there, creates the tracker folder holding exactly progress-spec.json and progress-spec.html', async () => {
    const repository = exampleRepository();
    const outcome    = await renderSpecPage({ ...repository, generatedAt: GENERATED_AT }, renderState);

    expect(outcome).toEqual({
      verdict:           'rendered',
      snapshotFilePath:  join(repository.trackerDirectory, 'progress-spec.json'),
      pageFilePath:      join(repository.trackerDirectory, 'progress-spec.html'),
      pageScriptFailure: null,
    });
    expect(readdirSync(repository.trackerDirectory).sort()).toEqual(['progress-spec.html', 'progress-spec.json']);
  });

  test('with a tracker there, leaves progress.json, log.jsonl, progress.html and version.json byte-identical', async () => {
    const repository = exampleRepository();
    mkdirSync(repository.trackerDirectory);
    for (const [fileName, contents] of Object.entries(TRACKER_FILE_CONTENTS)) writeFileSync(join(repository.trackerDirectory, fileName), contents);

    await renderSpecPage({ ...repository, generatedAt: GENERATED_AT }, renderState);

    for (const [fileName, contents] of Object.entries(TRACKER_FILE_CONTENTS)) {
      expect(readFileSync(join(repository.trackerDirectory, fileName), 'utf8')).toBe(contents);
    }
    expect(readdirSync(repository.trackerDirectory).sort()).toEqual([...Object.keys(TRACKER_FILE_CONTENTS), 'progress-spec.html', 'progress-spec.json'].sort());
  });

  test('holds the design’s style block exactly once, which the spec template itself does not carry', async () => {
    const repository = exampleRepository();
    await renderSpecPage({ ...repository, generatedAt: GENERATED_AT }, renderState);
    const page       = readFileSync(join(repository.trackerDirectory, 'progress-spec.html'), 'utf8');
    const firstRule  = firstDesignRuleOf();

    expect(occurrencesOf(page, firstRule)).toBe(1);
    expect(occurrencesOf(readFileSync(resourceFilePathOf('spec-template.html'), 'utf8'), firstRule)).toBe(0);
  });

  test('writes the stored snapshot’s project name into the heading', async () => {
    const repository = exampleRepository();
    await renderSpecPage({ ...repository, generatedAt: GENERATED_AT }, renderState);
    const page       = readFileSync(join(repository.trackerDirectory, 'progress-spec.html'), 'utf8');
    const storedFile = JSON.parse(readFileSync(join(repository.trackerDirectory, 'progress-spec.json'), 'utf8')) as { project: string };

    expect(page).toContain(`<h1 class="ap-title" id="ap-project">${storedFile.project}</h1>`);
  });

  test('writes the snapshot it stored and the tracker page’s limits into its island', async () => {
    const repository    = exampleRepository();
    await renderSpecPage({ ...repository, generatedAt: GENERATED_AT }, renderState);
    const specIsland    = islandContentsOf(readFileSync(join(repository.trackerDirectory, 'progress-spec.html'), 'utf8'), 'ap-spec-data');
    const storedFile    = JSON.parse(readFileSync(join(repository.trackerDirectory, 'progress-spec.json'), 'utf8')) as Record<string, unknown>;
    const trackerPage   = await renderDashboardDocument({
      progress: {
        trackerId: 'tracker-for-the-limits', project: 'Example Agency', startedAt: '2026-10-07T09:00:00+02:00', nextTaskId: 1, view: { kind: 'auto' }, tasks: []
      },
      tickets:     [],
      epics:       [],
      logRecords:  [],
      generatedAt: GENERATED_AT,
    }, renderState);
    const trackerIsland = islandContentsOf(trackerPage.document, 'ap-progress-data') as { limits: unknown };
    const { version: _version, ...storedSnapshot } = storedFile;

    expect(specIsland).toEqual({ snapshot: storedSnapshot, limits: trackerIsland.limits });
  });

  test('builds the spec bundle, and a tracker page render never does', async () => {
    const pageBundler     = countingBundler({ verdict: 'built', script: 'window.trackerPage = 1;' });
    const specPageBundler = countingBundler({ verdict: 'built', script: 'window.specPage = 1;' });
    const countingState: RenderState = { pageBundler, specPageBundler, markdownRenderer: renderState.markdownRenderer };

    await renderDashboardDocument({
      progress: {
        trackerId: 'tracker-for-the-bundles', project: 'Example Agency', startedAt: '2026-10-07T09:00:00+02:00', nextTaskId: 1, view: { kind: 'auto' }, tasks: []
      },
      tickets:     [],
      epics:       [],
      logRecords:  [],
      generatedAt: GENERATED_AT,
    }, countingState);

    expect([pageBundler.buildCount(), specPageBundler.buildCount()]).toEqual([1, 0]);

    await renderSpecPage({ ...exampleRepository(), generatedAt: GENERATED_AT }, countingState);

    expect([pageBundler.buildCount(), specPageBundler.buildCount()]).toEqual([1, 1]);
  });

  test('writes the banner-only page when the spec bundle failed, and says why', async () => {
    const repository  = exampleRepository();
    const failedState: RenderState = { ...renderState, specPageBundler: countingBundler({ verdict: 'failed', reason: 'the example bundle failed' }) };
    const outcome     = await renderSpecPage({ ...repository, generatedAt: GENERATED_AT }, failedState);
    const page        = readFileSync(join(repository.trackerDirectory, 'progress-spec.html'), 'utf8');

    expect(outcome.verdict === 'rendered' ? outcome.pageScriptFailure : null).toBe('the example bundle failed');
    expect(page).toContain('"the example bundle failed"');
    expect(page).toContain('getElementById("ap-error")');
  });
});
