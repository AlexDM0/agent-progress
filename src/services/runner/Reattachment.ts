/**
 * What a starting runner does before its first pass, design sections 3.6 and 7.3: each live job's newest host instance is attached with
 * `hello` from the stored cursor, a dead host's surviving child group is killed (identity-checked) so no orphan outlives it, a host never
 * claimed is named for its re-spawn under the same instance, and a worktree folder no job or branch owns is named for User.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync
}                           from 'node:fs';
import { createConnection } from 'node:net';
import { join }             from 'node:path';

import type { HistoryFrame, HostFrame }        from '../../lib/agent-host/@types/HostFrame.ts';
import type { EventLogEntry }                  from '../../lib/agent-host/EventLog.ts';
import { hostFilesOf }                         from '../../lib/agent-host/HostFiles.ts';
import { readHostLaunch }                      from '../../lib/agent-host/HostLaunch.ts';
import { HOST_PROTOCOL_VERSION }               from '../../lib/agent-host/constants/HostProtocol.ts';
import { writeFileAtomically }                 from '../../lib/atomic-file/AtomicFile.ts';
import { GitProcess }                          from '../../lib/git/GitProcess.ts';
import { identityOf, signalProcessGroup }      from '../../lib/process-identity/ProcessIdentity.ts';
import type { InterruptionCause, Job }         from '../../lib/tracker-model/@types/Job.ts';
import { PRODUCT_NAMES }                       from '../../shared/constants/ProductNames.ts';
import { REATTACH_HELLO_TIMEOUT_MILLISECONDS } from '../../shared/constants/RunnerLimits.ts';
import { requireProgressFile }                 from '../tracker/TrackerReader.ts';
import type { Workspace }                      from '../tracker/Workspace.ts';
import { GroupWorktrees }                      from './GroupWorktrees.ts';
import { HostFleet }                           from './HostFleet.ts';
import { JobLaunch }                           from './JobLaunch.ts';
import { LegacyHostReader }                    from './LegacyHostReader.ts';

export interface HostReattached {
  jobId:           string;
  instance:        number;
  /** What the host's `history` answered past the stored cursor; `null` when the host never answered, its event log then read alone. */
  replayedEntries: readonly EventLogEntry[] | null;
}

export interface ReattachmentReport {
  attached:          HostReattached[];
  /** Live hosts on a protocol below the supported window: watch only, their events read from their files by each pass. */
  legacyHosts:       { jobId: string; instance: number; protocolVersion: number }[];
  lost:              { jobId: string; instance: number; cause: InterruptionCause }[];
  /** Jobs whose current instance was never claimed: the first pass spawns that same instance, and the exclusive claim lets one run. */
  respawnJobIds:     string[];
  leftoverWorktrees: string[];
}

/** The runner's own folders under the worktrees root: the sessions' working folders and the jobs' relay folders, one per job. */
const RUNNER_OWNED_FOLDERS: ReadonlySet<string> = new Set(['sessions', 'relay']);

const WORKTREE_LINE_PREFIX = 'worktree ';
const BRANCH_LINE_PREFIX   = 'branch ';

function lostCauseFileOf(jobFolder: string, instance: number): string {
  return join(jobFolder, `host-${instance}.lost-cause`);
}

function storedLostCauseOf(jobFolder: string, instance: number): InterruptionCause | null {
  try {
    return readFileSync(lostCauseFileOf(jobFolder, instance), 'utf8').trim() as InterruptionCause;
  } catch {
    return null;
  }
}

/**
 * A lost host's cause, settled once and stored beside its record, so a runner dying after the kill reads the same cause again. A foreign
 * boot is a reboot; a recorded child group still alive, its leader living or not, is killed as a group, never by its pid alone, and the
 * host is the one lost; otherwise the agent crashed with it.
 */
function settleLostHost(jobFolder: string, instance: number): InterruptionCause {
  const stored = storedLostCauseOf(jobFolder, instance);
  if (stored !== null) return stored;
  const record      = HostFleet.hostRecordOf(jobFolder, instance);
  const currentBoot = identityOf(process.pid)?.bootIdentity ?? null;
  const recordedBoot = record?.host?.bootIdentity ?? record?.childProcess?.bootIdentity ?? null;
  let cause: InterruptionCause = 'agent-crashed';
  if (recordedBoot !== null && recordedBoot !== currentBoot) cause = 'reboot';
  else if (record?.childProcess !== undefined && record.childProcess !== null) {
    if (signalProcessGroup(record.childProcess, 'SIGKILL').verdict === 'signalled') cause = 'host-lost';
  }
  writeFileAtomically(lostCauseFileOf(jobFolder, instance), `${cause}\n`);
  return cause;
}

function historyFrameOf(line: string): HistoryFrame | 'refused' | null {
  try {
    const frame = JSON.parse(line) as HostFrame;
    if (frame.kind === 'refused') return 'refused';
    return frame.kind === 'history' ? frame : null;
  } catch {
    return null;
  }
}

