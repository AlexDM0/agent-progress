/**
 * `--hooks` asked for the SubagentStop hook before `update` and `init` wrote it by default; it is accepted and ignored, so that habit is not refused.
 * It can be deleted once agents and people no longer pass it.
 */
export const IGNORED_RETIRED_OPTION_NAMES = ['hooks'] as const;
