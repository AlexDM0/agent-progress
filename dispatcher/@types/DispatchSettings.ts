import type { TicketPriority } from '../../src/lib/tracker-model/@types/Ticket.ts';

/** Relayed to `agent()` verbatim: defaulted when absent, never narrowed to the model's vocabularies. */
export interface AgentModelAndEffort {
  model:  string;
  effort: string;
}

export interface ReadyTicketEntry {
  id:                  string;
  priority:            TicketPriority;
  agentModelAndEffort: AgentModelAndEffort;
  ticketIsHeld:        boolean;
  /** The ticket's group, `null` when it names none: a single-ticket run refuses a grouped ticket the board left out of its ready list. */
  groupName:           string | null;
}

export interface DispatchSettings {
  mainCheckout:          string;
  mainLine:              string;
  checkCommand:          string;
  installCommand:        string;
  lowPriorityIsIncluded: boolean;
  ticketIds:             string[] | null;
  readyTickets:          ReadyTicketEntry[];
  runLabel:              string;
  /** A group run's group: its bundle is built onto `group-<name>` and integrated there, never released. `null` for any other run. */
  groupName:             string | null;
}

export type DispatchSettingsRefusal = { reason: 'missing-argument'; argumentName: string } | { reason: 'invalid-ticket-ids' } | { reason: 'invalid-group' };

export type DispatchSettingsVerdict = { verdict: 'valid'; settings: DispatchSettings } | ({ verdict: 'invalid' } & DispatchSettingsRefusal);
