/**
 * The dispatcher's one input edge: the Workflow arguments and every agent's reply, mapped into internal values. Each guard reads a malformed
 * shape as `dispatcher/testing/FrozenDispatchTraces.json` pins it, so a reply the schema admits maps to exactly what the run acts on.
 */
import type { TicketPriority }                       from '../../src/lib/tracker-model/@types/Ticket.ts';
import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL } from '../../src/lib/tracker-model/constants/AgentSettings.ts';
import type { ReleaseRefusalReason }                 from '../../src/shared/@types/ReleaseRefusalReason.ts';
import { DispatcherClaimNoteUtil }                   from '../../src/shared/utils/DispatcherClaimNoteUtil.ts';
import type {
  AgentReading,
  PausedBuild,
  ReviewFinding,
  ReviewWaitingTicket,
  StatusReading,
  SurveyReading
} from '../@types/AgentReadings.ts';
import type { AgentModelAndEffort, DispatchSettingsVerdict, ReadyTicketEntry } from '../@types/DispatchSettings.ts';
import type { DispatchWork }                                                   from '../@types/DispatchWork.ts';
import { DISPATCH_ARGUMENTS }                                                  from '../constants/DispatchArguments.ts';
import { DISPATCH_POLICY }                                                     from '../constants/DispatchPolicy.ts';

const BUILDER_OUTCOMES_OTHER_THAN_IN_REVIEW = ['claim-refused', 'failed'] as const;

const REVIEWER_VERDICTS_OTHER_THAN_ROUND_REQUESTED = ['released', 'does-not-hold', 'not-released'] as const;

function valueIsAnObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textIsStated(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function textOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringsIn(list: readonly unknown[]): string[] {
  return list.filter((entry): entry is string => typeof entry === 'string');
}

function listOrUnlisted(value: unknown): string[] | 'unlisted' {
  return Array.isArray(value) ? stringsIn(value) : 'unlisted';
}

function priorityOf(value: unknown): TicketPriority {
  return DISPATCH_POLICY.PRIORITIES_IN_ORDER.find((priority) => priority === value) ?? DISPATCH_POLICY.UNSTATED_PRIORITY;
}

function agentModelAndEffortOf(entry: Record<string, unknown>): AgentModelAndEffort {
  const { model, effort } = entry;
  return {
    model:  textIsStated(model) ? model : DEFAULT_AGENT_MODEL,
    effort: textIsStated(effort) ? effort : DEFAULT_AGENT_EFFORT,
  };
}

// An entry without a string id could never be found by a ticket id, so dropping it changes nothing the run looks up.
function readyTicketEntriesOf(value: unknown): ReadyTicketEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ReadyTicketEntry[] = [];
  for (const entry of value) {
    if (!valueIsAnObject(entry)) continue;
    const { id } = entry;
    if (typeof id !== 'string') continue;
    entries.push({
      id,
      priority:            priorityOf(entry['priority']),
      agentModelAndEffort: agentModelAndEffortOf(entry),
      held:                entry['held'] === true,
    });
  }
  return entries;
}

function ticketIdsOf(given: unknown): string[] | null | 'invalid' {
  if (given === undefined) return null;
  if (!Array.isArray(given) || given.length === 0 || !given.every(textIsStated)) return 'invalid';
  return [...new Set(given)];
}

function settingsVerdictOf(workflowArguments: unknown): DispatchSettingsVerdict {
  const given: Record<string, unknown> = valueIsAnObject(workflowArguments) ? workflowArguments : {};
  const missingArgumentName = DISPATCH_ARGUMENTS.REQUIRED_NAMES.find((argumentName) => !textIsStated(given[argumentName]));
  if (missingArgumentName !== undefined) return { verdict: 'invalid', reason: 'missing-argument', argumentName: missingArgumentName };
  const ticketIds = ticketIdsOf(given['ticketIds']);
  if (ticketIds === 'invalid') return { verdict: 'invalid', reason: 'invalid-ticket-ids' };
  return {
    verdict:  'valid',
    settings: {
      mainCheckout:       textOrEmpty(given['mainCheckout']),
      mainLine:           textOrEmpty(given['mainLine']),
      checkCommand:       textOrEmpty(given['checkCommand']),
      installCommand:     textOrEmpty(given['installCommand']),
      // Low tickets are the orchestrator's to triage first; only its relaunch after that triage passes true.
      includeLowPriority: given['includeLowPriority'] === true,
      ticketIds,
      readyTickets:       readyTicketEntriesOf(given['readyTickets']),
      runLabel:           DispatcherClaimNoteUtil.runLabelFor(ticketIds),
    },
  };
}

