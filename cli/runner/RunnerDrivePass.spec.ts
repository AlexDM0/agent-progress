/**
 * The DrivePass on a scratch tracker with the fake agent, end to end through the pinned host bundle. What matters: a readied ticket gets a
 * `launching` job and a host running the fake child in one pass; a relay request and the `result` of the turn that wrote it, read in one
 * pass, are applied request first; a request in another job's folder, or naming a job, is refused and a replay is never applied twice;
 * a pass with nothing changed does not run, however late; and the notices are derived each pass, never stored. Beside the runner, a
 * written verb nudges a live lease's URL once its write is stored and is silent when nobody answers, and `ticket deliver --by-hand`
 * records only, refused while a lease is live or a job of the ticket is.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { relayReplyFilePathOf, writeRelayRequest }                         from '../../src/adapters/relay/RelayFolder.ts';
import { UsageMarkerFile }                                                 from '../../src/adapters/usage-marker/UsageMarkerFile.ts';
import { hostFilesOf }                                                     from '../../src/lib/agent-host/HostFiles.ts';
import type { HostRecord }                                                 from '../../src/lib/agent-host/HostRecord.ts';
import type { AgentAdapter }                                               from '../../src/lib/agent-launch/AgentAdapter.ts';
import { identityOf, sameProcess }                                         from '../../src/lib/process-identity/ProcessIdentity.ts';
import type { Board }                                                      from '../../src/lib/tracker-model/Board.ts';
import { createDrivePass, type DrivePass }                                 from '../../src/services/runner/DrivePass.ts';
import { HOST_ENTRY_PATH, HostBundle }                                     from '../../src/services/runner/HostBundle.ts';
import { HostFleet }                                                       from '../../src/services/runner/HostFleet.ts';
import { RelayInbox }                                                      from '../../src/services/runner/RelayInbox.ts';
import { runnerFilesIn }                                                   from '../../src/services/runner/RunnerFiles.ts';
import { RunnerLease }                                                     from '../../src/services/runner/RunnerLease.ts';
import { requireWorkspace }                                                from '../../src/services/tracker/Workspace.ts';
import { fakeAgentAdapter, fakeResultLine, fakeStartedLine }               from '../../src/testing/FakeAgentAdapter.ts';
import { createScratchDirectory, currentBranchOf, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { createCapturedCommandContext }                                    from '../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository }                              from '../testing/InitializedScratchRepository.ts';
import { fileReadyTicket }                                                 from '../testing/ReadyTicketFiling.ts';
import { runCommandLineWithRunnerMoves }                                   from '../testing/RunnerTicketMoves.ts';
import { storedLogTextOf }                                                 from '../testing/StoredLogText.ts';
import { storedProgressOf }                                                from '../testing/StoredProgress.ts';

const SPEC_CLOCK = (): Date => new Date('2026-09-18T20:11:03Z');
const HOST_WAIT_TRIES = 200;
const HOST_WAIT_MILLISECONDS = 50;
const PASS_TEST_TIMEOUT_MILLISECONDS = 30_000;
/** Room for a running pass to finish and every Watcher's claim to be waited for. */
const TEARDOWN_TIMEOUT_MILLISECONDS = 30_000;

let repositoryDirectory = '';
let monitorFolder = '';
let runnerLog: string[] = [];
const drivePassesOfThisTest: DrivePass[] = [];
let currentTeardown = { started: false };
let wakesInProgress = 0;
const LAUNCH_FILE_PATTERN = /^launch-(\d+)\.json$/;

