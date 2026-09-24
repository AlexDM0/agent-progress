/**
 * Which options take the next argument as their value, across every command this CLI has. A bare
 * switch must never be listed here, or `agent-progress task add "Review pass" --start` drops the name.
 */

export const OPTION_NAMES_WITH_VALUES = new Set<string>([
  'project',
  'root',
  'owner',
  'note',
  'name',
  'ticket',
  'review-of',
  'status',
  'at',
  'tokens',
  'type',
  'priority',
  'group',
  'depends-on',
  'body',
  'body-file',
  'branch',
  'commit',
  'reason',
  'from',
  'to',
  'tick',
  'since',
  'transcripts',
  'rebased-from',
  'main',
  'worktree',
  'run',
]);
