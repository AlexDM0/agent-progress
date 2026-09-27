import type { ManagedBlockMarkers } from '../../../src/lib/claude-code/ClaudeInstructions.ts';

/** Neither marker may contain the other: `src/lib/claude-code/ClaudeInstructions.ts` finds the end by searching forward from the start. */
export const CLAUDE_MANAGED_BLOCK_MARKERS: ManagedBlockMarkers = {
  start: '<!-- agent-progress:managed:start -->',
  end:   '<!-- agent-progress:managed:end -->',
};