async function run(commandLineArguments: readonly string[]) {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: SPEC_CLOCK });
  const exitCode = await runCommandLineWithRunnerMoves(commandLineArguments, context);
  expect(exitCode, `\`${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

const SPEC_STAMP = '2026-09-18T22:11:03+02:00';

async function drivePassWith(
  adapter: AgentAdapter,
  afterHoldPhase?: (phase: string, board: Board) => void,
  clock: { stamp: string } = { stamp: SPEC_STAMP },
): Promise<DrivePass> {
  const teardownOfThisTest = currentTeardown;
  const workspace = requireWorkspace(repositoryDirectory);
  const { runnerDirectory } = runnerFilesIn(workspace.trackerDirectory);
  mkdirSync(runnerDirectory, { recursive: true });
  const acquisition = RunnerLease.acquire(runnerDirectory, {
    processId:                process.pid,
    processStartEpochSeconds: 1,
    bootIdentity:             'example-boot',
    port:                     1,
    url:                      'http://127.0.0.1:1/',
    tokenFile:                join(runnerDirectory, 'token'),
    codeVersion:              'code-example',
    installVersion:           1,
    hostProtocolVersion:      1,
  });
  if (acquisition.verdict !== 'acquired') throw new Error('the scratch lease was not acquired');
  const hostBundlePath = await HostBundle.pinHostBundle({ runnerDirectory, codeVersion: 'code-example', entryPath: HOST_ENTRY_PATH });
  const drivePass = createDrivePass({
    workspace,
    now:                   () => new Date(Date.parse(clock.stamp)),
    formatStamp:           () => clock.stamp,
    runnerDirectory,
    generation:            acquisition.generation,
    hostBundlePath,
    codeVersion:           'code-example',
    agentAdapter:          adapter,
    monitorFolder,
    inheritedEnvironment:  {},
    mainLine:              currentBranchOf(repositoryDirectory),
    managedBlockMarker:    '<!-- example-managed-block -->',
    installVersionChanged: () => false,
    decisionWordingOf:     () => ({ questions: [], context: '' }),
    launchTextOf:          () => ({ firstMessage: 'Example first message', roleBrief: 'Example role' }),
    assistantChatTextOf:   (facts) => `Example chat ${facts.sequence}`,
    windDownMessage:       'Example wind-down message',
    resumeMessage:         'Example resume message',
    answerMessageOf:       (answer) => `Example answers ${JSON.stringify(answer)}`,
    homeDirectory:         monitorFolder,
    log:                   (line) => runnerLog.push(line),
    onLeaseTakenOver:      () => runnerLog.push('taken over'),
    ...(afterHoldPhase === undefined ? {} : { afterHoldPhase }),
  });
  // A test that timed out while the bundle was pinned arrives here after its teardown, so its pass never runs.
  if (teardownOfThisTest.started) await drivePass.stop();
  else drivePassesOfThisTest.push(drivePass);
  return {
    ...drivePass,
    wake: (forced) => {
      wakesInProgress += 1;
      try {
        drivePass.wake(forced);
      } finally {
        wakesInProgress -= 1;
      }
    },
  };
}

async function passOnce(drivePass: DrivePass, forced = true): Promise<void> {
  drivePass.wake(forced);
  await drivePass.idle();
}

function jobFolder(jobId: string): string {
  return HostFleet.jobFolderOf(requireWorkspace(repositoryDirectory).trackerDirectory, jobId);
}

async function untilHostEnded(jobId: string, instance: number): Promise<void> {
  for (let attempt = 0; attempt < HOST_WAIT_TRIES; attempt += 1) {
    if (HostFleet.livenessOf(jobFolder(jobId), instance).verdict === 'ended') return;
    await Bun.sleep(HOST_WAIT_MILLISECONDS);
  }
  throw new Error(`host ${instance} of ${jobId} never ended: ${runnerLog.join('\n')}`);
}

/** The policy boots the runner's orchestrator beside the build, so the build's job id is looked up rather than assumed. */
function buildJobId(): string {
  const buildJob = (storedProgressOf(repositoryDirectory).jobs ?? []).find((job) => job.kind === 'build');
  if (buildJob === undefined) throw new Error(`no build job was launched: ${runnerLog.join('\n')}`);
  return buildJob.id;
}

/** A session that starts and then waits on its stdin past the runner's first message, so its host stays live until the spec ends it. */
const WAITING_SESSION = fakeAgentAdapter([{ kind: 'print', line: fakeStartedLine('fake-session') }, { kind: 'await-line' }, { kind: 'await-line' }]);

/**
 * Each job's log ends up holding the runner's first message and the session's started line, in either order; once both are there and
 * read, with the host live, a `WAITING_SESSION` job's log stops changing until the spec acts.
 */
function everyJobHasReadItsWholeStart(): boolean {
  const jobs = storedProgressOf(repositoryDirectory).jobs ?? [];
  return jobs.length > 0 && jobs.every((job) => {
    const folder = jobFolder(job.id);
    const entries = HostFleet.eventsAfter(folder, job.hostInstance, 0);
    if (entries === 'malformed' || job.state !== 'running' || HostFleet.livenessOf(folder, job.hostInstance).verdict !== 'live') return false;
    const origins = new Set(entries.map((entry) => entry.origin));
    const cursorIsAtTheEnd = job.eventCursor.instance === job.hostInstance && job.eventCursor.sequence === entries.at(-1)?.sequence;
    return origins.has('client') && origins.has('agent') && cursorIsAtTheEnd;
  });
}

/** Every folder under `folder` holding a launch file: a job's agent hosts and, nested in it, its process hosts. */
function hostFoldersUnder(folder: string): string[] {
  const entries = readdirSync(folder, { withFileTypes: true });
  const holdsALaunch = entries.some((entry) => entry.isFile() && LAUNCH_FILE_PATTERN.test(entry.name));
  const nested = entries.filter((entry) => entry.isDirectory()).flatMap((entry) => hostFoldersUnder(join(folder, entry.name)));
  return holdsALaunch ? [folder, ...nested] : nested;
}

/** A Watcher spawned in the last pass may not have claimed its instance yet, so its record is waited for rather than read once. */
async function claimedRecordOf(hostFolder: string, instance: number): Promise<HostRecord | null> {
  for (let attempt = 0; attempt < HOST_WAIT_TRIES; attempt += 1) {
    const record = HostFleet.hostRecordOf(hostFolder, instance);
    if (record !== null) return record;
    await Bun.sleep(HOST_WAIT_MILLISECONDS);
  }
  return null;
}

function killQuietly(target: number): void {
  try {
    process.kill(target, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/**
 * Every Watcher a launch file was written for is ended, then its child's process group, so no fake session outlives the spec. The Watcher
 * goes first, so it cannot spawn a child after its record was read; a process id that now names another process is left alone.
 */
async function endEveryHost(repositoryOfThisTest: string): Promise<void> {
  const jobsFolder = join(requireWorkspace(repositoryOfThisTest).trackerDirectory, 'jobs');
  if (!existsSync(jobsFolder)) return;
  for (const hostFolder of hostFoldersUnder(jobsFolder)) {
    const instances = readdirSync(hostFolder).flatMap((name) => LAUNCH_FILE_PATTERN.exec(name)?.slice(1).map(Number) ?? []);
    for (const instance of instances) {
      const claimed = await claimedRecordOf(hostFolder, instance);
      const watcher = claimed?.host ?? null;
      const current = watcher === null ? null : identityOf(watcher.processId);
      if (watcher !== null && current !== null && sameProcess(current, watcher)) killQuietly(watcher.processId);
      const childProcessGroupId = HostFleet.hostRecordOf(hostFolder, instance)?.childProcessGroupId;
      if (childProcessGroupId !== undefined) killQuietly(-childProcessGroupId);
    }
  }
}

function relayDirectory(jobId: string): string {
  return RelayInbox.relayDirectoryOf(repositoryDirectory, jobId);
}

function lowFinding(requestId: string, title: string): Parameters<typeof writeRelayRequest>[1] {
  return {
    relayFormatVersion: 1,
    requestId,
    command:            {
      kind:          'ticket-add',
      title,
      type:          'bug',
      priority:      'low',
      dependsOn:     [],
      epics:         [],
      network:       [],
      introducedBy:  null,
      foundInReview: null,
      bodyText:      null,
    }
  };
}

beforeEach(async () => {
  currentTeardown = { started: false };
  repositoryDirectory = await createInitializedScratchRepository('drive-pass', ['--project', 'Example Agency'], SPEC_CLOCK);
  monitorFolder = createScratchDirectory('h');
  runnerLog = [];
  await run(['gate', 'add', 'checks', '--', 'true']);
  await run(['run', 'resume']);
  await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Export the example roles']);
});

// A timed-out test's passes are stopped, and a wake the teardown interrupted (Bun ticks inside a sync spawn) waited out, before removal;
// the folders are taken before the first await, so a late teardown never ends the next test's hosts or folders.
afterEach(async () => {
  currentTeardown.started = true;
  const repositoryOfThisTest = repositoryDirectory;
  const monitorFolderOfThisTest = monitorFolder;
  const drivePasses = drivePassesOfThisTest.splice(0);
  await Promise.all(drivePasses.map(async (drivePass) => await drivePass.stop()));
  while (wakesInProgress > 0) await Bun.sleep(HOST_WAIT_MILLISECONDS);
  await Promise.all(drivePasses.map(async (drivePass) => await drivePass.idle()));
  await endEveryHost(repositoryOfThisTest);
  removeScratchDirectory(monitorFolderOfThisTest);
  removeScratchDirectory(repositoryOfThisTest);
}, TEARDOWN_TIMEOUT_MILLISECONDS);

/** A build job launches, prepares its worktree, then runs: forced passes until its session's host is spawned. */
async function passUntilBuildSessionSpawned(drivePass: DrivePass): Promise<void> {
  for (let attempt = 0; attempt < HOST_WAIT_TRIES; attempt += 1) {
    await passOnce(drivePass);
    const buildJob = (storedProgressOf(repositoryDirectory).jobs ?? []).find((job) => job.kind === 'build');
    if (buildJob !== undefined && HostFleet.livenessOf(jobFolder(buildJob.id), 1).verdict !== 'unclaimed') return;
    await Bun.sleep(HOST_WAIT_MILLISECONDS);
  }
  throw new Error(`the build session was never spawned: ${runnerLog.join('\n')}\n${JSON.stringify(storedProgressOf(repositoryDirectory).jobs)}`);
}

describe('one pass', () => {
  test('one wake carries a readied ticket\'s job from launching through its prepared worktree to running, and its session a host running the fake child', async () => {
    const drivePass = await drivePassWith(fakeAgentAdapter());
    await passOnce(drivePass);
    expect((storedProgressOf(repositoryDirectory).jobs ?? []).find((job) => job.id === buildJobId())).toMatchObject({
      kind: 'build', role: 'builder', ticketIds: ['001'], state: 'running', hostInstance: 1
    });
    await passUntilBuildSessionSpawned(drivePass);
    await untilHostEnded(buildJobId(), 1);
    expect(readFileSync(hostFilesOf(jobFolder(buildJobId()), 1).eventLogPath, 'utf8')).toContain(JSON.stringify(fakeStartedLine('fake-session')));
    expect(existsSync(join(relayDirectory(buildJobId()), 'requests'))).toBe(true);
  }, PASS_TEST_TIMEOUT_MILLISECONDS);

  test('a relay request and the result of the turn that wrote it, read in one pass, are applied request first', async () => {
    const phases: { phase: string; jobState: string | undefined; findingFiled: boolean }[] = [];
    const recordPhase = (phase: string, board: Board): void => {
      const buildJob = board.jobs().find((job) => job.kind === 'build');
      const jobId = buildJob?.id;
      phases.push({ phase, jobState: buildJob?.state, findingFiled: board.tickets().some((ticket) => ticket.frontmatter.filedByJob === jobId) });
    };
    const drivePass = await drivePassWith(fakeAgentAdapter([
      { kind: 'print', line: fakeStartedLine('fake-session') },
      { kind: 'print', line: fakeResultLine({ outcome: 'built' }) },
      { kind: 'exit', code: 0 },
    ]), recordPhase);
    await passUntilBuildSessionSpawned(drivePass);
    const firstBuildJobId = buildJobId();
    await untilHostEnded(firstBuildJobId, 1);
    writeRelayRequest(relayDirectory(firstBuildJobId), lowFinding('request-1', 'Example finding beside the build'));
    phases.length = 0;
    await passOnce(drivePass);
    // The report names no head, so verification in the same hold fails the pass and the policy launches attempt 2, which filed nothing;
    // the passes that carry attempt 2 on follow in the same wake.
    expect(phases.slice(0, 3), runnerLog.join('\n')).toEqual([
      { phase: 'relayed-commands', jobState: 'running', findingFiled: true },
      { phase: 'host-events', jobState: 'verifying', findingFiled: true },
      { phase: 'lifecycle', jobState: 'launching', findingFiled: false },
    ]);
    expect(JSON.parse(readFileSync(relayReplyFilePathOf(relayDirectory(firstBuildJobId), 'request-1'), 'utf8'))).toMatchObject({ outcome: 'done' });
  }, PASS_TEST_TIMEOUT_MILLISECONDS);
});

describe('the relay inbox', () => {
  test('a request naming a job of its own is refused, a replay is never applied twice, and an unknown job\'s folder is not read', async () => {
    const drivePass = await drivePassWith(WAITING_SESSION);
    await passOnce(drivePass);
    const jobId = buildJobId();
    writeRelayRequest(relayDirectory(jobId), { ...lowFinding('request-forged', 'Forged finding'), jobId: 'J7' } as never);
    writeRelayRequest(relayDirectory(jobId), lowFinding('request-1', 'Example finding'));
    writeRelayRequest(relayDirectory('J9'), lowFinding('request-9', 'Finding in a folder no job owns'));
    await passOnce(drivePass);
    expect(JSON.parse(readFileSync(relayReplyFilePathOf(relayDirectory(jobId), 'request-forged'), 'utf8')))
      .toMatchObject({ outcome: 'refused', detail: { kind: 'relay-identity-mismatch', requestId: 'request-forged', jobId } });
    expect(existsSync(relayReplyFilePathOf(relayDirectory('J9'), 'request-9'))).toBe(false);

    rmSync(relayReplyFilePathOf(relayDirectory(jobId), 'request-1'));
    await passOnce(drivePass);
    const appliedRecords = storedLogTextOf(repositoryDirectory).split('\n').filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { kind: string; fields: unknown }).filter((entry) => entry.kind === 'relay-applied');
    expect(appliedRecords.map((entry) => entry.fields)).toEqual([
      { requestId: 'request-1', commandKind: 'ticket-add', outcome: 'done' },
      { requestId: 'request-forged', commandKind: 'unread', outcome: 'refused' },
    ]);
    expect(storedProgressOf(repositoryDirectory).tasks.length).toBeGreaterThan(0);
  }, PASS_TEST_TIMEOUT_MILLISECONDS);

  test('a request of a relay format this runner does not read stays pending, unanswered and unlogged, for the runner a handover brings', async () => {
    const drivePass = await drivePassWith(WAITING_SESSION);
    await passOnce(drivePass);
    const jobId = buildJobId();
    writeRelayRequest(relayDirectory(jobId), { ...lowFinding('request-newer', 'Finding in a newer relay format'), relayFormatVersion: 2 } as never);
    writeRelayRequest(relayDirectory(jobId), lowFinding('request-1', 'Example finding'));
    await passOnce(drivePass);
    await passOnce(drivePass);
    expect(existsSync(relayReplyFilePathOf(relayDirectory(jobId), 'request-newer'))).toBe(false);
    expect(existsSync(relayReplyFilePathOf(relayDirectory(jobId), 'request-1'))).toBe(true);
    expect(storedLogTextOf(repositoryDirectory)).not.toContain('request-newer');
  }, PASS_TEST_TIMEOUT_MILLISECONDS);
});

describe('waking', () => {
  test('an unforced wake with nothing changed runs no pass, however late, and wakes during a pass coalesce into one more', async () => {
    const drivePass = await drivePassWith(WAITING_SESSION);
    await passOnce(drivePass);
    for (let attempt = 0; attempt < HOST_WAIT_TRIES && !everyJobHasReadItsWholeStart(); attempt += 1) {
      await Bun.sleep(HOST_WAIT_MILLISECONDS);
      await passOnce(drivePass, false);
    }
    expect(everyJobHasReadItsWholeStart(), runnerLog.join('\n')).toBe(true);
    const settled = drivePass.state().passes;
    await passOnce(drivePass, false);
    expect(drivePass.state().passes).toBe(settled);

    writeRelayRequest(relayDirectory(buildJobId()), lowFinding('request-1', 'Example finding'));
    drivePass.wake();
    drivePass.wake();
    drivePass.wake();
    await drivePass.idle();
    expect(drivePass.state().passes).toBe(settled + 1);
  }, PASS_TEST_TIMEOUT_MILLISECONDS);

  test('the notices are derived each pass from git and the runtime state and never stored', async () => {
    writeFileSync(join(repositoryDirectory, 'CLAUDE.md'), '<!-- example-managed-block -->\n');
    await Bun.$`git -C ${repositoryDirectory} add CLAUDE.md`.quiet();
    await Bun.$`git -C ${repositoryDirectory} -c user.name=Example -c user.email=example@example.com commit -q -m Example`.quiet();
    const drivePass = await drivePassWith(fakeAgentAdapter());
    await passOnce(drivePass);
    expect(drivePass.state().notices).toEqual([{ kind: 'claude-md-block-committed', target: currentBranchOf(repositoryDirectory) }]);
    expect(readFileSync(join(repositoryDirectory, '.agent-progress-v2', 'progress.json'), 'utf8')).not.toContain('claude-md-block-committed');

    writeFileSync(join(repositoryDirectory, 'CLAUDE.md'), '# Example conventions\n');
    await passOnce(drivePass, true);
    expect(drivePass.state().notices, 'the block is removed but not yet committed: launches still wait').toHaveLength(1);
    await Bun.$`git -C ${repositoryDirectory} -c user.name=Example -c user.email=example@example.com commit -q -am Example`.quiet();
    await passOnce(drivePass, true);
    expect(drivePass.state().notices, 'the notice clears once the removal is committed').toEqual([]);
  }, PASS_TEST_TIMEOUT_MILLISECONDS);
});

async function runRefused(commandLineArguments: readonly string[]): Promise<string> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: SPEC_CLOCK });
  const exitCode = await runCommandLineWithRunnerMoves(commandLineArguments, context);
  expect(exitCode, `\`${commandLineArguments.join(' ')}\` was not refused: ${context.outputText()}`).toBe(1);
  return `${context.outputText()}\n${context.errorText()}`;
}

