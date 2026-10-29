/**
 * Process identity against real processes. What matters is that an identity read under one timezone equals one read under another (the
 * stamp is read in UTC whatever the caller's TZ), that equality catches a reused pid and a changed boot, that a gone process has no
 * identity, and that a process group is signalled only while its leader is still the recorded process or, once the leader is gone, while
 * it has members none of which predates the recorded leader: the group kill stops a child that a kill of the leader alone leaves running,
 * and an empty or recycled group is never signalled.
 */
import { describe, expect, test } from 'bun:test';

import {
  identityOf,
  processIsGone,
  sameProcess,
  signalProcessGroup,
  startEpochSecondsOf,
  type ProcessIdentity
} from './ProcessIdentity.ts';

const PROCESS_GONE_POLLS = 100;
const POLL_INTERVAL_MILLISECONDS = 50;
const START_TOLERANCE_SECONDS = 5;

const IDENTITY_MODULE_PATH = new URL('./ProcessIdentity.ts', import.meta.url).pathname;

function identityOrThrow(processId: number): ProcessIdentity {
  const identity = identityOf(processId);
  if (identity === null) throw new Error(`process ${processId} has no readable identity`);
  return identity;
}

/** Read in a child process whose own TZ is the one named, so the caller's timezone is the variable under test. */
function identityReadUnderTimezone(processId: number, timezone: string): unknown {
  const script = `import { identityOf } from ${JSON.stringify(IDENTITY_MODULE_PATH)}; console.log(JSON.stringify(identityOf(${processId})));`;
  const finished = Bun.spawnSync([process.execPath, '-e', script], { env: { TZ: timezone, LC_ALL: 'nl_NL.UTF-8' }, stdout: 'pipe', stderr: 'pipe' });
  return JSON.parse(finished.stdout.toString());
}

async function waitUntilGone(processId: number): Promise<boolean> {
  for (let poll = 0; poll < PROCESS_GONE_POLLS; poll++) {
    if (processIsGone(processId)) return true;
    await Bun.sleep(POLL_INTERVAL_MILLISECONDS);
  }
  return false;
}

/** A group leader (a detached shell) whose `sleep` child would outlive it; answers both pids. */
async function spawnGroupWithLingeringChild(): Promise<{ leader: Bun.Subprocess<'ignore', 'pipe', 'ignore'>; childProcessId: number }> {
  const leader = Bun.spawn(['/bin/sh', '-c', 'sleep 60 & echo $!; wait'], {
    detached: true, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore'
  });
  const { value } = await leader.stdout.getReader().read();
  return { leader, childProcessId: Number(new TextDecoder().decode(value).trim()) };
}

describe('reading an identity', () => {
  test('a ps start stamp printed in UTC reads as its epoch seconds, and anything else as null', () => {
    expect(startEpochSecondsOf('Wed Oct 28 01:51:25 2026')).toBe(1793152285);
    expect(startEpochSecondsOf('Wed Oct  8 01:51:25 2026    ')).toBe(1791424285);
    expect(startEpochSecondsOf('woe 28 okt 01:51:25 2026')).toBeNull();
    expect(startEpochSecondsOf('')).toBeNull();
  });

  test('this process has an identity: its pid, a whole start second and a boot identity', () => {
    const identity = identityOrThrow(process.pid);
    expect(identity.processId).toBe(process.pid);
    expect(Number.isInteger(identity.startEpochSeconds)).toBe(true);
    expect(identity.bootIdentity).not.toBe('');
  });

  test('an identity read under one timezone and locale equals one read under another', () => {
    const ownIdentity = identityOrThrow(process.pid);
    expect(identityReadUnderTimezone(process.pid, 'Pacific/Kiritimati')).toEqual(ownIdentity);
    expect(identityReadUnderTimezone(process.pid, 'America/Los_Angeles')).toEqual(ownIdentity);
  });

  // Without TZ=UTC, ps prints the machine's local time, which read as UTC is off by the zone's offset.
  test('a process started now reads a start within seconds of the wall clock, whatever the machine\'s own timezone', async () => {
    const spawnedEpochSeconds = Math.floor(Date.now() / 1000);
    const sleeper             = Bun.spawn(['/bin/sleep', '30']);
    try {
      const { startEpochSeconds } = identityOrThrow(sleeper.pid);
      expect(Math.abs(startEpochSeconds - spawnedEpochSeconds)).toBeLessThanOrEqual(START_TOLERANCE_SECONDS);
    } finally {
      sleeper.kill();
      await sleeper.exited;
    }
  });

  test('a process that has exited has no identity and reads as gone; a pid that addresses a group never does', async () => {
    const exited = Bun.spawn(['/bin/sh', '-c', 'exit 0']);
    await exited.exited;
    expect(identityOf(exited.pid)).toBeNull();
    expect(processIsGone(exited.pid)).toBe(true);
    expect(identityOf(0)).toBeNull();
    expect(processIsGone(0)).toBe(false);
    expect(processIsGone(-1)).toBe(false);
    expect(processIsGone(process.pid)).toBe(false);
  });
});

