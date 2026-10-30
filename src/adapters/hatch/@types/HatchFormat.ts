/**
 * The Hatch's two stored formats: the request a session under a job writes for a mutating verb, and the reply the Overseer writes back.
 * A request names no job and no role: identity comes from the Hatch folder's job record, so a request carrying either is refused.
 */
import type { ControlCommand }                                 from '../../../shared/@types/ControlCommand.ts';
import type { OperationRefusalDetail, OperationRefusalStatus } from '../../../shared/OperationRefusal.ts';

export type HatchFormatVersion = 1;

/** A ticket or epic body travels beside the command rather than inside it, read before relaying as a direct run reads it. */
export interface HatchRequest {
  hatchFormatVersion: HatchFormatVersion;
  requestId:          string;
  command:            ControlCommand;
  bodyText?:          string;
}

export type HatchReply =
  | { hatchFormatVersion: HatchFormatVersion; requestId: string; outcome: 'done' | 'nothing-to-do'; ticketIds: string[] }
  | { hatchFormatVersion: HatchFormatVersion; requestId: string; outcome: 'refused'; status: OperationRefusalStatus; detail: OperationRefusalDetail };

export type HatchRequestReading =
  | { verdict: 'read'; requestId: string; command: ControlCommand }
  | { verdict: 'refused'; reason: 'hatch-identity-mismatch' | 'malformed-hatch-request' };

export type HatchReplyReading = { verdict: 'read'; reply: HatchReply } | { verdict: 'malformed' };