/** A lease naming this very process, so it reads as live, its URL the given one. */
function acquireLiveLease(url: string): { runnerDirectory: string; generation: number } {
  const { runnerDirectory } = runnerFilesIn(requireWorkspace(repositoryDirectory).trackerDirectory);
  mkdirSync(runnerDirectory, { recursive: true });
  const identity = identityOf(process.pid);
  if (identity === null) throw new Error('this process has no readable identity');
  const acquisition = RunnerLease.acquire(runnerDirectory, {
    processId:                identity.processId,
    processStartEpochSeconds: identity.startEpochSeconds,
    bootIdentity:             identity.bootIdentity,
    port:                     Number(new URL(url).port),
    url,
    tokenFile:                join(runnerDirectory, 'token'),
    codeVersion:              'code-example',
    installVersion:           1,
    hostProtocolVersion:      1,
  });
  if (acquisition.verdict !== 'acquired') throw new Error('the live lease was not acquired');
  return { runnerDirectory, generation: acquisition.generation };
}

function deliveredRecordsOf(ticketId: string): unknown[] {
  return storedLogTextOf(repositoryDirectory).split('\n').filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { kind: string; ticketId?: string; fields: unknown })
    .filter((entry) => entry.kind === 'ticket-delivered' && entry.ticketId === ticketId).map((entry) => entry.fields);
}

