/**
 * The render service's state for one invocation, created by the composition root: the tracker page bundle and the configured Marked, each
 * built once, and the bundle only when the page is rendered.
 */
import { createMarkdownRenderer, type MarkdownRenderer } from './MarkdownRenderer.ts';
import { createPageBundler, type PageBundler }           from './PageBundler.ts';
import { PAGE_ENTRY_POINTS }                             from './constants/PageEntryPoints.ts';

export interface RenderState {
  pageBundler:      PageBundler;
  markdownRenderer: MarkdownRenderer;
}

export function createRenderState(): RenderState {
  return {
    pageBundler:      createPageBundler(PAGE_ENTRY_POINTS.TRACKER),
    markdownRenderer: createMarkdownRenderer(),
  };
}
