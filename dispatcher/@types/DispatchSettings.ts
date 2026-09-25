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
  held:                boolean;
}

export interface DispatchSettings {
  mainCheckout:       string;
  mainLine:           string;
  checkCommand:       string;
  installCommand:     string;
  includeLowPriority: boolean;
  ticketIds:          string[] | null;
  readyTickets:       ReadyTicketEntry[];
  runLabel:           string;
}

export type DispatchSettingsRefusal = { reason: 'missing-argument'; argumentName: string } | { reason: 'invalid-ticket-ids' };

export type DispatchSettingsVerdict = { verdict: 'valid'; settings: DispatchSettings } | ({ verdict: 'invalid' } & DispatchSettingsRefusal);
