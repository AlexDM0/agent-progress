/**
 * The call budgets and rework threshold the Overseer's job prompts state, the brief paths, and the agent type the retired worker
 * definition was named for, which `update` removes by that name. It imports only the product names.
 */
import { PRODUCT_NAMES } from './ProductNames.ts';

export const DISPATCH_PROTOCOL = {
  BUILDER_API_CALL_BUDGET:             150,
  REVIEWER_API_CALL_BUDGET:            75,
  REWORK_ROUND_THRESHOLD_LINES:        750,
  // The airlock roles: none may ask, so each is bounded by its own count, the resolution reviewer by half a review.
  RESOLVER_API_CALL_BUDGET:            75,
  MERGE_FIXER_API_CALL_BUDGET:         75,
  RESOLUTION_REVIEWER_API_CALL_BUDGET: 37,
  AGENT_BRIEF_PATH_IN_REPOSITORY:      `${PRODUCT_NAMES.DATA_FOLDER}/agent-brief.md`,
  BUILDER_BRIEF_PATH_IN_REPOSITORY:    `${PRODUCT_NAMES.DATA_FOLDER}/builder-brief.md`,
  REVIEW_BRIEF_PATH_IN_REPOSITORY:     `${PRODUCT_NAMES.DATA_FOLDER}/review-brief.md`,
  WORKER_AGENT_TYPE:                   `${PRODUCT_NAMES.PROGRAM}-worker`,
} as const;
