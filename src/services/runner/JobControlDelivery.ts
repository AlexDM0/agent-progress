/**
 * After the hold, the frames User's job controls ask of a live host (design section 7.4): every `job-messaged` record as a chat line in log
 * order, the wind-down turn of a `wind-down` request, and a session's closed input, with a stop frame after it for a `stop`. A frame waits
 * until its host is live, and a marker written once it was taken keeps a restart from sending it twice.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join }                                 from 'node:path';

import type { ActingFrame }                from '../../lib/agent-host/@types/HostFrame.ts';
import type { AgentAdapter }               from '../../lib/agent-launch/AgentAdapter.ts';
import type { Job, JobKind }               from '../../lib/tracker-model/@types/Job.ts';
import type { Board }                      from '../../lib/tracker-model/Board.ts';
import { SESSION_STOP_GRACE_MILLISECONDS } from '../../shared/constants/RunnerLimits.ts';
import { HostFleet }                       from './HostFleet.ts';

export interface JobControlDeliveryRequest {
  trackerDirectory: string;
  board:            Board;
  adapter:          AgentAdapter;
  windDownMessage:  string;
}

const MARKERS_FOLDER = 'control-frames';

const SESSION_JOB_KINDS: readonly JobKind[] = ['orchestrator', 'product-owner'];

/** Marks before sending, so a runner that dies between the two never sends a frame twice; a host that is not live is sent nothing yet. */
async function sendOnce(jobFolder: string, job: Readonly<Job>, marker: string, frames: readonly ActingFrame[]): Promise<void> {
  const markerPath = join(jobFolder, MARKERS_FOLDER, marker);
  if (existsSync(markerPath) || HostFleet.livenessOf(jobFolder, job.hostInstance).verdict !== 'live') return;
  mkdirSync(join(jobFolder, MARKERS_FOLDER), { recursive: true });
  writeFileSync(markerPath, '');
  await HostFleet.sendFrames(jobFolder, job.hostInstance, frames);
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
      const stops: ActingFrame[] = job.stopRequest === 'stop' ? [{ kind: 'stop', graceMilliseconds: SESSION_STOP_GRACE_MILLISECONDS }] : [];
      await sendOnce(jobFolder, job, `input-closed-${job.hostInstance}`, [{ kind: 'close-input' }, ...stops]);
    }
  }
}

export const JobControlDelivery = Object.freeze({ deliverJobControls });
