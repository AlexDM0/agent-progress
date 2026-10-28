/**
 * Protocol 1's lines: a client line read as a frame, a host frame written as a line. A line that is no frame reads as `null`, which the
 * host answers as a protocol refusal.
 */
import type { ClientFrame, HostFrame } from './@types/HostFrame.ts';

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function clientFrameOf(line: string): ClientFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const frame = parsed as Record<string, unknown>;
  switch (frame['kind']) {
    case 'hello': {
      const { protocolVersion, sinceSequence, hostSecret } = frame;
      if (!Number.isSafeInteger(protocolVersion) || !isNonNegativeInteger(sinceSequence) || typeof hostSecret !== 'string') return null;
      return {
        kind: 'hello', protocolVersion: protocolVersion as number, sinceSequence, hostSecret
      };
    }
    case 'write':
      return typeof frame['line'] === 'string' && !frame['line'].includes('\n') ? { kind: 'write', line: frame['line'] } : null;
    case 'close-input':
      return { kind: 'close-input' };
    case 'stop':
      return isNonNegativeInteger(frame['graceMilliseconds']) ? { kind: 'stop', graceMilliseconds: frame['graceMilliseconds'] } : null;
    default:
      return null;
  }
}

export function hostFrameLineOf(frame: HostFrame): string {
  return `${JSON.stringify(frame)}\n`;
}
