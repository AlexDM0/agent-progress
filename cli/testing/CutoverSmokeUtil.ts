/**
 * The judgement of `cli/testing/CutoverSmoke.ts`, kept pure so a spec can hold it: whether the smoke may run at all, where its log goes,
 * and one verdict per Acceptance item 1-5 of the cutover smoke, read from the board's stored log and the events an SSE client received.
 */
import { join } from 'node:path';

import { ORIGINAL_PRODUCT_NAMES, type ProductNames } from '../../src/shared/constants/ProductNames.ts';

/** One stored `log.jsonl` line, read loosely: the smoke judges a board it did not write. */
export interface SmokeLogRecord {
  at:          string;
  kind:        string;
  ticketId?:   string;
  jobId?:      string;
  decisionId?: string;
  incidentId?: string;
  fields:      Record<string, unknown>;
}

export interface SmokeStreamedEvent {
  kind:       string;
  receivedAt: string;
  data:       Record<string, unknown>;
}

/** A span with no Overseer serving the SSE client: from the kill or the restart to the client's reconnection. */
export interface StreamGap {
  from: string;
  to:   string;
}

export interface SmokeItemVerdict {
  item:   number;
  passed: boolean;
  detail: string;
}

/** What the driver saw around the Overseer's `kill -9`, its second `run` and its `run restart`. */
export interface RegroupingObservation {
  jobId:                           string;
  hostInstanceBeforeKill:          number;
  hostInstanceAfterRegrouping:     number;
  hostInstanceAfterRestart:        number;
  hostProcessAliveAfterRegrouping: boolean;
  hostProcessAliveAfterRestart:    boolean;
  restartExitCode:                 number;
  buildJobsOnTheTicketAfterKill:   number;
}

export interface QuestionPlants {
  agentQuestionTicketId:   string;
  malformedTicketTicketId: string;
}

const EVIDENCE_FOLDER_PATH = ['.claude', '.evidence', 'cutover-smoke'] as const;
const MINIMUM_PASSED_GATE_RUNS = 3;

const STATUS_OF_TICKET_MOVE: Readonly<Record<string, string>> = {
  'ticket-readied':   'pending',
  'ticket-started':   'in-progress',
  'ticket-finished':  'in-review',
  'ticket-approved':  'approved',
  'ticket-delivered': 'delivered',
};

function fieldText(record: SmokeLogRecord, field: string): string | undefined {
  const value = record.fields[field];
  return typeof value === 'string' ? value : undefined;
}

