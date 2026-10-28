/**
 * One control a person, a UI or a relayed session can issue, as data: the only shape `src/services/control/ControlService.ts` applies.
 * Every value is plain JSON, so a command survives a relay file or an HTTP body unchanged; a body or request file is read before the
 * command is built, which carries its text. A ticket is named as it was written (`3`, `003`, `#3`), resolved inside the hold.
 */
import type { DecisionAnswerForm }                 from '../../lib/tracker-model/@types/Decision.ts';
import type { DraftNoteKind, DraftQuestionAsking } from '../../lib/tracker-model/@types/Draft.ts';
import type { JobStopMode }                        from '../../lib/tracker-model/@types/Job.ts';
import type {
  AgentEffort,
  AgentModel,
  FindingRoute,
  TicketPriority,
  TicketSize,
  TicketType
} from '../../lib/tracker-model/@types/Ticket.ts';

export type ListEdit = 'replace' | 'add' | 'remove';

/** What the runner stamps on a ticket its relay filed: the filing job, from the relay folder's job record, and a worker finding's route. */
export interface FilingAdmission {
  filedByJob:    string;
  findingRoute?: FindingRoute;
}

export type ControlCommand =
  | {
    kind:          'ticket-add';
    title:         string;
    type:          TicketType;
    priority?:     TicketPriority;
    size?:         TicketSize;
    model?:        AgentModel;
    effort?:       AgentEffort;
    group?:        string;
    dependsOn:     string[];
    epics:         string[];
    network:       string[];
    introducedBy:  string | null;
    foundInReview: string | null;
    /** Null files the ticket template's body. */
    bodyText:      string | null;
    /** `--needs-user`, relay-only: a worker's finding only User can settle. Refused `worker-filing-flag` anywhere else. */
    needsUser?:    true;
    /** Set only by `RoleCommandPolicy`'s admission of a relayed filing, never by a request: a request carrying it is refused. */
    admission?:    FilingAdmission;
  }
  | {
    kind:              'ticket-edit';
    ticketReference:   string;
    title?:            string;
    /** Null leaves the body as it is. */
    bodyText:          string | null;
    appendsBody:       boolean;
    allowsPastPending: boolean;
  }
  | { kind: 'ticket-depends'; ticketReference: string; edit: ListEdit; ticketIds: string[] }
  | { kind: 'ticket-priority'; ticketReference: string; priority: TicketPriority }
  | { kind: 'ticket-epic'; ticketReference: string; edit: ListEdit; epicKeys: string[] }
  | {
    kind:            'ticket-abandon';
    ticketReference: string;
    reason?:         string;
    branch?:         string;
    commit?:         string;
    tokens?:         number;
  }
  | {
    kind:             'ticket-ready';
    ticketReferences: string[];
    /** The `findings-delivered` incident an orchestrator readies a finding under; absent when User readies. */
    incidentId?:      string;
  }
  | { kind: 'ticket-network'; ticketReference: string; domains: string[] }
  | { kind: 'ticket-hold'; ticketReference: string; reason: string }
  | { kind: 'ticket-unhold'; ticketReference: string }
  | { kind: 'epic-add'; key: string; title: string; bodyText: string }
  | { kind: 'draft-open'; title: string; request: string; owner: string }
  | { kind: 'draft-claim'; draftId: string; owner: string; forces: boolean }
  | { kind: 'draft-release'; draftId: string }
  | { kind: 'draft-note'; draftId: string; text: string; noteKind: DraftNoteKind }
  | { kind: 'draft-ask'; draftId: string; asking: DraftQuestionAsking }
  | { kind: 'draft-answer'; draftId: string; questionId: string; answer: string }
  | { kind: 'draft-drop'; draftId: string; itemId: string }
  | { kind: 'draft-close'; draftId: string; ticketReferences: string[] }
  | { kind: 'draft-abandon'; draftId: string; reason: string }
  | { kind: 'decision-answer'; decisionId: string; answer: DecisionAnswerForm }
  | { kind: 'runner-pause' }
  | { kind: 'runner-resume' }
  /** Runtime only: sent to the live runner, which stops; the board is never changed by it. */
  | { kind: 'runner-stop'; now: boolean }
  /** Runtime only: sent to the live runner, which hands the board to a successor on the code on disk. */
  | { kind: 'runner-restart'; now: boolean }
  | { kind: 'job-stop'; jobId: string; mode: Exclude<JobStopMode, 'fresh'> }
  | { kind: 'job-fresh'; jobId: string }
  | { kind: 'job-stop-all'; mode: Exclude<JobStopMode, 'fresh'> }
  | { kind: 'job-message'; jobId: string; text: string }
  | { kind: 'intake-start'; text: string }
  /** Relayed by a product owner without `jobId`: the role policy stamps its own job, from the relay folder. */
  | { kind: 'intake-close'; jobId?: string; proposedDraftSets: string[][] }
  | { kind: 'concurrency-set'; limit: number }
  | { kind: 'checks-set'; command: string | null; restamps: boolean }
  | { kind: 'install-command-set'; command: string }
  | { kind: 'checks-definition-files-set'; patterns: string[] | null }
  | { kind: 'gate-key-command-set'; command: string | null };

export type ControlCommandKind = ControlCommand['kind'];

export type ControlCommandOf<Kind extends ControlCommandKind> = Extract<ControlCommand, { kind: Kind }>;
