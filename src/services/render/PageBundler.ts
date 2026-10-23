/**
 * Bundles a page entry, such as `page/PageStart.ts`, into the single minified script its template fill inlines,
 * resolved from `import.meta.dir` because the binary is installed with `bun link` and run from whatever repository the orchestrator is in.
 */

import { join } from 'node:path';

import { PageScriptTextUtil } from './utils/PageScriptTextUtil.ts';

export type PageBundleOutcome =
  | { verdict: 'built'; script: string }
  | { verdict: 'failed'; reason: string };

export interface PageBundler {
  /** A failure is returned, never thrown, so a command that has already written `progress.json` can still write a page. */
  bundlePageScript(): Promise<PageBundleOutcome>;
}

async function buildPageScript(entryPointSegments: readonly string[]): Promise<PageBundleOutcome> {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, '..', '..', '..', ...entryPointSegments)],
    target:      'browser',
    minify:      true,
    throw:       false,
  });
  if (!result.success) {
    return { verdict: 'failed', reason: result.logs.map((message) => String(message)).join('; ') };
  }
  const [firstOutput] = result.outputs;
  if (firstOutput === undefined) {
    return { verdict: 'failed', reason: 'the page bundle succeeded but produced no output file' };
  }
  const script = PageScriptTextUtil.withScriptEndEscaped(await firstOutput.text());
  if (PageScriptTextUtil.scriptWouldOpenAnHtmlComment(script)) {
    return { verdict: 'failed', reason: 'the page bundle contains an HTML comment opener, which would swallow the script element' };
  }
  return { verdict: 'built', script };
}

/**
 * Bundles the entry at `entryPointSegments`, path segments from the repository root such as `PAGE_ENTRY_POINTS.TRACKER`. Builds on the first
 * call and hands every later or concurrent caller that same promise, so one bundler builds its page script once, and never before it is asked.
 */
export function createPageBundler(entryPointSegments: readonly string[]): PageBundler {
  let firstBuild: Promise<PageBundleOutcome> | null = null;
  return {
    bundlePageScript(): Promise<PageBundleOutcome> {
      firstBuild ??= buildPageScript(entryPointSegments);
      return firstBuild;
    },
  };
}
