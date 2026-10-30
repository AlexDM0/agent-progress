/** The render service's state for one invocation, created by the composition root: the configured Marked, built once. */
import { createMarkdownRenderer, type MarkdownRenderer } from './MarkdownRenderer.ts';

export interface RenderState {
  markdownRenderer: MarkdownRenderer;
}

export function createRenderState(): RenderState {
  return { markdownRenderer: createMarkdownRenderer() };
}
