/** The render service's state for one invocation, created by the composition root: the page bundle and the configured Marked, each built once. */
import { createMarkdownRenderer, type MarkdownRenderer } from './MarkdownRenderer.ts';
import { createPageBundler, type PageBundler }           from './PageBundler.ts';

export interface RenderState {
  pageBundler:      PageBundler;
  markdownRenderer: MarkdownRenderer;
}

export function createRenderState(): RenderState {
  return { pageBundler: createPageBundler(), markdownRenderer: createMarkdownRenderer() };
}
