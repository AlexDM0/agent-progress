/**
 * Delivers each answered question to its session after the answering hold, design section 8.2: a live host still holding the request gets
 * the `control_response` allow with the answers; a resumed session gets them as its first user line. A marker per request in the job's
 * folder, written only after the host took the line, keeps an answer from being delivered twice across passes and restarts.
 */
import { createHash }                from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join }                      from 'node:path';

import type { AgentAdapter }               from '../../lib/agent-launch/AgentAdapter.ts';
import type { AgentQuestion }              from '../../lib/agent-launch/AgentSessionEvent.ts';
import type { DecisionAnswer }             from '../../lib/tracker-model/@types/Decision.ts';
import type { Job }                        from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecord }                  from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Board }                      from '../../lib/tracker-model/Board.ts';
import { SESSION_STOP_GRACE_MILLISECONDS } from '../../shared/constants/RunnerLimits.ts';
import { HostFleet }                       from './HostFleet.ts';

const MARKER_DIGEST_LENGTH = 16;

export interface AnswerDeliveryRequest {
  trackerDirectory:          string;
  board:                     Board;
  adapter:                   AgentAdapter;
  /** T1-P1's finding: the vendor takes the answer as a `control_response`; when false the runner stops the host and resumes with it. */
  deliversByControlResponse: boolean;
  /** The answer worded as a plain user message, for a session that no longer holds the request. */
  answerMessageOf:           (answer: DecisionAnswer) => string;
}

function digestOf(requestId: string): string {
  return createHash('sha256').update(requestId).digest('hex').slice(0, MARKER_DIGEST_LENGTH);
}

function deliveredMarkerOf(jobFolder: string, requestId: string): string {
  return join(jobFolder, `answer-${digestOf(requestId)}.delivered`);
}

/** Written before the stop frame of the fallback, so the pass that finds the host ended interrupts it `answer-delivery`, never a crash. */
function answerStopMarkerOf(jobFolder: string, instance: number): string {
  return join(jobFolder, `answer-delivery-stop-${instance}`);
}

function answerOf(logRecords: readonly LogRecord[], requestId: string): DecisionAnswer | null {
  const answered = logRecords.findLast((record) => record.kind === 'decision-answered' && record.fields.requestId === requestId);
  return answered?.kind === 'decision-answered' ? answered.fields.answer : null;
}

function undeliveredRequestIdsOf(trackerDirectory: string, job: Readonly<Job>): string[] {
  const jobFolder = HostFleet.jobFolderOf(trackerDirectory, job.id);
  return job.answeredRequestIds.filter((requestId) => !existsSync(deliveredMarkerOf(jobFolder, requestId)));
}

/** The question as this instance's session asked it, or `null` when another instance asked it and this one never held the request. */
function questionsAskedInInstance(jobFolder: string, instance: number, adapter: AgentAdapter, requestId: string): readonly AgentQuestion[] | null {
  const entries = HostFleet.eventsAfter(jobFolder, instance, 0);
  if (entries === 'malformed') return null;
  for (const entry of entries) {
    if (entry.origin !== 'agent') continue;
    const asked = adapter.eventsOf(entry.line).find((event) => event.kind === 'question' && event.requestId === requestId);
    if (asked?.kind === 'question') return asked.questions;
  }
  return null;
}

async function deliverOne(request: AnswerDeliveryRequest, job: Readonly<Job>, requestId: string, answer: DecisionAnswer): Promise<void> {
  const jobFolder = HostFleet.jobFolderOf(request.trackerDirectory, job.id);
  const asked     = questionsAskedInInstance(jobFolder, job.hostInstance, request.adapter, requestId);
  if (asked !== null && !request.deliversByControlResponse) {
    const stopMarker = answerStopMarkerOf(jobFolder, job.hostInstance);
    if (existsSync(stopMarker)) return;
    writeFileSync(stopMarker, '');
    await HostFleet.sendFrames(jobFolder, job.hostInstance, [{ kind: 'stop', graceMilliseconds: SESSION_STOP_GRACE_MILLISECONDS }]);
    return;
  }
  const line = asked === null
    ? request.adapter.chatLineOf(request.answerMessageOf(answer))
    : request.adapter.answerLineOf(requestId, asked, answer);
  if (await HostFleet.sendFrames(jobFolder, job.hostInstance, [{ kind: 'write', line }])) writeFileSync(deliveredMarkerOf(jobFolder, requestId), '');
}

/** Every running job's answered, undelivered requests, each to its live host; a host not yet listening is tried on the next pass. */
async function deliverAnswers(request: AnswerDeliveryRequest): Promise<void> {
  const logRecords = request.board.logRecordsSoFar();
  for (const job of request.board.jobs()) {
    if (job.state !== 'running') continue;
    const jobFolder = HostFleet.jobFolderOf(request.trackerDirectory, job.id);
    if (HostFleet.livenessOf(jobFolder, job.hostInstance).verdict !== 'live') continue;
    for (const requestId of undeliveredRequestIdsOf(request.trackerDirectory, job)) {
      const answer = answerOf(logRecords, requestId);
      if (answer !== null) await deliverOne(request, job, requestId, answer);
    }
  }
}

/** A resumed session with an answer to deliver takes the answer as its first line, never the resume message. */
function answerAwaitsDelivery(trackerDirectory: string, job: Readonly<Job>): boolean {
  return undeliveredRequestIdsOf(trackerDirectory, job).length > 0;
}

/** The runner stopped this instance itself to deliver an answer: its end is an `answer-delivery` interruption, never counted. */
function stoppedForAnswerDelivery(trackerDirectory: string, job: Readonly<Job>): boolean {
  return existsSync(answerStopMarkerOf(HostFleet.jobFolderOf(trackerDirectory, job.id), job.hostInstance));
}

export const AnswerDelivery = Object.freeze({
  deliverAnswers,
  answerAwaitsDelivery,
  stoppedForAnswerDelivery,
});
