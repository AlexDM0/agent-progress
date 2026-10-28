/**
 * Under a job a session cannot write the data folder, so a mutating verb hands the control command it built to the runner: it writes a
 * request into the job's relay folder, waits a while for the reply, and prints the outcome, or `queued <requestId>` when none came.
 */
import { randomUUID } from 'node:crypto';

import { relayReplyFilePathOf, relayReplyLookupOf, writeRelayRequest } from '../src/adapters/relay/RelayFolder.ts';
import { RelayFormatUtil }                                             from '../src/adapters/relay/utils/RelayFormatUtil.ts';
import { OperationRefusalWordingUtil }                                 from '../src/adapters/utils/OperationRefusalWordingUtil.ts';
import type { ControlCommand }                                         from '../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }                                            from '../src/shared/OperationRefusal.ts';
import type { CommandContext, JobContext }                             from './CommandContext.ts';

/** Thrown once a relayed verb has printed its outcome, so the verb prints nothing of its own; `cli/Main.ts` exits with its code. */
export class RelayConcluded extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super('relayed');
    this.name     = 'RelayConcluded';
    this.exitCode = exitCode;
  }
}

async function answeredReplyOf(job: JobContext, requestId: string) {
  for (let attempt = 0; attempt < job.replyTries; attempt += 1) {
    if (attempt > 0) await Bun.sleep(job.replyIntervalMilliseconds);
    const lookup = relayReplyLookupOf(job.relayDirectory, requestId);
    if (lookup.verdict !== 'absent') return lookup;
  }
  return null;
}

async function relay(context: CommandContext, job: JobContext, command: ControlCommand): Promise<never> {
  const requestId = randomUUID();
  writeRelayRequest(job.relayDirectory, RelayFormatUtil.requestOf(requestId, command));
  const lookup = await answeredReplyOf(job, requestId);
  if (lookup === null) {
    context.standardOutput(OperationRefusalWordingUtil.relayQueuedMessageOf(requestId));
    throw new RelayConcluded(0);
  }
  if (lookup.verdict === 'malformed') {
    throw new OperationRefusal('unrepaired', { kind: 'malformed-relay-reply', replyFilePath: relayReplyFilePathOf(job.relayDirectory, requestId) });
  }
  const { reply } = lookup;
  if (reply.outcome === 'refused') throw new OperationRefusal(reply.status, reply.detail);
  context.standardOutput(OperationRefusalWordingUtil.relayAnsweredMessageOf(requestId, reply.outcome, reply.ticketIds));
  throw new RelayConcluded(0);
}

/** Returns at once outside a job; under one it never returns, ending the verb through `RelayConcluded` or a refusal. */
export async function relayWhenUnderJob(context: CommandContext, command: ControlCommand): Promise<void> {
  if (context.job === undefined) return;
  await relay(context, context.job, command);
}

export function refusalIsRelayConcluded(thrown: unknown): thrown is RelayConcluded {
  return thrown instanceof RelayConcluded;
}
