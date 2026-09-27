export type ReleaseRefusalReason =
  | 'invalid-request'
  | 'unknown-ticket'
  | 'ticket-not-releasable'
  | 'unknown-branch'
  | 'not-on-main-line'
  | 'main-moved'
  | 'merge-refused'
  | 'git-failed'
  | 'tracker-failed';
