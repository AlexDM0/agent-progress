/**
 * The counts an Airlock decides by (design section 6): when a resolution is read before it lands, when a moving target parks, how many
 * merge-gate fixers a failed merged tree gets, each Airlock agent's call budget, and how much of a failed gate its fixer is shown.
 */
import { DISPATCH_PROTOCOL } from './DispatchProtocol.ts';

export const MERGE_SLOT_LIMITS = {
  RESOLUTION_REVIEW_THRESHOLD_LINES:   150,
  TARGET_MOVED_MERGES_BEFORE_PARKING:  2,
  GROUP_REFRESH_AFTER_MAIN_COMMITS:    30,
  MERGE_FIX_ATTEMPTS:                  1,
  CHECK_OUTPUT_TAIL_LINES:             20,
  RESOLVER_API_CALL_BUDGET:            DISPATCH_PROTOCOL.RESOLVER_API_CALL_BUDGET,
  MERGE_FIXER_API_CALL_BUDGET:         DISPATCH_PROTOCOL.MERGE_FIXER_API_CALL_BUDGET,
  RESOLUTION_REVIEWER_API_CALL_BUDGET: DISPATCH_PROTOCOL.RESOLUTION_REVIEWER_API_CALL_BUDGET,
} as const;

export type MergeSlotLimits = { readonly [Name in keyof typeof MERGE_SLOT_LIMITS]: number };
