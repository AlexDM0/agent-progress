/** The Workflow arguments the dispatcher takes: the ones it refuses to run without, in the order it checks them, and the summary its refusals quote. */
export const DISPATCH_ARGUMENTS = {
  REQUIRED_NAMES:     ['mainCheckout', 'mainLine', 'checkCommand'],
  SUMMARY_TEXT:       '{ mainCheckout, mainLine, checkCommand, installCommand?, includeLowPriority?, ticketIds?, readyTickets?, group? }',
  // A group's name becomes part of a branch name and a worktree path, so it is one word of the characters a git branch takes safely.
  GROUP_NAME_PATTERN: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
} as const;
