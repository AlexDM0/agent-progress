/**
 * Under a job a session cannot write the data folder, so a mutating verb hands the control command it built to the Overseer: it writes a
 * request into the job's Hatch folder, waits a while for the reply, and prints the outcome, or `queued <requestId>` when none came.
 */
import { randomUUID } from 'node:crypto';

import { hatchReplyFilePathOf, hatchReplyLookupOf, writeHatchRequest } from '../src/adapters/hatch/HatchFolder.ts';
import { HatchFormatUtil }                                             from '../src/adapters/hatch/utils/HatchFormatUtil.ts';
import { OperationRefusalWordingUtil }                                 from '../src/adapters/utils/OperationRefusalWordingUtil.ts';
import type { ControlCommand }                                         from '../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }                                            from '../src/shared/OperationRefusal.ts';
import type { CommandContext, JobContext }                             from './CommandContext.ts';

/** Thrown once a relayed verb has printed its outcome, so the verb prints nothing of its own; `cli/Main.ts` exits with its code. */
export class HatchConcluded extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super('relayed');
    this.name     = 'HatchConcluded';
    this.exitCode = exitCode;
  }
}

async function answeredReplyOf(job: JobContext, requestId: string) {
  for (let attempt = 0; attempt < job.replyTries; attempt += 1) {
    if (attempt > 0) await Bun.sleep(job.replyIntervalMilliseconds);
    const lookup = hatchReplyLookupOf(job.hatchDirectory, requestId);
    if (lookup.verdict !== 'absent') return lookup;
  }
  return null;
}

async function hatch(context: CommandContext, job: JobContext, command: ControlCommand): Promise<never> {
  const requestId = randomUUID();
  writeHatchRequest(job.hatchDirectory, HatchFormatUtil.requestOf(requestId, command));
  const lookup = await answeredReplyOf(job, requestId);
  if (lookup === null) {
    context.standardOutput(OperationRefusalWordingUtil.hatchQueuedMessageOf(requestId));
    throw new HatchConcluded(0);
  }
  if (lookup.verdict === 'malformed') {
    throw new OperationRefusal('unrepaired', { kind: 'malformed-hatch-reply', replyFilePath: hatchReplyFilePathOf(job.hatchDirectory, requestId) });
  }
  const { reply } = lookup;
  if (reply.outcome === 'refused') throw new OperationRefusal(reply.status, reply.detail);
  context.standardOutput(OperationRefusalWordingUtil.hatchAnsweredMessageOf(requestId, reply.outcome, reply.ticketIds));
  throw new HatchConcluded(0);
}

/** Returns at once outside a job; under one it never returns, ending the verb through `HatchConcluded` or a refusal. */
export async function hatchWhenUnderJob(context: CommandContext, command: ControlCommand): Promise<void> {
  if (context.job === undefined) return;
  await hatch(context, context.job, command);
}

export function refusalIsHatchConcluded(thrown: unknown): thrown is HatchConcluded {
  return thrown instanceof HatchConcluded;
}
