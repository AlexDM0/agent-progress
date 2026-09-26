/**
 * The numbers the dispatcher's prompts and the installed agent brief both state, and the path of the installed brief both name. It imports
 * nothing, so the dispatcher's project compiles it.
 */
export const DISPATCH_PROTOCOL = {
  BUILDER_API_CALL_BUDGET:        150,
  REVIEWER_API_CALL_BUDGET:       75,
  REWORK_ROUND_THRESHOLD_LINES:   750,
  AGENT_BRIEF_PATH_IN_REPOSITORY: '.agent-progress/agent-brief.md',
} as const;