/** A `rate_limit_event` as Claude Code prints it: `status` is the top level, which alone refuses requests. */
function rateLimitLine(topLevelStatus: string, window: string, windowStatus: string): string {
  return JSON.stringify({
    type:            'rate_limit_event',
    rate_limit_info: {
      status: topLevelStatus, resetsAt: 1793142034, rateLimitType: window, unifiedWindows: { [window]: { utilization: 1, resetsAt: 1793142034, status: windowStatus } },
    },
  });
}

const USAGE_RESET_STAMP = new Date(1793142034000).toISOString();

async function passUntilBuildJobIs(drivePass: DrivePass, state: string): Promise<void> {
  for (let attempt = 0; attempt < HOST_WAIT_TRIES; attempt += 1) {
    await passOnce(drivePass);
    if ((storedProgressOf(repositoryDirectory).jobs ?? []).some((job) => job.kind === 'build' && job.state === state)) return;
    await Bun.sleep(HOST_WAIT_MILLISECONDS);
  }
  throw new Error(`the build job never became ${state}: ${runnerLog.join('\n')}\n${JSON.stringify(storedProgressOf(repositoryDirectory).jobs)}`);
}

describe('usage limits', () => {
  test('a top-level rejected limit interrupts the job uncounted, marks the machine, logs it and stops the host; nothing resumes before the reset', async () => {
    const drivePass = await drivePassWith(fakeAgentAdapter([
      { kind: 'print', line: fakeStartedLine('fake-session') },
      { kind: 'print', line: rateLimitLine('rejected', 'five_hour', 'rejected') },
      {
        kind: 'print',
        line: JSON.stringify({
          type: 'result', subtype: 'error_during_execution', is_error: true, permission_denials: []
        })
      },
      { kind: 'await-line' },
    ]));
    await passUntilBuildSessionSpawned(drivePass);
    const jobId = buildJobId();
    await passUntilBuildJobIs(drivePass, 'interrupted');
    expect((storedProgressOf(repositoryDirectory).jobs ?? []).find((job) => job.id === jobId)).toMatchObject({
      state: 'interrupted', interruption: 'usage-limit', crashResumes: 0, hostInstance: 1
    });
    const usageLimitHit = { kind: 'usage-limit-hit', jobId, fields: { window: 'five_hour', resetsAt: USAGE_RESET_STAMP } };
    expect(storedLogTextOf(repositoryDirectory)).toContain(JSON.stringify(usageLimitHit).slice(1));
    expect(storedLogTextOf(repositoryDirectory)).not.toContain(`"kind":"job-ended","jobId":"${jobId}"`);
    expect(UsageMarkerFile.read(monitorFolder)).toMatchObject({
      verdict: 'read',
      marker:  { vendor: 'fake-agent', window: 'five_hour', resetsAt: USAGE_RESET_STAMP }
    });
    await untilHostEnded(jobId, 1);
    await passOnce(drivePass);
    await passOnce(drivePass);
    expect((storedProgressOf(repositoryDirectory).jobs ?? []).filter((job) => job.kind === 'build')).toMatchObject([{ id: jobId, state: 'interrupted', hostInstance: 1 }]);
    expect((storedProgressOf(repositoryDirectory).jobs ?? []).some((job) => job.kind === 'orchestrator')).toBe(false);
  }, PASS_TEST_TIMEOUT_MILLISECONDS);

  test('once the marker\'s reset has passed the interrupted job resumes by id in a new host instance', async () => {
    const drivePass = await drivePassWith(fakeAgentAdapter([
      { kind: 'print', line: fakeStartedLine('fake-session') },
      { kind: 'print', line: rateLimitLine('rejected', 'five_hour', 'rejected') },
      { kind: 'await-line' },
    ]));
    await passUntilBuildSessionSpawned(drivePass);
    const jobId = buildJobId();
    await passUntilBuildJobIs(drivePass, 'interrupted');
    await untilHostEnded(jobId, 1);
    UsageMarkerFile.write(monitorFolder, {
      vendor: 'fake-agent', window: 'five_hour', resetsAt: '2026-09-18T20:00:00.000Z', seenBy: { trackerId: 'example', jobId }
    });
    await passOnce(drivePass);
    expect((storedProgressOf(repositoryDirectory).jobs ?? []).find((job) => job.id === jobId)).toMatchObject({ state: 'running', hostInstance: 2 });
    expect(storedLogTextOf(repositoryDirectory)).toContain(`"kind":"job-resumed","jobId":"${jobId}","fields":{"hostInstance":2,"cause":"usage-limit"}`);
    expect(readFileSync(hostFilesOf(jobFolder(jobId), 2).launchPath, 'utf8')).toContain('fake-agent-scenario.json');
  }, PASS_TEST_TIMEOUT_MILLISECONDS);

  test('the runner wakes a pass of its own at the marker\'s reset, which resumes the interrupted job with no other wake', async () => {
    const clock = { stamp: SPEC_STAMP };
    const drivePass = await drivePassWith(fakeAgentAdapter([
      { kind: 'print', line: fakeStartedLine('fake-session') },
      { kind: 'print', line: rateLimitLine('rejected', 'five_hour', 'rejected') },
      { kind: 'await-line' },
    ]), undefined, clock);
    await passUntilBuildSessionSpawned(drivePass);
    const jobId = buildJobId();
    await passUntilBuildJobIs(drivePass, 'interrupted');
    await untilHostEnded(jobId, 1);
    UsageMarkerFile.write(monitorFolder, {
      vendor: 'fake-agent', window: 'five_hour', resetsAt: '2026-09-18T20:11:03.300Z', seenBy: { trackerId: 'example', jobId }
    });
    await passOnce(drivePass);
    expect((storedProgressOf(repositoryDirectory).jobs ?? []).find((job) => job.id === jobId)).toMatchObject({ state: 'interrupted', hostInstance: 1 });
    clock.stamp = '2026-09-18T22:11:04+02:00';
    for (let attempt = 0; attempt < HOST_WAIT_TRIES; attempt += 1) {
      await drivePass.idle();
      if ((storedProgressOf(repositoryDirectory).jobs ?? []).some((job) => job.id === jobId && job.hostInstance === 2)) break;
      await Bun.sleep(HOST_WAIT_MILLISECONDS);
    }
    expect((storedProgressOf(repositoryDirectory).jobs ?? []).find((job) => job.id === jobId)).toMatchObject({ hostInstance: 2 });
  }, PASS_TEST_TIMEOUT_MILLISECONDS);

  test('a per-window warning, or a window rejected under an allowed top level, interrupts nothing and writes no marker', async () => {
    const drivePass = await drivePassWith(fakeAgentAdapter([
      { kind: 'print', line: fakeStartedLine('fake-session') },
      { kind: 'print', line: rateLimitLine('allowed_warning', 'seven_day', 'allowed_warning') },
      { kind: 'print', line: rateLimitLine('allowed', 'five_hour', 'rejected') },
      { kind: 'await-line' },
    ]));
    await passUntilBuildSessionSpawned(drivePass);
    const jobId = buildJobId();
    for (let attempt = 0; attempt < HOST_WAIT_TRIES && !readFileSync(hostFilesOf(jobFolder(jobId), 1).eventLogPath, 'utf8').includes('"allowed"'); attempt += 1) {
      await Bun.sleep(HOST_WAIT_MILLISECONDS);
    }
    await passOnce(drivePass);
    expect((storedProgressOf(repositoryDirectory).jobs ?? []).find((job) => job.id === jobId)?.state).toBe('running');
    expect(UsageMarkerFile.read(monitorFolder)).toEqual({ verdict: 'absent' });
    expect(storedLogTextOf(repositoryDirectory)).not.toContain('usage-limit-hit');
  }, PASS_TEST_TIMEOUT_MILLISECONDS);
});

