/**
 * Settling a lost Watcher's cause against real process groups. What matters is that the recorded child group is killed whenever it is still
 * the recorded one, including once its leader has exited while members live on (the Watcher is then the one lost), and that a group whose
 * recorded leader id now belongs to an unrelated process, alive or as the members of a reused group, is never signalled.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { identityOf, processIsGone, type ProcessIdentity } from '../../lib/process-identity/ProcessIdentity.ts';
import { watcherFilesOf }                                  from '../../lib/watcher/WatcherFiles.ts';
import { createScratchDirectory, removeScratchDirectory }  from '../../testing/ScratchWorkspace.ts';
import { Regrouping }                                      from './Regrouping.ts';

const PROCESS_GONE_POLLS         = 100;
const POLL_INTERVAL_MILLISECONDS = 50;
const WATCHER_INSTANCE              = 1;

const scratchDirectories: string[] = [];
const lingeringProcessIds: number[] = [];

afterEach(() => {
  for (const processId of lingeringProcessIds.splice(0)) {
    if (!processIsGone(processId)) process.kill(processId, 'SIGKILL');
  }
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function identityOrThrow(processId: number): ProcessIdentity {
  const identity = identityOf(processId);
  if (identity === null) throw new Error(`process ${processId} has no readable identity`);
  return identity;
}

async function waitUntilGone(processId: number): Promise<boolean> {
  for (let poll = 0; poll < PROCESS_GONE_POLLS; poll++) {
    if (processIsGone(processId)) return true;
    await Bun.sleep(POLL_INTERVAL_MILLISECONDS);
  }
  return false;
}

/** A detached shell leading its own group, whose `sleep` child would outlive it; both pids are cleaned up after the case. */
async function spawnGroupWithLingeringChild(): Promise<{ leader: Bun.Subprocess<'ignore', 'pipe', 'ignore'>; childProcessId: number }> {
  const leader = Bun.spawn(['/bin/sh', '-c', 'sleep 60 & echo $!; wait'], {
    detached: true, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore'
  });
  const { value } = await leader.stdout.getReader().read();
  const childProcessId = Number(new TextDecoder().decode(value).trim());
  lingeringProcessIds.push(leader.pid, childProcessId);
  return { leader, childProcessId };
}

/** A lost Watcher's job folder whose record names the given child, the Watcher itself unrecorded so the boot is read from the child. */
function jobFolderRecording(childProcess: ProcessIdentity): string {
  const scratchDirectory = createScratchDirectory('regrouping');
  scratchDirectories.push(scratchDirectory);
  const jobFolder = join(scratchDirectory, 'J1');
  mkdirSync(jobFolder, { recursive: true });
  writeFileSync(watcherFilesOf(jobFolder, WATCHER_INSTANCE).watcherRecordPath, `${JSON.stringify({
    protocolVersion: 1, eventLogFormatVersion: 1, watcherInstance: WATCHER_INSTANCE, state: 'running', watcher: null, childProcess, childProcessGroupId: childProcess.processId,
  })}\n`);
  return jobFolder;
}

describe('settling a lost watcher', () => {
  test('a recorded child whose leader exited while a member of its group lives: the group is signalled and the Watcher judged lost', async () => {
    const { leader, childProcessId } = await spawnGroupWithLingeringChild();
    const jobFolder = jobFolderRecording(identityOrThrow(leader.pid));
    process.kill(leader.pid, 'SIGKILL');
    await leader.exited;
    expect(processIsGone(childProcessId)).toBe(false);
    expect(Regrouping.settleLostWatcher(jobFolder, WATCHER_INSTANCE)).toBe('watcher-lost');
    expect(await waitUntilGone(childProcessId)).toBe(true);
  });

  test('a recorded leader id now held by an unrelated live process: nothing is signalled and the agent reads as crashed', async () => {
    const { leader, childProcessId } = await spawnGroupWithLingeringChild();
    const current = identityOrThrow(leader.pid);
    const jobFolder = jobFolderRecording({ ...current, startEpochSeconds: current.startEpochSeconds - 1 });
    expect(Regrouping.settleLostWatcher(jobFolder, WATCHER_INSTANCE)).toBe('agent-crashed');
    expect(processIsGone(leader.pid)).toBe(false);
    expect(processIsGone(childProcessId)).toBe(false);
  });

  test('a recorded leader id reused by a group whose members predate the recorded leader: nothing is signalled', async () => {
    const { leader, childProcessId } = await spawnGroupWithLingeringChild();
    const current = identityOrThrow(leader.pid);
    const jobFolder = jobFolderRecording({ ...current, startEpochSeconds: current.startEpochSeconds + 60 });
    process.kill(leader.pid, 'SIGKILL');
    await leader.exited;
    expect(Regrouping.settleLostWatcher(jobFolder, WATCHER_INSTANCE)).toBe('agent-crashed');
    expect(processIsGone(childProcessId)).toBe(false);
  });
});
