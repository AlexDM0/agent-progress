/**
 * That the page entry bundles from wherever the binary is run and the result is safe to inline in a `<script>`.
 */

import { describe, expect, test } from 'bun:test';
import { createPageBundler }      from './PageBundler.ts';
import { PageScriptTextUtil }     from './utils/PageScriptTextUtil.ts';

describe('createPageBundler', () => {
  test('bundles the page entry point into a non-empty script', async () => {
    const outcome = await createPageBundler().bundlePageScript();

    expect(outcome.verdict).toBe('built');
    expect(outcome.verdict === 'built' && outcome.script.length).toBeGreaterThan(0);
  });

  test('produces a script that contains nothing a browser would read as the end of a script element', async () => {
    const outcome = await createPageBundler().bundlePageScript();

    expect(outcome.verdict).toBe('built');
    expect(outcome.verdict === 'built' && /<\/script/i.test(outcome.script)).toBe(false);
  });

  test('carries the page entry point, not an empty module', async () => {
    const outcome = await createPageBundler().bundlePageScript();

    expect(outcome.verdict === 'built' && outcome.script.includes('ap-progress-data')).toBe(true);
  });

  test('hands a second call the very outcome of the first, without building again', async () => {
    const pageBundler = createPageBundler();
    const first       = await pageBundler.bundlePageScript();
    const second      = await pageBundler.bundlePageScript();

    expect(second).toBe(first);
  });

  test('hands two callers asking at the same time the very same outcome, from one build', async () => {
    const pageBundler     = createPageBundler();
    const [first, second] = await Promise.all([pageBundler.bundlePageScript(), pageBundler.bundlePageScript()]);

    expect(second).toBe(first);
  });

  test('gives each bundler a build of its own, so no bundle outlives the invocation that made it', async () => {
    const first  = await createPageBundler().bundlePageScript();
    const second = await createPageBundler().bundlePageScript();

    expect(second).not.toBe(first);
    expect(first.verdict === 'built' && second.verdict === 'built' && first.script === second.script).toBe(true);
  });
});

describe('the bundled page script', () => {
  test('carries no HTML comment opener', async () => {
    const outcome = await createPageBundler().bundlePageScript();

    expect(outcome.verdict === 'built' && PageScriptTextUtil.scriptWouldOpenAnHtmlComment(outcome.script)).toBe(false);
  });
});
