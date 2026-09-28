/** A release refusal carries the reason `release --json` prints beside its wording, and on `merge-refused` the files that blocked the merge. */
import type { ReleaseRefusalReason }                     from '../../../src/shared/@types/ReleaseRefusalReason.ts';
import { OperationRefusal, type OperationRefusalStatus } from '../../../src/shared/OperationRefusal.ts';

export class ReleaseRefusal extends OperationRefusal {
  readonly reason:        ReleaseRefusalReason;
  readonly blockingFiles: readonly string[];

  constructor(status: OperationRefusalStatus, reason: ReleaseRefusalReason, message: string, blockingFiles: readonly string[] = []) {
    super(status, message);
    this.reason        = reason;
    this.blockingFiles = blockingFiles;
  }
}

export function refuseTheRelease(reason: ReleaseRefusalReason, message: string, blockingFiles: readonly string[] = []): never {
  throw new ReleaseRefusal('refused', reason, `${message} Nothing was changed.`, blockingFiles);
}
