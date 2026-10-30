/**
 * The fields of the Overseer's `BoardState` the Questions, Assistant and Intake views read: open decisions and incidents, the session
 * jobs, the tickets, the notices, and `questionHistory`, the log records a settled decision, incident or ended session leaves behind.
 * Written structurally here, since the Bridge's project compiles no tracker-model file.
 */
export interface DecisionOptionDocument {
  readonly label:       string;
  readonly description: string;
}

export interface DecisionQuestionDocument {
  readonly question:    string;
  readonly header:      string;
  readonly multiSelect: boolean;
  readonly options:     readonly DecisionOptionDocument[];
}

export interface DecisionDocument {
  readonly id:        string;
  readonly kind:      string;
  readonly ticketIds: readonly string[];
  readonly jobId:     string | null;
  readonly askedBy:   string;
  readonly questions: readonly DecisionQuestionDocument[];
  readonly context:   string;
  readonly openedAt:  string;
}

export interface IncidentDocument {
  readonly id:              string;
  readonly kind:            string;
  readonly ticketIds:       readonly string[];
  readonly jobId:           string | null;
  readonly facts:           Readonly<Record<string, string>>;
  readonly defaultMove:     string;
  readonly deliveredInTurn: unknown;
  readonly openedAt:        string;
}

export interface SessionJobDocument {
  readonly id:        string;
  readonly kind:      string;
  readonly ticketIds: readonly string[];
  readonly state:     string;
  readonly intake?:   { readonly text: string };
}

export interface TicketDocument {
  readonly id:            string;
  readonly title:         string;
  readonly status:        string;
  readonly hold?:         string;
  readonly priority?:     string;
  readonly filedByJob?:   string;
  readonly findingRoute?: string;
}

export interface NoticeDocument {
  readonly kind: string;
}

/** One log record as stored: its kind, stamp, subject id beside them, and its fields. */
export interface HistoryRecordDocument {
  readonly kind:        string;
  readonly at:          string;
  readonly jobId?:      string;
  readonly ticketId?:   string;
  readonly decisionId?: string;
  readonly incidentId?: string;
  readonly fields:      Readonly<Record<string, unknown>>;
}

export interface ConversationBoardDocument {
  readonly jobs:             readonly SessionJobDocument[];
  readonly decisions:        readonly DecisionDocument[];
  readonly incidents:        readonly IncidentDocument[];
  readonly notices?:         readonly NoticeDocument[];
  readonly page?:            { readonly tickets: readonly TicketDocument[] };
  readonly questionHistory?: readonly HistoryRecordDocument[];
}