/** Says `hello` from the cursor and answers the `history` the host replays; `null` when it refuses or never answers. */
async function helloHistoryOf(jobFolder: string, instance: number, sinceSequence: number): Promise<readonly EventLogEntry[] | null> {
  const reading = readHostLaunch(hostFilesOf(jobFolder, instance).launchPath);
  if (reading.verdict !== 'read') return null;
  const { socketPath, hostSecret } = reading.launch;
  return await new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let buffered = '';
    const settle = (entries: readonly EventLogEntry[] | null): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(entries);
    };
    const timer = setTimeout(() => settle(null), REATTACH_HELLO_TIMEOUT_MILLISECONDS);
    socket.once('error', () => settle(null));
    socket.once('close', () => settle(null));
    socket.on('data', (chunk) => {
      buffered += chunk.toString('utf8');
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        const frame = historyFrameOf(line);
        if (frame === 'refused') settle(null);
        else if (frame !== null) settle(frame.entries);
      }
    });
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({
        kind: 'hello', protocolVersion: HOST_PROTOCOL_VERSION, sinceSequence, hostSecret
      })}\n`);
    });
  });
}

function canonicalPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The folders `git worktree list` shows checked out on a branch. */
function branchOwnedWorktreesOf(repositoryRoot: string): Set<string> {
  const listing = GitProcess.run(repositoryRoot, ['worktree', 'list', '--porcelain']);
  const owned = new Set<string>();
  if (!GitProcess.succeeded(listing)) return owned;
  let worktree: string | null = null;
  for (const line of listing.standardOutput.split('\n')) {
    if (line.startsWith(WORKTREE_LINE_PREFIX)) worktree = canonicalPathOf(line.slice(WORKTREE_LINE_PREFIX.length));
    if (line.startsWith(BRANCH_LINE_PREFIX) && worktree !== null) owned.add(worktree);
  }
  return owned;
}

function leftoverWorktreesOf(workspace: Workspace, jobs: readonly Readonly<Job>[]): string[] {
  const worktreesRoot = join(workspace.rootDirectory, PRODUCT_NAMES.WORKTREES_FOLDER);
  if (!existsSync(worktreesRoot)) return [];
  const refreshOwned = jobs.filter((job) => job.kind === 'refresh' && job.target !== null).map((job) => GroupWorktrees.refreshWorktreeOf(worktreesRoot, job.target ?? ''));
  const jobOwned     = new Set([...jobs.filter(JobLaunch.isWorktreeJob).map((job) => JobLaunch.worktreeOf(workspace, job)), ...refreshOwned].map(canonicalPathOf));
  const branchOwned = branchOwnedWorktreesOf(workspace.rootDirectory);
  return readdirSync(worktreesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !RUNNER_OWNED_FOLDERS.has(entry.name))
    .map((entry) => canonicalPathOf(join(worktreesRoot, entry.name)))
    .filter((folder) => !jobOwned.has(folder) && !branchOwned.has(folder))
    .sort();
}

function awaitsItsSpawn(job: Readonly<Job>): boolean {
  return (job.state === 'launching' && !JobLaunch.isWorktreeJob(job)) || job.state === 'running';
}

/** Reads and acts outside the lock; the first pass's one hold then applies everything it found. */
async function reattach(workspace: Workspace): Promise<ReattachmentReport> {
  const jobs   = requireProgressFile(workspace).jobs ?? [];
  const report: ReattachmentReport = {
    attached: [], legacyHosts: [], lost: [], respawnJobIds: [], leftoverWorktrees: leftoverWorktreesOf(workspace, jobs)
  };
  for (const job of jobs.filter((candidate) => candidate.role !== null)) {
    const jobFolder = HostFleet.jobFolderOf(workspace.trackerDirectory, job.id);
    const liveness  = HostFleet.livenessOf(jobFolder, job.hostInstance);
    const record    = HostFleet.hostRecordOf(jobFolder, job.hostInstance);
    if (liveness.verdict === 'live' && record !== null && LegacyHostReader.attachmentOf(record) === 'legacy-host') {
      report.legacyHosts.push({ jobId: job.id, instance: job.hostInstance, protocolVersion: record.protocolVersion });
    } else if (liveness.verdict === 'live') {
      const sinceSequence = job.eventCursor.instance === job.hostInstance ? job.eventCursor.sequence : 0;
      report.attached.push({ jobId: job.id, instance: job.hostInstance, replayedEntries: await helloHistoryOf(jobFolder, job.hostInstance, sinceSequence) });
    } else if (liveness.verdict === 'lost') {
      report.lost.push({ jobId: job.id, instance: job.hostInstance, cause: settleLostHost(jobFolder, job.hostInstance) });
    } else if (liveness.verdict === 'unclaimed' && awaitsItsSpawn(job)) {
      report.respawnJobIds.push(job.id);
    }
  }
  return report;
}

export const Reattachment = Object.freeze({ reattach, settleLostHost, leftoverWorktreesOf });
