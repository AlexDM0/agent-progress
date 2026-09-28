/** The dispatcher's own decisions: the passes, releases and review rounds a ticket gets, what its helper agents run on, and the order of priorities. */
import type { TicketPriority } from '../../src/lib/tracker-model/@types/Ticket.ts';

export const DISPATCH_POLICY = {
  SINGLE_TICKET_RUN_AGENTS:                1,
  FAILED_PASSES_BEFORE_PARKING:            2,
  // Agents that died back to back, across tickets, are a session limit or an outage rather than tickets failing: the run stops instead of parking.
  CONSECUTIVE_DEAD_AGENTS_BEFORE_STOPPING: 2,
  MAIN_MOVED_RELEASES_BEFORE_PARKING:      2,
  ROUND_GRANTED_ON_REWORK_ALONE:           2,
  FINDINGS_SHRINK_FACTOR_PER_ROUND:        2,
  PARKING_LOG_REASON_LIMIT_CHARACTERS:     200,
  SURVEY_AGENT:                            { model: 'haiku', effort: 'low' },
  PARKING_AGENT:                           { model: 'haiku', effort: 'low' },
  PRIORITIES_IN_ORDER:                     ['high', 'normal', 'low'] satisfies readonly TicketPriority[],
  PRIORITIES_ADMITTED_WITHOUT_TRIAGE:      ['normal', 'high'] satisfies readonly TicketPriority[],
  // Holding back normal work is undone by a relaunch, starting untriaged low work is not; so an unstated priority reads as low, not the model's normal.
  UNSTATED_PRIORITY:                       'low' satisfies TicketPriority,
  // A group is one pipeline: builder N+1 on N's built tip while reviewer N integrates N, never two of either at once.
  GROUP_BUILDERS_AT_ONCE:                  1,
  GROUP_REVIEWERS_AT_ONCE:                 1,
  // A group builder waits for a slot by its own background poll, since the dispatcher may run no timer.
  SLOT_WAIT_LIMIT_MINUTES:                 60,
  SLOT_POLL_INTERVAL_SECONDS:              30,
} as const;
