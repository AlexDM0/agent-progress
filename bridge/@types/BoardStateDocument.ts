/** The fields of the Overseer's `BoardState` (`GET /api/state`, the `board` event) the shell reads; each view adds the fields it uses. */
export interface IdentifiedRecord {
  readonly id: string;
}

export type OverseerRuntimeState = 'serving' | 'held-by-install-change' | 'passing-baton' | 'down';

/** The last Baton pass that failed while this Overseer kept driving. */
export interface BatonPassWarningDocument {
  readonly successorCodeVersion: string;
  readonly step:                 string;
  readonly error:                string;
}

export interface OverseerFactsDocument {
  readonly state:             OverseerRuntimeState;
  readonly paused:            boolean;
  readonly codeVersion:       string;
  readonly batonPassWarning?: BatonPassWarningDocument | null;
}

/** A notice the Overseer derives each pass: its `kind` and the facts that kind carries. */
export interface NoticeDocument {
  readonly kind:           string;
  readonly [fact: string]: unknown;
}

export interface ConcurrencyDocument {
  readonly limit:          number;
  readonly agentsInFlight: number;
}

export interface UsageDocument {
  readonly resetsAt: string | null;
  readonly window:   string | null;
}

export interface TaskDocument {
  readonly status:    string;
  readonly end:       string | null;
  readonly tokens?:   number | null;
  readonly reviewOf?: string;
}

export interface PageTicketDocument {
  readonly id:          string;
  readonly title:       string;
  readonly status:      string;
  readonly updated:     string;
  readonly delivered:   string | null;
  readonly abandonedAt: string | null;
}

export interface EpicRollupDocument {
  readonly key:                 string;
  readonly title:               string;
  readonly slot:                number;
  readonly ticketIds:           readonly string[];
  readonly ticketCountByStatus: Readonly<Record<string, number>>;
  readonly tokens:              number;
  readonly span:                { readonly start: string; readonly end: string | null } | null;
}

/** The page payload the render service assembles, as far as the Bridge's views read it. */
export interface PageDocument {
  readonly payload: {
    readonly progress:         { readonly tasks: readonly TaskDocument[] };
    readonly epicDescriptions: readonly { readonly key: string; readonly descriptionHtml: string }[];
    readonly boardFacts:       {
      readonly epics:   readonly EpicRollupDocument[];
      readonly tickets: readonly { readonly ticketId: string; readonly displayState: string }[];
    };
  };
  readonly tickets: readonly PageTicketDocument[];
}

export interface MergeQueueEntryDocument {
  readonly ticketId:        string;
  readonly priority:        string;
  readonly againstTarget:   'clean' | 'conflicting' | 'prediction-failed';
  readonly conflictedFiles: readonly string[] | null;
  readonly conflictsCaused: number;
}

export interface MergeTargetDocument {
  readonly target:                 string;
  readonly holder:                 { readonly jobId: string; readonly ticketIds: readonly string[]; readonly phase: string } | null;
  readonly order:                  readonly MergeQueueEntryDocument[];
  readonly pairwiseConflicts:      readonly (readonly [string, string])[];
  readonly targetMovedDecisionIds: readonly string[];
}

export interface MergeQueueDocument {
  readonly targets: readonly MergeTargetDocument[];
}

/** The views' slices are optional, so a board from an older Overseer, or a spec's, shows them empty rather than failing. */
export interface BoardStateDocument {
  readonly project:      string;
  readonly jobs:         readonly IdentifiedRecord[];
  readonly decisions:    readonly IdentifiedRecord[];
  readonly incidents:    readonly IdentifiedRecord[];
  readonly overseer:     OverseerFactsDocument;
  readonly usage:        unknown;
  readonly notices?:     readonly NoticeDocument[];
  readonly concurrency?: ConcurrencyDocument;
  readonly page?:        PageDocument;
  readonly mergeQueue?:  MergeQueueDocument;
}

/** `GET /api/identity`: what the Bridge needs to key its preferences and to notice new code behind the same port. */
export interface OverseerIdentity {
  readonly trackerId:   string;
  readonly project:     string;
  readonly codeVersion: string;
}
