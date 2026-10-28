/** A role's permissions as neutral data, every path absolute; each adapter renders its own settings and flags from it. */
export interface WorkerProfile {
  readonly writableRoots:          readonly string[];
  readonly deniedWritableRoots:    readonly string[];
  readonly deniedReadableRoots:    readonly string[];
  readonly bashNetworkDomains:     readonly string[];
  readonly webNetworkDomains:      readonly string[] | 'any' | 'none';
  /** The one folder outside the working directory the session may write. */
  readonly relayDirectory:         string;
  /** Argv prefixes, such as `['git', 'commit']`. */
  readonly allowedCommandPrefixes: readonly (readonly string[])[];
  readonly deniedCommandPrefixes:  readonly (readonly string[])[];
  readonly askUser:                boolean;
  readonly skills:                 boolean;
  readonly subagents:              readonly AgentDefinition[];
  readonly attribution:            'none';
  /** The repository folder: instruction files in the folders above it never reach the session. */
  readonly instructionsRoot:       string;
  /** The `core.hooksPath` the session's git runs with, whose `commit-msg` refuses an attribution trailer. */
  readonly gitHooksDirectory:      string;
  readonly commitSigning:          CommitSigning;
  /** The guard run before every Bash and WebFetch call of a role with network domains; `null` renders none. */
  readonly networkDomainGuard:     NetworkDomainGuard | null;
}

/** A command that denies a call naming a domain outside `allowedDomains`; its argv already carries the list, and it is run as given. */
export interface NetworkDomainGuard {
  readonly allowedDomains: readonly string[];
  readonly commandArgv:    readonly string[];
}

export interface AgentDefinition {
  readonly name:     string;
  readonly model:    string;
  readonly effort:   'low' | 'medium';
  readonly readOnly: boolean;
}

/** The Unix sockets a signing agent needs, with its key folder readable and its private keys read-denied; or commits go unsigned. */
export type CommitSigning =
  | { readonly kind: 'agent-sockets'; readonly sockets: readonly string[] }
  | { readonly kind: 'unsigned' };
