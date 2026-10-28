/** Why the runner refused a relayed command under the job's role, as `RoleCommandPolicy.verdictOf` decides and a relay reply carries. */
export type RoleCommandRefusalReason =
  | 'relay-identity-mismatch'
  | 'command-not-allowed-for-role'
  | 'worker-filing-flag'
  | 'worker-filing-limit'
  | 'not-own-draft'
  | 'incident-move-not-allowed'
  | 'finding-not-listed';