// The schema admits only integers for the two counts; `Number` is the coercion the slot arithmetic applied to them.
function statusReadingOf(value: unknown): StatusReading | 'unreadable' {
  if (!valueIsAnObject(value)) return 'unreadable';
  const { readyTicketIds } = value;
  if (!Array.isArray(readyTicketIds)) return 'unreadable';
  return {
    limit:                 Number(value['limit']),
    agentsInFlight:        Number(value['agentsInFlight']),
    readyTicketIds:        stringsIn(readyTicketIds),
    readyTickets:          readyTicketEntriesOf(value['readyTickets']),
    dispatcherIsStopped:   value['dispatcherState'] === 'stopped',
    inProgressTicketIds:   listOrUnlisted(value['inProgressTicketIds']),
    inProgressReviewOfIds: listOrUnlisted(value['inProgressReviewOfIds']),
    heldTicketIds:         listOrUnlisted(value['heldTicketIds']),
  };
}

// A list the run cannot walk reads as unlisted, where the survey's adoption stops.
function reviewWaitingTicketsOf(value: unknown): ReviewWaitingTicket[] | 'unlisted' {
  if (!Array.isArray(value) || !value.every(valueIsAnObject)) return 'unlisted';
  return value.map((entry) => ({ id: String(entry['id']), agentModelAndEffort: agentModelAndEffortOf(entry) }));
}

function pausedBuildsOf(value: unknown): PausedBuild[] {
  if (!Array.isArray(value)) return [];
  const pausedBuilds: PausedBuild[] = [];
  for (const pausedBuild of value) {
    if (!valueIsAnObject(pausedBuild) || pausedBuild['worktreeExists'] !== true) continue;
    pausedBuilds.push({
      id:                  String(pausedBuild['id']),
      note:                textOrEmpty(pausedBuild['note']),
      priority:            priorityOf(pausedBuild['priority']),
      agentModelAndEffort: agentModelAndEffortOf(pausedBuild),
    });
  }
  return pausedBuilds;
}

function surveyReadingOf(value: unknown): SurveyReading | null {
  if (value === null) return null;
  const survey: Record<string, unknown> = valueIsAnObject(value) ? value : {};
  return {
    status:               statusReadingOf(survey['status']),
    reviewWaitingTickets: reviewWaitingTicketsOf(survey['reviewWaitingTickets']),
    pausedBuilds:         pausedBuildsOf(survey['pausedBuilds']),
  };
}

function ticketSettingsLookupOf(lookup: unknown): ReadyTicketEntry[] | 'unread' {
  if (!valueIsAnObject(lookup) || !Array.isArray(lookup['tickets'])) return 'unread';
  return readyTicketEntriesOf(lookup['tickets']);
}

function findingsOf(value: unknown): ReviewFinding[] {
  if (!Array.isArray(value)) return [];
  return value.filter(valueIsAnObject).map((finding) => ({
    class:   String(finding['class']),
    file:    String(finding['file']),
    summary: String(finding['summary']),
  }));
}

// Settling reads every outcome but these two as in-review, and every verdict but these three as a round requested, so an unknown one maps there.
function finishedReadingOf(work: DispatchWork, value: unknown): AgentReading | null {
  if (value === null) return null;
  const reply: Record<string, unknown> = valueIsAnObject(value) ? value : {};
  const status = statusReadingOf(reply['status']);
  if (work.kind === 'park') return { kind: 'park', status };
  if (work.kind === 'build') {
    return {
      kind:      'build',
      outcome:   BUILDER_OUTCOMES_OTHER_THAN_IN_REVIEW.find((outcome) => outcome === reply['outcome']) ?? 'in-review',
      detail:    textOrEmpty(reply['detail']),
      claimNote: textOrEmpty(reply['claimNote']),
      status,
    };
  }
  const { round, releaseReason } = reply;
  return {
    kind:           'review',
    round:          typeof round === 'number' && Number.isInteger(round) ? round : 'unstated',
    verdict:        REVIEWER_VERDICTS_OTHER_THAN_ROUND_REQUESTED.find((verdict) => verdict === reply['verdict']) ?? 'round-requested',
    releaseRefusal: releaseReason === ('main-moved' satisfies ReleaseRefusalReason) ? 'main-moved' : { statedReason: String(releaseReason) },
    reworkedLines:  Number(reply['reworkedLines']),
    findings:       findingsOf(reply['findings']),
    filedTicketIds: Array.isArray(reply['filedTicketIds']) ? stringsIn(reply['filedTicketIds']) : [],
    status,
  };
}

export const WorkflowInputUtil = {
  settingsVerdictOf,
  statusReadingOf,
  surveyReadingOf,
  ticketSettingsLookupOf,
  finishedReadingOf,
} as const;
