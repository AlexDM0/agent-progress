/** Maps a control command to the relay's request and reads requests and replies back, refusing a request that claims an identity. */
import type { ControlCommand }         from '../../../shared/@types/ControlCommand.ts';
import type { OperationRefusalStatus } from '../../../shared/OperationRefusal.ts';
import type {
  RelayFormatVersion,
  RelayReply,
  RelayReplyReading,
  RelayRequest,
  RelayRequestReading
} from '../@types/RelayFormat.ts';

const RELAY_FORMAT_VERSION: RelayFormatVersion = 1;

/** Fields only the runner may decide: who sent the request, and what its admission stamped. */
const IDENTITY_FIELDS = ['jobId', 'role'] as const;

const ADMISSION_FIELD = 'admission';

const REFUSAL_STATUSES: readonly OperationRefusalStatus[] = ['refused', 'unrepaired'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function carriesIdentity(record: Record<string, unknown>): boolean {
  return IDENTITY_FIELDS.some((field) => Object.hasOwn(record, field));
}

function bodyTextOf(command: ControlCommand): string | null {
  if (command.kind !== 'ticket-add' && command.kind !== 'ticket-edit' && command.kind !== 'epic-add') return null;
  return command.bodyText;
}

function requestOf(requestId: string, command: ControlCommand): RelayRequest {
  const bodyText = bodyTextOf(command);
  if (bodyText === null) return { relayFormatVersion: RELAY_FORMAT_VERSION, requestId, command };
  const commandWithoutBody = command.kind === 'epic-add' ? { ...command, bodyText: '' } : { ...command, bodyText: null };
  return {
    relayFormatVersion: RELAY_FORMAT_VERSION, requestId, command: commandWithoutBody, bodyText
  };
}

function commandWithBody(command: Record<string, unknown>, bodyText: unknown): Record<string, unknown> | null {
  if (bodyText === undefined) return command;
  if (typeof bodyText !== 'string' || !Object.hasOwn(command, 'bodyText')) return null;
  return { ...command, bodyText };
}

/**
 * Checks only what the relay owns: the version, the request id, that the command is an object of a named kind, and that neither the
 * request nor its command claims an identity or an admission. Whether the kind is one the role may run is `RoleCommandPolicy`'s.
 */
function requestReadingOf(text: string): RelayRequestReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { verdict: 'refused', reason: 'malformed-relay-request' };
  }
  if (!isRecord(parsed)) return { verdict: 'refused', reason: 'malformed-relay-request' };
  const { command, requestId } = parsed;
  if (!isRecord(command)) return { verdict: 'refused', reason: 'malformed-relay-request' };
  if (carriesIdentity(parsed) || carriesIdentity(command) || Object.hasOwn(command, ADMISSION_FIELD)) {
    return { verdict: 'refused', reason: 'relay-identity-mismatch' };
  }
  if (parsed['relayFormatVersion'] !== RELAY_FORMAT_VERSION || typeof requestId !== 'string' || requestId === '' || typeof command['kind'] !== 'string') {
    return { verdict: 'refused', reason: 'malformed-relay-request' };
  }
  const restoredCommand = commandWithBody(command, parsed['bodyText']);
  if (restoredCommand === null) return { verdict: 'refused', reason: 'malformed-relay-request' };
  // The kind and its fields are checked by the policy and the applier; the relay only carries them.
  return { verdict: 'read', requestId, command: restoredCommand as unknown as ControlCommand };
}

function replyReadingOf(text: string): RelayReplyReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { verdict: 'malformed' };
  }
  if (!isRecord(parsed) || parsed['relayFormatVersion'] !== RELAY_FORMAT_VERSION || typeof parsed['requestId'] !== 'string') return { verdict: 'malformed' };
  const { outcome, ticketIds } = parsed;
  if (outcome === 'done' || outcome === 'nothing-to-do') {
    if (!Array.isArray(ticketIds) || !ticketIds.every((ticketId) => typeof ticketId === 'string')) return { verdict: 'malformed' };
    return { verdict: 'read', reply: parsed as unknown as RelayReply };
  }
  const statusIsKnown = REFUSAL_STATUSES.some((status) => status === parsed['status']);
  if (outcome !== 'refused' || !statusIsKnown || !isRecord(parsed['detail']) || typeof parsed['detail']['kind'] !== 'string') return { verdict: 'malformed' };
  return { verdict: 'read', reply: parsed as unknown as RelayReply };
}

export const RelayFormatUtil = Object.freeze({
  requestOf,
  requestReadingOf,
  replyReadingOf,
});
