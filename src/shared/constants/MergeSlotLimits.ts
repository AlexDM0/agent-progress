/** The counts a merge slot decides by (design section 6): when a resolution is read before it lands, and when a moving target parks. */
import { DISPATCH_PROTOCOL } from './DispatchProtocol.ts';

export const MERGE_SLOT_LIMITS = {
  RESOLUTION_REVIEW_THRESHOLD_LINES:  150,
  TARGET_MOVED_MERGES_BEFORE_PARKING: 2,
  RESOLVER_API_CALL_BUDGET:           DISPATCH_PROTOCOL.RESOLVER_API_CALL_BUDGET,
} as const;

export type MergeSlotLimits = { readonly [Name in keyof typeof MERGE_SLOT_LIMITS]: number };