function fieldList(record: SmokeLogRecord, field: string): string[] {
  const value = record.fields[field];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function launchesOf(records: readonly SmokeLogRecord[]): SmokeLogRecord[] {
  return records.filter((record) => record.kind === 'job-launched');
}

function outcomeOfJob(records: readonly SmokeLogRecord[], jobId: string | undefined): string | undefined {
  const ended = records.find((record) => record.kind === 'job-ended' && record.jobId === jobId);
  return ended === undefined ? undefined : fieldText(ended, 'outcome');
}

function roleLaunchedFor(records: readonly SmokeLogRecord[], ticketId: string, role: string): boolean {
  return launchesOf(records).some((launch) => fieldText(launch, 'role') === role && fieldList(launch, 'ticketIds').includes(ticketId));
}

function epochMillisecondsOf(stamp: string): number {
  return new Date(stamp).getTime();
}

/** Two merge jobs on one target never held it at once: each merge-started comes after the previous merge job on that target ended. */
function mergesAreOrdered(records: readonly SmokeLogRecord[]): boolean {
  const heldTargets = new Map<string, string>();
  for (const record of records) {
    if (record.kind === 'merge-started') {
      const target = fieldText(record, 'target') ?? '';
      if (heldTargets.has(target)) return false;
      heldTargets.set(target, record.jobId ?? '');
    }
    if (record.kind === 'job-ended') {
      for (const [target, jobId] of heldTargets) if (jobId === record.jobId) heldTargets.delete(target);
    }
  }
  return true;
}

function ticketStatusesOfBoardEvent(data: Record<string, unknown>): { id: string; status: string }[] {
  const { page } = data;
  const pageTickets = typeof page === 'object' && page !== null ? (page as Record<string, unknown>)['tickets'] : undefined;
  return [data['tickets'], pageTickets].flatMap((tickets) => (Array.isArray(tickets) ? tickets : [])).flatMap((ticket: unknown) => {
    if (typeof ticket !== 'object' || ticket === null) return [];
    const flat = ticket as Record<string, unknown>;
    const frontmatter = typeof flat['frontmatter'] === 'object' && flat['frontmatter'] !== null ? flat['frontmatter'] as Record<string, unknown> : {};
    const id = flat['id'] ?? frontmatter['id'];
    const status = flat['status'] ?? frontmatter['status'];
    return typeof id === 'string' && typeof status === 'string' ? [{ id, status }] : [];
  });
}

export const CutoverSmokeUtil = Object.freeze({
  /** Null when the smoke may run: only under side-by-side names, so it never touches the released program's boards or monitor folder. */
  refusalOf(names: Readonly<ProductNames>, withRealClaude: boolean): string | null {
    if (names.PROGRAM === ORIGINAL_PRODUCT_NAMES.PROGRAM) {
      return `Refused: PROGRAM is ${ORIGINAL_PRODUCT_NAMES.PROGRAM}; the cutover smoke runs only under the side-by-side names.`;
    }
    if (names.MONITOR_FOLDER === ORIGINAL_PRODUCT_NAMES.MONITOR_FOLDER || names.DATA_FOLDER === ORIGINAL_PRODUCT_NAMES.DATA_FOLDER) {
      return 'Refused: the monitor or data folder is the released program\'s; the cutover smoke runs only under the side-by-side names.';
    }
    if (!withRealClaude) return 'Refused: the cutover smoke launches real claude sessions and spends subscription; pass --with-real-claude to opt in.';
    return null;
  },

  evidenceFolderOf(mainCheckout: string): string {
    return join(mainCheckout, ...EVIDENCE_FOLDER_PATH);
  },

  /** Item 1: both tickets delivered through build, review, an ordered merge each and passing gate runs. */
  deliveryVerdictOf(records: readonly SmokeLogRecord[], ticketIds: readonly string[]): SmokeItemVerdict {
    const missing = ticketIds.flatMap((ticketId) => [
      ...(roleLaunchedFor(records, ticketId, 'builder') ? [] : [`#${ticketId} had no builder`]),
      ...(roleLaunchedFor(records, ticketId, 'reviewer') ? [] : [`#${ticketId} had no reviewer`]),
      ...(records.some((record) => record.kind === 'ticket-delivered' && record.ticketId === ticketId) ? [] : [`#${ticketId} was not delivered`]),
    ]);
    const landings = records.filter((record) => record.kind === 'merge-landed').length;
    const passedGateRuns = records.filter((record) => record.kind === 'gate-ran' && fieldText(record, 'outcome') === 'passed').length;
    const problems = [
      ...missing,
      ...(landings >= ticketIds.length ? [] : [`${landings} landings for ${ticketIds.length} tickets`]),
      ...(mergesAreOrdered(records) ? [] : ['two merges held one target at once']),
      ...(passedGateRuns >= MINIMUM_PASSED_GATE_RUNS ? [] : [`${passedGateRuns} passed gate runs, fewer than ${MINIMUM_PASSED_GATE_RUNS}`]),
    ];
    return {
      item:   1,
      passed: problems.length === 0,
      detail: problems.length === 0
        ? `${ticketIds.map((ticketId) => `#${ticketId}`).join(' and ')} delivered after build and review; ${landings} ordered landings; ${passedGateRuns} passed gate runs`
        : problems.join('; '),
    };
  },

  /** Item 2: the agent outlived the Overseer's kill and its restart, and no second host or build started on its ticket. */
  regroupingVerdictOf(observation: RegroupingObservation): SmokeItemVerdict {
    const problems = [
      ...(observation.hostProcessAliveAfterRegrouping ? [] : ['the agent host died with the Overseer']),
      ...(observation.hostInstanceAfterRegrouping === observation.hostInstanceBeforeKill ? [] : [
        `the regrouped job moved to host instance ${observation.hostInstanceAfterRegrouping}`,
      ]),
      ...(observation.buildJobsOnTheTicketAfterKill === 0 ? [] : [`${observation.buildJobsOnTheTicketAfterKill} more build jobs launched on the ticket`]),
      ...(observation.restartExitCode === 0 ? [] : [`run restart exited ${observation.restartExitCode}`]),
      ...(observation.hostProcessAliveAfterRestart ? [] : ['the agent host died in the Baton handover']),
      ...(observation.hostInstanceAfterRestart === observation.hostInstanceBeforeKill ? [] : [
        `the job moved to host instance ${observation.hostInstanceAfterRestart} in the handover`,
      ]),
    ];
    return {
      item:   2,
      passed: problems.length === 0,
      detail: problems.length === 0
        ? `job ${observation.jobId} kept host instance ${observation.hostInstanceBeforeKill} alive through kill -9, a new run and run restart`
        : problems.join('; '),
    };
  },

  /** Item 3: a resolver resolved a merge's conflict and that merge then landed. */
  conflictVerdictOf(records: readonly SmokeLogRecord[]): SmokeItemVerdict {
    const resolvers = launchesOf(records).filter((launch) => fieldText(launch, 'role') === 'resolver');
    const landedResolution = resolvers.find((resolver) => outcomeOfJob(records, resolver.jobId) === 'resolved'
      && records.some((record) => record.kind === 'merge-landed' && record.jobId === fieldText(resolver, 'parentJobId')));
    const predictedConflicts = records.filter((record) => record.kind === 'merge-started' && fieldList(record, 'predictedConflictFiles').length > 0);
    return {
      item:   3,
      passed: landedResolution !== undefined,
      detail: landedResolution === undefined
        ? `${resolvers.length} resolver jobs, none resolved a merge that then landed; ${predictedConflicts.length} merges predicted a conflict`
        : `resolver ${landedResolution.jobId} resolved merge ${fieldText(landedResolution, 'parentJobId')}, which landed`,
    };
  },

  /** Item 4: the planted question became a decision answered before its ticket's build went on, and the `ticket` one an incident handled. */
  questionVerdictOf(records: readonly SmokeLogRecord[], plants: QuestionPlants): SmokeItemVerdict {
    const decision = records.find((record) => record.kind === 'decision-opened' && fieldText(record, 'kind') === 'agent-question'
      && fieldList(record, 'ticketIds').includes(plants.agentQuestionTicketId));
    const answer = records.find((record) => record.kind === 'decision-answered' && record.decisionId === decision?.decisionId);
    const builtAfterAnswer = answer !== undefined && records.some((record) => record.kind === 'ticket-finished' && record.ticketId === plants.agentQuestionTicketId
      && epochMillisecondsOf(record.at) >= epochMillisecondsOf(answer.at));
    const incident = records.find((record) => record.kind === 'incident-opened' && fieldText(record, 'kind') === 'malformed-ticket'
      && fieldList(record, 'ticketIds').includes(plants.malformedTicketTicketId));
    const handling = records.find((record) => (record.kind === 'incident-answered' || record.kind === 'incident-escalated') && record.incidentId === incident?.incidentId);
    const problems = [
      ...(decision === undefined ? [`no agent-question decision opened for #${plants.agentQuestionTicketId}`] : []),
      ...(decision !== undefined && answer === undefined ? [`decision ${decision.decisionId} was never answered`] : []),
      ...(answer !== undefined && !builtAfterAnswer ? [`#${plants.agentQuestionTicketId} was not finished after its answer`] : []),
      ...(incident === undefined ? [`no malformed-ticket incident opened for #${plants.malformedTicketTicketId}`] : []),
      ...(incident !== undefined && handling === undefined ? [`incident ${incident.incidentId} was neither answered nor escalated`] : []),
    ];
    return {
      item:   4,
      passed: problems.length === 0,
      detail: problems.length === 0
        ? `decision ${decision?.decisionId} answered and #${plants.agentQuestionTicketId} built on; `
          + `incident ${incident?.incidentId} ${handling?.kind === 'incident-answered' ? 'answered' : 'escalated'} by the Assistant`
        : problems.join('; '),
    };
  },

  /**
   * Item 5: every ticket move logged while the stream was connected shows in a `board` event as the status it moved to, and every job
   * launched then was published in at least one `job` event. A move a later move of the same ticket in the same stamp overtook is never
   * published, since an event carries the state a whole pass left; a record logged while no Overseer served the stream is not asked of it.
   */
  eventVerdictOf(records: readonly SmokeLogRecord[], events: readonly SmokeStreamedEvent[], streamOpenedAt: string, gaps: readonly StreamGap[] = []): SmokeItemVerdict {
    const inAGap = (record: SmokeLogRecord): boolean => gaps.some((gap) => epochMillisecondsOf(record.at) >= epochMillisecondsOf(gap.from) - 1000
      && epochMillisecondsOf(record.at) <= epochMillisecondsOf(gap.to) + 1000);
    const recordsSinceOpening = records.filter((record) => epochMillisecondsOf(record.at) >= epochMillisecondsOf(streamOpenedAt) - 1000 && !inAGap(record));
    const seenStatuses = new Set(events.filter((event) => event.kind === 'board')
      .flatMap((event) => ticketStatusesOfBoardEvent(event.data).map(({ id, status }) => `#${id} ${status}`)));
    const isMove = (record: SmokeLogRecord): boolean => Object.hasOwn(STATUS_OF_TICKET_MOVE, record.kind) && record.ticketId !== undefined;
    const unseenMoves = recordsSinceOpening.flatMap((record, i) => {
      if (!isMove(record)) return [];
      const overtaken = recordsSinceOpening.slice(i + 1).some((later) => isMove(later) && later.ticketId === record.ticketId && later.at === record.at);
      const label = `#${record.ticketId} ${STATUS_OF_TICKET_MOVE[record.kind]}`;
      return overtaken || seenStatuses.has(label) ? [] : [label];
    });
    const jobStates = new Map<string, Set<string>>();
    for (const event of events.filter((streamed) => streamed.kind === 'job')) {
      const { id: jobId, state } = event.data;
      if (typeof jobId !== 'string' || typeof state !== 'string') continue;
      jobStates.set(jobId, (jobStates.get(jobId) ?? new Set()).add(state));
    }
    const unpublishedJobs = launchesOf(recordsSinceOpening).flatMap((launch) => (jobStates.has(launch.jobId ?? '') ? [] : [launch.jobId ?? '?']));
    const problems = [
      ...(unseenMoves.length === 0 ? [] : [`no board event showed ${unseenMoves.join(', ')}`]),
      ...(unpublishedJobs.length === 0 ? [] : [`no job event for ${unpublishedJobs.join(', ')}`]),
    ];
    const statesText = [...jobStates].map(([jobId, states]) => `${jobId} ${[...states].join('>')}`).join('; ');
    return {
      item:   5,
      passed: problems.length === 0,
      detail: problems.length === 0 ? `every ticket move in a board event; job states seen: ${statesText}` : `${problems.join('; ')}; job states seen: ${statesText}`,
    };
  },

  passLineOf(verdict: SmokeItemVerdict): string {
    return `item ${verdict.item}: ${verdict.passed ? 'PASS' : 'FAIL'} — ${verdict.detail}`;
  },
});
