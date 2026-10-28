/**
 * The launch file a host reads once after its claim: what to run, where and with which environment. An agent host pipes the child's stdin;
 * a process host gives it none and answers nothing. Keys a later protocol adds are left unread.
 */
import { readFileSync } from 'node:fs';

import type { StandingReply }    from './StandingReplies.ts';
import { HOST_PROTOCOL_VERSION } from './constants/HostProtocol.ts';

export type HostKind = 'agent' | 'process';

export interface HostLaunch {
  readonly kind:             HostKind;
  /** Spawned directly, with no shell. */
  readonly argv:             readonly string[];
  /** The child's whole environment: nothing of the host's is inherited. */
  readonly environment:      Readonly<Record<string, string>>;
  readonly workingDirectory: string;
  readonly standingReplies:  readonly StandingReply[];
  readonly protocolVersion:  number;
}

export type HostLaunchReading =
  | { readonly verdict: 'read'; readonly launch: HostLaunch }
  | { readonly verdict: 'unreadable'; readonly reason: string };

const HOST_KINDS: readonly string[] = ['agent', 'process'] satisfies readonly HostKind[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecordOf(value: unknown, holdsItem: (item: unknown) => boolean): boolean {
  return isRecord(value) && Object.values(value).every(holdsItem);
}

function isStandingReply(value: unknown): value is StandingReply {
  const isCondition = (item: unknown): boolean => typeof item === 'string' || typeof item === 'boolean';
  return isRecord(value)
    && isRecordOf(value['whenAllEqual'], isCondition)
    && isRecordOf(value['whenNoneEqual'], isCondition)
    && typeof value['replyTemplate'] === 'string';
}

export function hostLaunchOf(launchText: string): HostLaunchReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(launchText);
  } catch (error) {
    return { verdict: 'unreadable', reason: `the launch file is not JSON: ${String(error)}` };
  }
  if (!isRecord(parsed)) return { verdict: 'unreadable', reason: 'the launch file is not a JSON object' };
  const {
    kind, argv, environment, workingDirectory, standingReplies, protocolVersion
  } = parsed;
  if (typeof kind !== 'string' || !HOST_KINDS.includes(kind)) return { verdict: 'unreadable', reason: 'kind is neither agent nor process' };
  if (!isStringList(argv) || argv.length === 0) return { verdict: 'unreadable', reason: 'argv is not a non-empty list of strings' };
  if (!isRecordOf(environment, (item) => typeof item === 'string')) return { verdict: 'unreadable', reason: 'environment is not a record of strings' };
  if (typeof workingDirectory !== 'string') return { verdict: 'unreadable', reason: 'workingDirectory is not a string' };
  if (!Array.isArray(standingReplies) || !standingReplies.every(isStandingReply)) return { verdict: 'unreadable', reason: 'standingReplies is not a list of rules' };
  if (protocolVersion !== HOST_PROTOCOL_VERSION) return { verdict: 'unreadable', reason: `protocolVersion ${String(protocolVersion)} is not ${HOST_PROTOCOL_VERSION}` };
  return {
    verdict: 'read',
    launch:  {
      kind:        kind as HostKind,
      argv,
      environment: environment as Record<string, string>,
      workingDirectory,
      standingReplies,
      protocolVersion,
    },
  };
}

export function readHostLaunch(launchPath: string): HostLaunchReading {
  try {
    return hostLaunchOf(readFileSync(launchPath, 'utf8'));
  } catch (error) {
    return { verdict: 'unreadable', reason: `the launch file cannot be read: ${String(error)}` };
  }
}
