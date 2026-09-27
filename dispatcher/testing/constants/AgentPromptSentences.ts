/** The sentences of the dispatcher's prompts that the fake agents follow, as a real agent's first command depends on them. */
export const AGENT_PROMPT_SENTENCES = {
  /** A builder's prompt carries on past a claim refused as in-progress by it. */
  BUILDER_CARRIES_ON_PAST_ITS_OWN_CLAIM:        'the claim is this run\'s own',
  /**
   * A builder resumes a paused row it carries on past by it. Followed by `--note "<the prompt's claim note>"`, the resumption sets the row's note;
   * without it the row keeps the one it had.
   */
  BUILDER_RESUMES_A_PAUSED_ROW:                 'resume it first with `agent-progress task start <that row>',
  /** A whole-board or single-ticket run takes over another run's paused build by it. */
  BUILDER_TAKES_OVER_A_PAUSED_DISPATCHER_BUILD: 'a hold or a stop left that build paused',
  /** A reviewer's prompt takes a bar left running by it. */
  REVIEWER_TAKES_OVER_A_RUNNING_BAR:            'take it as your bar and add none',
  /** A reviewer's prompt leaves its bar running for the next round by it, when it asks for one. */
  REVIEWER_LEAVES_ITS_BAR_FOR_THE_NEXT_ROUND:   'leave your bar running',
  /** A round-2+ reviewer's prompt skips its `ticket rereview` by it when the bar of its round is already running. */
  REVIEWER_SKIPS_A_REREVIEW_ALREADY_RUN:        'skip the rereview and take that row as your bar',
} as const;
