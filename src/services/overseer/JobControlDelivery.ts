/**
 * After the hold, the frames User's job controls ask of a live Watcher (design section 7.4): every `job-messaged` record as a chat line in log
 * order, the wind-down turn of a `wind-down` request, and a session's closed input, with a stop frame after it for a `stop`. A frame waits
 * until its Watcher is live, and a marker written once it was taken keeps a restart from sending it twice.
 */
import { existsSync } from 'node:fs';
import { join }       from 'node:path';

import type { AgentAdapter }               from '../../lib/agent-launch/AgentAdapter.ts';
import type { Job, JobKind }               from '../../lib/tracker-model/@types/Job.ts';
import type { Board }                      from '../../lib/tracker-model/Board.ts';
import type { ActingFrame }                from '../../lib/watcher/@types/WatcherFrame.ts';
import { SESSION_STOP_GRACE_MILLISECONDS } from '../../shared/constants/OverseerLimits.ts';
import { WatcherFleet }                    from './WatcherFleet.ts';

export interface JobControlDeliveryRequest {
  trackerDirectory: string;
  board:            Pick<Board, 'jobs' | 'logRecordsSoFar'>;
  adapter:          Pick<AgentAdapter, 'chatLineOf'>;
  windDownMessage:  string;
}

const MARKERS_FOLDER = 'control-frames';

const SESSION_JOB_KINDS: readonly JobKind[] = ['assistant', 'product-owner'];

/** Whether the frames were taken, on this pass or an earlier one: a later frame of the job waits on an earlier one, so none overtakes it. */
async function sendOnce(jobFolder: string, job: Readonly<Job>, marker: string, frames: readonly ActingFrame[]): Promise<boolean> {
  const markerPath = join(jobFolder, MARKERS_FOLDER, marker);
  await WatcherFleet.sendFramesOnce(markerPath, jobFolder, job.watcherInstance, frames);
  return existsSync(markerPath);
}

async function deliverInOrder(sends: readonly (() => Promise<boolean>)[]): Promise<void> {
  for (const send of sends) {
    if (!await send()) return;
  }
}

async function deliverJobControls(request: JobControlDeliveryRequest): Promise<void> {
  const { board, adapter } = request;
  const messageCountByJob = new Map<string, number>();
  const messages = board.logRecordsSoFar().flatMap((record) => {
    if (record.kind !== 'job-messaged') return [];
    const number = (messageCountByJob.get(record.jobId) ?? 0) + 1;
    messageCountByJob.set(record.jobId, number);
    return [{ jobId: record.jobId, number, text: record.fields.text }];
  });
  for (const job of board.jobs()) {
    const jobFolder = WatcherFleet.jobFolderOf(request.trackerDirectory, job.id);
    // The Assistant takes User's messages only when idle, numbered among its chats by `src/services/overseer/AssistantSession.ts`.
    const messagesOfJob = job.kind === 'assistant' ? [] : messages.filter((candidate) => candidate.jobId === job.id);
    const sends = messagesOfJob.map((message) => async () => await sendOnce(
      jobFolder, job, `message-${message.number}`, [{ kind: 'write', line: adapter.chatLineOf(message.text) }]
    ));
    if (job.stopRequest === 'wind-down' && job.state === 'running') {
      sends.push(async () => await sendOnce(jobFolder, job, 'wind-down', [{ kind: 'write', line: adapter.chatLineOf(request.windDownMessage) }]));
    }
    if (job.state === 'stopping' && SESSION_JOB_KINDS.includes(job.kind)) {
      sends.push(async () => await sendOnce(jobFolder, job, `input-closed-${job.watcherInstance}`, [{ kind: 'close-input' }]));
      if (job.stopRequest === 'stop') {
        sends.push(async () => await sendOnce(jobFolder, job, `stop-${job.watcherInstance}`, [{ kind: 'stop', graceMilliseconds: SESSION_STOP_GRACE_MILLISECONDS }]));
      }
    }
    await deliverInOrder(sends);
  }
}

export const JobControlDelivery = Object.freeze({ deliverJobControls });
