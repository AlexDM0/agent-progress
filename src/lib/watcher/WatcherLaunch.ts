/**
 * The launch file a Watcher reads once after its claim: what to run, where and with which environment. A Watcher pipes the child's stdin;
 * a process Watcher gives it none and answers nothing. Keys a later protocol adds are left unread.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute }   from 'node:path';

import type { StandingReply }                                        from './StandingReplies.ts';
import { socketPathFits }                                            from './WatcherSocketPath.ts';
import { WATCHER_PROTOCOL_VERSION, WATCHER_SOCKET_PATH_LIMIT_BYTES } from './constants/WatcherProtocol.ts';

export type WatcherKind = 'agent' | 'process';

export interface WatcherLaunch {
  readonly kind:               WatcherKind;
  /** Spawned directly, with no shell. */
  readonly argv:               readonly string[];
  /** The child's whole environment: nothing of the Watcher's is inherited. */
  readonly environment:        Readonly<Record<string, string>>;
  readonly workingDirectory:   string;
  readonly standingReplies:    readonly StandingReply[];
  readonly protocolVersion:    number;
  /** Named in `welcome`, so a client knows which job it reached. */
  readonly jobId:              string;
  /** The code the Overseer pinned this Watcher to, recorded and named in `welcome`. */
  readonly watcherCodeVersion: string;
  readonly socketPath:         string;
  /** What a client's `hello` must carry; only the launch file holds it. */
  readonly watcherSecret:      string;
}

export type WatcherLaunchReading =
  | { readonly verdict: 'read'; readonly launch: WatcherLaunch }
  | { readonly verdict: 'unreadable'; readonly reason: string };

const WATCHER_KINDS: readonly string[] = ['agent', 'process'] satisfies readonly WatcherKind[];

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

export function watcherLaunchOf(launchText: string): WatcherLaunchReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(launchText);
  } catch (error) {
    return { verdict: 'unreadable', reason: `the launch file is not JSON: ${String(error)}` };
  }
  if (!isRecord(parsed)) return { verdict: 'unreadable', reason: 'the launch file is not a JSON object' };
  const {
    kind, argv, environment, workingDirectory, standingReplies, protocolVersion, jobId, watcherCodeVersion, socketPath, watcherSecret,
  } = parsed;
  if (typeof kind !== 'string' || !WATCHER_KINDS.includes(kind)) return { verdict: 'unreadable', reason: 'kind is neither agent nor process' };
  if (!isStringList(argv) || argv.length === 0) return { verdict: 'unreadable', reason: 'argv is not a non-empty list of strings' };
  if (!isRecordOf(environment, (item) => typeof item === 'string')) return { verdict: 'unreadable', reason: 'environment is not a record of strings' };
  if (typeof workingDirectory !== 'string') return { verdict: 'unreadable', reason: 'workingDirectory is not a string' };
  if (!Array.isArray(standingReplies) || !standingReplies.every(isStandingReply)) return { verdict: 'unreadable', reason: 'standingReplies is not a list of rules' };
  if (protocolVersion !== WATCHER_PROTOCOL_VERSION) return { verdict: 'unreadable', reason: `protocolVersion ${String(protocolVersion)} is not ${WATCHER_PROTOCOL_VERSION}` };
  if (typeof jobId !== 'string' || jobId === '') return { verdict: 'unreadable', reason: 'jobId is not a non-empty string' };
  if (typeof watcherCodeVersion !== 'string') return { verdict: 'unreadable', reason: 'watcherCodeVersion is not a string' };
  if (typeof socketPath !== 'string' || !isAbsolute(socketPath) || !socketPathFits(socketPath)) {
    return { verdict: 'unreadable', reason: `socketPath is not an absolute path under ${WATCHER_SOCKET_PATH_LIMIT_BYTES} bytes` };
  }
  if (typeof watcherSecret !== 'string' || watcherSecret === '') return { verdict: 'unreadable', reason: 'watcherSecret is not a non-empty string' };
  return {
    verdict: 'read',
    launch:  {
      kind:        kind as WatcherKind,
      argv,
      environment: environment as Record<string, string>,
      workingDirectory,
      standingReplies,
      protocolVersion,
      jobId,
      watcherCodeVersion,
      socketPath,
      watcherSecret,
    },
  };
}

export function readWatcherLaunch(launchPath: string): WatcherLaunchReading {
  try {
    return watcherLaunchOf(readFileSync(launchPath, 'utf8'));
  } catch (error) {
    return { verdict: 'unreadable', reason: `the launch file cannot be read: ${String(error)}` };
  }
}
