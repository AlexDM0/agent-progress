/**
 * The relay's two stored formats: the request a session under a job writes for a mutating verb, and the reply the runner writes back.
 * A request names no job and no role: identity comes from the relay folder's job record, so a request carrying either is refused.
 */
import type { ControlCommand }                                 from '../../../shared/@types/ControlCommand.ts';
import type { OperationRefusalDetail, OperationRefusalStatus } from '../../../shared/OperationRefusal.ts';

export type RelayFormatVersion = 1;

/** A ticket or epic body travels beside the command rather than inside it, read before relaying as a direct run reads it. */
export interface RelayRequest {
  relayFormatVersion: RelayFormatVersion;
  requestId:          string;
  command:            ControlCommand;
  bodyText?:          string;
}

export type RelayReply =
  | { relayFormatVersion: RelayFormatVersion; requestId: string; outcome: 'done' | 'nothing-to-do'; ticketIds: string[] }
  | { relayFormatVersion: RelayFormatVersion; requestId: string; outcome: 'refused'; status: OperationRefusalStatus; detail: OperationRefusalDetail };

export type RelayRequestReading =
  | { verdict: 'read'; requestId: string; command: ControlCommand }
  | { verdict: 'refused'; reason: 'relay-identity-mismatch' | 'malformed-relay-request' };

export type RelayReplyReading = { verdict: 'read'; reply: RelayReply } | { verdict: 'malformed' };
