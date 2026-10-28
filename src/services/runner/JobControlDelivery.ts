/**
 * After the hold, the frames User's job controls ask of a live host (design section 7.4): every `job-messaged` record as a chat line in log
 * order, the wind-down turn of a `wind-down` request, and a session's closed input, with a stop frame after it for a `stop`. A frame waits
 * until its host is live, and a marker written once it was taken keeps a restart from sending it twice.
 */
import { join } from 'node:path';

import type { ActingFrame }                from '../../lib/agent-host/@types/HostFrame.ts';
import type { AgentAdapter }               from '../../lib/agent-launch/AgentAdapter.ts';
import type { Job, JobKind }               from '../../lib/tracker-model/@types/Job.ts';
import type { Board }                      from '../../lib/tracker-model/Board.ts';
import { SESSION_STOP_GRACE_MILLISECONDS } from '../../shared/constants/RunnerLimits.ts';
import { HostFleet }                       from './HostFleet.ts';

export interface JobControlDeliveryRequest {
  trackerDirectory: string;
  board:            Pick<Board, 'jobs' | 'logRecordsSoFar'>;
  adapter:          Pick<AgentAdapter, 'chatLineOf'>;
  windDownMessage:  string;
}

const MARKERS_FOLDER = 'control-frames';

const SESSION_JOB_KINDS: readonly JobKind[] = ['orchestrator', 'product-owner'];

async function sendOnce(jobFolder: string, job: Readonly<Job>, marker: string, frames: readonly ActingFrame[]): Promise<void> {
  await HostFleet.sendFramesOnce(join(jobFolder, MARKERS_FOLDER, marker), jobFolder, job.hostInstance, frames);
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
    const jobFolder = HostFleet.jobFolderOf(request.trackerDirectory, job.id);
    for (const message of messages.filter((candidate) => candidate.jobId === job.id)) {
      await sendOnce(jobFolder, job, `message-${message.number}`, [{ kind: 'write', line: adapter.chatLineOf(message.text) }]);
    }
    if (job.stopRequest === 'wind-down' && job.state === 'running') {
      await sendOnce(jobFolder, job, 'wind-down', [{ kind: 'write', line: adapter.chatLineOf(request.windDownMessage) }]);
    }
    if (job.state === 'stopping' && SESSION_JOB_KINDS.includes(job.kind)) {
      await sendOnce(jobFolder, job, `input-closed-${job.hostInstance}`, [{ kind: 'close-input' }]);
      if (job.stopRequest === 'stop') {
        await sendOnce(jobFolder, job, `stop-${job.hostInstance}`, [{ kind: 'stop', graceMilliseconds: SESSION_STOP_GRACE_MILLISECONDS }]);
      }
    }
  }
}

export const JobControlDelivery = Object.freeze({ deliverJobControls });
