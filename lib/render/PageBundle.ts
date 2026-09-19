/**
 * Bundles `lib/render/page/GanttPage.ts` into the single minified script `lib/render/Template.ts` inlines, resolved from `import.meta.dir`
 * because the binary is installed with `bun link` and run from whatever repository the orchestrator is in.
 */

import { join } from 'node:path';

type PageBundleOutcome =
  | { verdict: 'built'; script: string }
  | { verdict: 'failed'; reason: string };

/** An HTML parser ends a `<script>` at the first `</script`, inside a JavaScript string literal or not, so every one of them is escaped. */
export function withScriptEndEscaped(script: string): string {
  return script.replace(/<\/(script)/gi, '<\\/$1');
}

/** A `<!--` inside a `<script>` makes `</script>` stop closing the element, and it cannot be escaped in place, so such a bundle fails instead. */
export function scriptWouldOpenAnHtmlComment(script: string): boolean {
  return script.includes('<!--');
}

let pendingBundle: Promise<PageBundleOutcome> | null = null;

export const PageBundleBookkeeping = {
  buildCount: 0,
  forgetMemoisedBundle(): void {
    pendingBundle                    = null;
    PageBundleBookkeeping.buildCount = 0;
  },
};

async function buildPageScript(): Promise<PageBundleOutcome> {
  PageBundleBookkeeping.buildCount += 1;
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, 'page', 'GanttPage.ts')],
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
  const script = withScriptEndEscaped(await firstOutput.text());
  if (scriptWouldOpenAnHtmlComment(script)) {
    return { verdict: 'failed', reason: 'the page bundle contains an HTML comment opener, which would swallow the script element' };
  }
  return { verdict: 'built', script };
}

/** A failure is returned, never thrown, so a command that has already written `progress.json` can still write a page. */
export function bundlePageScript(): Promise<PageBundleOutcome> {
  pendingBundle ??= buildPageScript();
  return pendingBundle;
}
