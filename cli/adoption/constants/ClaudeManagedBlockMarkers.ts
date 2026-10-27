import type { ManagedBlockMarkers }         from '../../../src/lib/claude-code/ClaudeInstructions.ts';
import { PRODUCT_NAMES, type ProductNames } from '../../../src/shared/constants/ProductNames.ts';

/** Neither marker may contain the other: `src/lib/claude-code/ClaudeInstructions.ts` finds the end by searching forward from the start. */
export function claudeManagedBlockMarkersFor({ PROGRAM }: Pick<ProductNames, 'PROGRAM'>): ManagedBlockMarkers {
  return {
    start: `<!-- ${PROGRAM}:managed:start -->`,
    end:   `<!-- ${PROGRAM}:managed:end -->`,
  };
}

export const CLAUDE_MANAGED_BLOCK_MARKERS: ManagedBlockMarkers = claudeManagedBlockMarkersFor(PRODUCT_NAMES);
