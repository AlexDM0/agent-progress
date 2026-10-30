/** Why the Overseer refused a relayed command under the job's role, as `Bouncer.verdictOf` decides and a Hatch reply carries. */
export type RoleCommandRefusalReason =
  | 'hatch-identity-mismatch'
  | 'command-not-allowed-for-role'
  | 'worker-filing-flag'
  | 'worker-filing-limit'
  | 'not-own-draft'
  | 'incident-move-not-allowed'
  | 'incident-target-mismatch'
  | 'finding-not-listed';