describe('the verbs beside a runner', () => {
  test('a written verb nudges the live lease\'s URL body-less once its write is stored, and stays silent when nobody answers', async () => {
    const nudges: { method: string; path: string; body: string; writeWasStored: boolean }[] = [];
    const fakeRunner = Bun.serve({
      port:  0,
      fetch: async (request) => {
        const writeWasStored = storedLogTextOf(repositoryDirectory).includes('Example milestone');
        nudges.push({
          method: request.method, path: new URL(request.url).pathname, body: await request.text(), writeWasStored
        });
        return Response.json({ outcome: 'done' });
      },
    });
    try {
      acquireLiveLease(fakeRunner.url.href);
      await run(['log', 'Example milestone']);
      expect(nudges).toEqual([{
        method: 'POST', path: '/api/nudge', body: '', writeWasStored: true
      }]);
    } finally {
      await fakeRunner.stop(true);
    }
    const unanswered = await run(['log', 'Example milestone nobody hears']);
    expect(unanswered.errorText()).toBe('');
  }, PASS_TEST_TIMEOUT_MILLISECONDS);

  test('ticket deliver --by-hand is refused runner-owns-the-lifecycle while a lease is live, and records byHand once none is', async () => {
    const lease = acquireLiveLease('http://127.0.0.1:1/');
    expect(await runRefused(['ticket', 'deliver', '001', '--by-hand'])).toContain('A runner drives this board at http://127.0.0.1:1/');
    expect(deliveredRecordsOf('001')).toEqual([]);

    RunnerLease.release(lease.runnerDirectory, lease.generation);
    await run(['ticket', 'deliver', '001', '--by-hand']);
    expect(deliveredRecordsOf('001')).toEqual([{ byHand: true }]);
    expect(storedProgressOf(repositoryDirectory).jobs ?? []).toEqual([]);
  }, PASS_TEST_TIMEOUT_MILLISECONDS);

  test('ticket deliver --by-hand is refused ticket-has-live-job while a job of the ticket is on the board', async () => {
    const drivePass = await drivePassWith(WAITING_SESSION);
    await passOnce(drivePass);
    expect(await runRefused(['ticket', 'deliver', '001', '--by-hand'])).toContain(`Ticket #001 has job ${buildJobId()} live (running)`);
    expect(deliveredRecordsOf('001')).toEqual([]);
  }, PASS_TEST_TIMEOUT_MILLISECONDS);
});