describe('comparing identities', () => {
  const recorded: ProcessIdentity = { processId: 4242, startEpochSeconds: 1793152285, bootIdentity: 'EXAMPLE-BOOT-A' };

  test('the same triple is the same process', () => {
    expect(sameProcess(recorded, { ...recorded })).toBe(true);
  });

  test('a reused pid, started later, is another process', () => {
    expect(sameProcess(recorded, { ...recorded, startEpochSeconds: recorded.startEpochSeconds + 1 })).toBe(false);
  });

  test('the same pid and start after a reboot is another process', () => {
    expect(sameProcess(recorded, { ...recorded, bootIdentity: 'EXAMPLE-BOOT-B' })).toBe(false);
  });

  test('another pid is another process', () => {
    expect(sameProcess(recorded, { ...recorded, processId: recorded.processId + 1 })).toBe(false);
  });
});

describe('signalling a process group', () => {
  test('killing the leader alone leaves its child running, and the group kill still reaches what is left of it', async () => {
    const { leader, childProcessId } = await spawnGroupWithLingeringChild();
    const leaderIdentity = identityOrThrow(leader.pid);
    try {
      process.kill(leader.pid, 'SIGKILL');
      await leader.exited;
      expect(processIsGone(childProcessId)).toBe(false);
      expect(signalProcessGroup(leaderIdentity, 'SIGKILL')).toEqual({ verdict: 'signalled' });
      expect(await waitUntilGone(childProcessId)).toBe(true);
    } finally {
      if (!processIsGone(childProcessId)) process.kill(childProcessId, 'SIGKILL');
    }
  });

  test('a group whose leader is gone and which has no members left is not signalled', async () => {
    const { leader, childProcessId } = await spawnGroupWithLingeringChild();
    const leaderIdentity = identityOrThrow(leader.pid);
    process.kill(-leader.pid, 'SIGKILL');
    await leader.exited;
    expect(await waitUntilGone(childProcessId)).toBe(true);
    expect(signalProcessGroup(leaderIdentity, 'SIGKILL')).toEqual({ verdict: 'group-gone' });
  });

  test.each([
    ['a member started before the recorded leader', (identity: ProcessIdentity) => ({ ...identity, startEpochSeconds: identity.startEpochSeconds + 60 })],
    ['the recorded leader started in another boot', (identity: ProcessIdentity) => ({ ...identity, bootIdentity: 'EXAMPLE-BOOT-OTHER' })],
  ])('a leaderless group is read as recycled and not signalled when %s', async (_case, recordOf) => {
    const { leader, childProcessId } = await spawnGroupWithLingeringChild();
    const recordedLeader = recordOf(identityOrThrow(leader.pid));
    try {
      process.kill(leader.pid, 'SIGKILL');
      await leader.exited;
      expect(signalProcessGroup(recordedLeader, 'SIGKILL')).toEqual({ verdict: 'group-recycled' });
      expect(processIsGone(childProcessId)).toBe(false);
    } finally {
      process.kill(childProcessId, 'SIGKILL');
    }
  });

  test('the group kill, after the leader\'s identity is checked, stops both the leader and its child', async () => {
    const { leader, childProcessId } = await spawnGroupWithLingeringChild();
    expect(signalProcessGroup(identityOrThrow(leader.pid), 'SIGKILL')).toEqual({ verdict: 'signalled' });
    await leader.exited;
    expect(processIsGone(leader.pid)).toBe(true);
    expect(await waitUntilGone(childProcessId)).toBe(true);
  });

  test('a leader whose identity no longer matches the record is not signalled', async () => {
    const { leader, childProcessId } = await spawnGroupWithLingeringChild();
    const currentIdentity = identityOrThrow(leader.pid);
    try {
      const reusedPidRecord = { ...currentIdentity, startEpochSeconds: currentIdentity.startEpochSeconds - 1 };
      expect(signalProcessGroup(reusedPidRecord, 'SIGKILL')).toEqual({ verdict: 'identity-mismatch', currentIdentity });
      expect(processIsGone(leader.pid)).toBe(false);
      expect(processIsGone(childProcessId)).toBe(false);
    } finally {
      process.kill(-leader.pid, 'SIGKILL');
      await leader.exited;
    }
  });
});
