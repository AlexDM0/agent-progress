/** A release refusal carries the reason `release --json` prints beside its wording. */
import type { ReleaseRefusalReason }                     from '../../../src/shared/@types/ReleaseRefusalReason.ts';
import { OperationRefusal, type OperationRefusalStatus } from '../../../src/shared/OperationRefusal.ts';

export class ReleaseRefusal extends OperationRefusal {
  readonly reason: ReleaseRefusalReason;

  constructor(status: OperationRefusalStatus, reason: ReleaseRefusalReason, message: string) {
    super(status, message);
    this.reason = reason;
  }
}

export function refuseTheRelease(reason: ReleaseRefusalReason, message: string): never {
  throw new ReleaseRefusal('refused', reason, `${message} Nothing was changed.`);
}
