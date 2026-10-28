/**
 * The crash, reboot and update matrix, one row per scenario, each held against the mechanism that settles it; later mechanisms add their
 * rows here. What matters in these rows: a hold cut short after its journal is finished by the next holder before that holder reads, and a
 * holder whose lock was taken over writes nothing further, its committed journal replayed by its successor.
 *
 * The session, host, runner and reboot rows that need neither merge slots nor questions run a build job on a scratch repository, its
 * session the fake child: every crash is made by killing the host, the child's group or both, a reboot by also giving the host record a
 * foreign boot, and a runner restart by a fresh DrivePass reattaching. What matters there: an orphaned agent group is killed before the
 * resume, only the crash causes count toward the bound, a resume is by id in the same folder, and a finished session never continues. The
 * usage-limit row is held by `src/services/runner/UsageLimits.spec.ts` and `cli/runner/RunnerDrivePass.spec.ts`, the body-edit row by V6
 * in `src/services/lifecycle/JobVerification.spec.ts`.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
}                         from 'node:fs';
import { basename, join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { hostFilesOf }                                   from '../../lib/agent-host/HostFiles.ts';
import type { HostRecord }                               from '../../lib/agent-host/HostRecord.ts';
import type { AgentAdapter }                             from '../../lib/agent-launch/AgentAdapter.ts';
import { identityOf, sameProcess, type ProcessIdentity } from '../../lib/process-identity/ProcessIdentity.ts';
import type { Job }                                      from '../../lib/tracker-model/@types/Job.ts';
import type { Board }                                    from '../../lib/tracker-model/Board.ts';
import { refusalIsOperationRefusal }                     from '../../shared/OperationRefusal.ts';
import { LIMITS }                                        from '../../shared/constants/Limits.ts';
import { PRODUCT_NAMES }                                 from '../../shared/constants/ProductNames.ts';
import {
  fakeAgentAdapter,
  fakeAssistantTurnLine,
  type FakeAgentStep,
  fakeResultLine,
  fakeStartedLine
} from '../../testing/FakeAgentAdapter.ts';
import {
  createScratchDirectory,
  createScratchGitRepository,
  currentBranchOf,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                             from '../../testing/ToolGuard.ts';
import { EXAMPLE_TICKET_FILE_NAME, writeReadableTracker }       from '../../testing/TrackerFileFixtures.ts';
import { createRenderState }                                    from '../render/RenderState.ts';
import { holdJournalFilePathOf }                                from '../tracker/HoldJournal.ts';
import { LockGenerationSteps }                                  from '../tracker/TrackerLock.ts';
import { writeTracker, type TrackerChange }                     from '../tracker/TrackerPipeline.ts';
import { requireProgressFile }                                  from '../tracker/TrackerReader.ts';
import { workspacePathsFor, type Workspace }                    from '../tracker/Workspace.ts';
import { createDrivePass, type DrivePass, type JobLaunchFacts } from './DrivePass.ts';
import { HOST_ENTRY_PATH, HostBundle }                          from './HostBundle.ts';
import { HostFleet }                                            from './HostFleet.ts';
import { Reattachment }                                         from './Reattachment.ts';
import { runnerFilesIn }                                        from './RunnerFiles.ts';
import { RunnerLease }                                          from './RunnerLease.ts';

const CHANGED_AT = '2026-09-18T20:05:00+02:00';

const now = (): Date => new Date('2026-09-18T18:05:00Z');

const renderState = createRenderState();

let workspace: Workspace;

function ticketText(): string {
  return readFileSync(join(workspace.ticketsDirectory, EXAMPLE_TICKET_FILE_NAME), 'utf8');
}

function holdTheExampleTicket(change: TrackerChange): void {
  change.board.addTask({ name: 'Example cut-short row', startsNow: false, movesTheLink: false }, change.at);
  change.board.holdTicket('001', 'Waiting on Alex Example', change.at);
}

function noteAnExample(change: TrackerChange): void {
  change.board.recordNote('Example note of the next holder', change.at);
}

async function failureOf(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return null;
}

/** Takes the lock over as stale from inside the current hold, as a command arriving after the holder slept past the threshold would. */
function takeTheLockOver(): void {
  const payload  = { processId: process.pid, acquiredAt: CHANGED_AT };
  const takeover = LockGenerationSteps.attemptedAcquire(workspace.lockDirectoryPath, payload, now().getTime() + LIMITS.LOCK_STALE_MILLISECONDS + 1);
  if (takeover.verdict !== 'acquired') throw new Error(`the takeover found the lock ${takeover.verdict}`);
  LockGenerationSteps.release(workspace.lockDirectoryPath, takeover.generation, payload);
}

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('crash-matrix'));
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
  writeReadableTracker(workspace);
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

describe('crash between progress.json and the ticket files', () => {
  test('the next lock holder replays hold-journal.json, finishing the cut-short write before its own', async () => {
    const ticketBefore = ticketText();
    const crash        = new Error('the holder crashed');

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:               CHANGED_AT,
      now,
      renderState,
      mutate:           holdTheExampleTicket,
      afterFileWritten: (filePath) => { if (filePath === workspace.progressFilePath) throw crash; },
    }));
    expect(failure).toBe(crash);
    expect(readFileSync(workspace.progressFilePath, 'utf8')).toContain('Example cut-short row');
    expect(ticketText(), 'the board is torn: the ticket was not written').toBe(ticketBefore);

    const written = await writeTracker({
      workspace, at: CHANGED_AT, now, renderState, mutate: noteAnExample,
    });

    expect(ticketText()).toContain('Waiting on Alex Example');
    expect(written.board.tasks().map((task) => task.name)).toEqual(['Example cut-short row']);
    const loggedKinds = readFileSync(workspace.logFilePath, 'utf8').trimEnd().split('\n').map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(loggedKinds.at(-1)).toBe('note');
    expect(loggedKinds.length, 'the cut-short hold\'s records are in the log before the next holder\'s note').toBeGreaterThan(2);
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(false);
  });
});

describe('a stale holder resumes after a lock takeover', () => {
  test('taken over before its journal, it refuses lock-taken-over as unrepaired and writes nothing', async () => {
    const progressBefore = readFileSync(workspace.progressFilePath, 'utf8');

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
      mutate: (change) => {
        holdTheExampleTicket(change);
        takeTheLockOver();
      },
    }));

    expect(refusalIsOperationRefusal(failure) ? failure.status : null).toBe('unrepaired');
    expect(refusalIsOperationRefusal(failure) ? failure.detail?.kind : null).toBe('lock-taken-over');
    expect(readFileSync(workspace.progressFilePath, 'utf8')).toBe(progressBefore);
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(false);
  });

  test('taken over after its journal, it writes no further file, and its successor replays the committed hold', async () => {
    const ticketBefore = ticketText();

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:               CHANGED_AT,
      now,
      renderState,
      mutate:           holdTheExampleTicket,
      afterFileWritten: (filePath) => { if (filePath === workspace.progressFilePath) takeTheLockOver(); },
    }));

    expect(refusalIsOperationRefusal(failure) ? failure.detail?.kind : null).toBe('lock-taken-over');
    expect(ticketText()).toBe(ticketBefore);
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(true);

    await writeTracker({
      workspace, at: CHANGED_AT, now, renderState, mutate: noteAnExample,
    });

    expect(ticketText()).toContain('Waiting on Alex Example');
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(false);
  });
});

interface RecordedLaunch {
  jobId:            string;
  resume:           boolean;
  firstMessage:     string;
  workingDirectory: string;
  sessionId:        string;
}

interface SessionScenario {
  fresh:         readonly FakeAgentStep[];
  resumed:       readonly FakeAgentStep[];
  orchestrator?: readonly FakeAgentStep[];
}

const SESSION_STAMP          = '2026-09-18T22:11:03+02:00';
const RESUME_MESSAGE         = 'Example resume message';
const FOREIGN_BOOT           = 'example-foreign-boot';
const WAIT_TRIES             = 300;
const WAIT_MILLISECONDS      = 50;
const ROW_TIMEOUT_MILLISECONDS = 90_000;

const STARTED: FakeAgentStep = { kind: 'print', line: fakeStartedLine('fake-session') };
const WAITING_STEPS: readonly FakeAgentStep[] = [STARTED, { kind: 'await-line' }];
const CRASHING_STEPS: readonly FakeAgentStep[] = [STARTED, { kind: 'crash' }];
const LINE_THEN_WAITING_STEPS: readonly FakeAgentStep[] = [
  STARTED, { kind: 'await-line' }, { kind: 'print', line: fakeAssistantTurnLine('after-the-line') }, { kind: 'await-line' },
];

let repository = '';
let sessionWorkspace: Workspace;
let monitorFolder = '';
let launches: RecordedLaunch[] = [];
let launchFacts: { jobId: string; facts: JobLaunchFacts }[] = [];
let runnerLog: string[] = [];

/** The fake session, recording each worker launch; the orchestrator the policy boots beside the build only waits. */
function recordingAdapter(scenario: SessionScenario): AgentAdapter {
  return {
    ...fakeAgentAdapter(),
    planOf(request) {
      const isWorker = request.reportSchema !== null;
      if (isWorker) {
        launches.push({
          jobId:            basename(request.jobFilesDirectory),
          resume:           request.resume,
          firstMessage:     request.firstMessage,
          workingDirectory: request.workingDirectory,
          sessionId:        request.sessionId,
        });
      }
      const steps = isWorker ? (request.resume ? scenario.resumed : scenario.fresh) : scenario.orchestrator ?? WAITING_STEPS;
      return fakeAgentAdapter(steps).planOf(request);
    },
  };
}

/** A runner start: a newer lease generation and a fresh DrivePass, which the spec reattaches. */
async function startedRunner(adapter: AgentAdapter, afterHoldPhase?: (phase: string, board: Board) => void): Promise<DrivePass> {
  const { runnerDirectory } = runnerFilesIn(sessionWorkspace.trackerDirectory);
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
  return createDrivePass({
    workspace:             sessionWorkspace,
    renderState,
    now:                   () => new Date(Date.parse(SESSION_STAMP)),
    formatStamp:           () => SESSION_STAMP,
    runnerDirectory,
    generation:            acquisition.generation,
    hostBundlePath,
    codeVersion:           'code-example',
    agentAdapter:          adapter,
    monitorFolder,
    inheritedEnvironment:  {},
    mainLine:              currentBranchOf(repository),
    managedBlockMarker:    '<!-- example-managed-block -->',
    installVersionChanged: () => false,
    decisionWordingOf:     (draft) => ({
      questions: [{
        question: `Example ${draft.kind}?`, header: draft.kind, multiSelect: false, options: []
      }],
      context: ''
    }),
    launchTextOf: (job, facts) => {
      launchFacts.push({ jobId: job.id, facts });
      return { firstMessage: `Example first message of ${job.id}`, roleBrief: 'Example role' };
    },
    windDownMessage:  'Example wind-down message',
    resumeMessage:    RESUME_MESSAGE,
    homeDirectory:    monitorFolder,
    log:              (line) => runnerLog.push(line),
    onLeaseTakenOver: () => runnerLog.push('taken over'),
    ...(afterHoldPhase === undefined ? {} : { afterHoldPhase }),
  });
}

async function passOnce(drivePass: DrivePass): Promise<void> {
  drivePass.wake(true);
  await drivePass.idle();
}

function storedJobs(): readonly Readonly<Job>[] {
  return requireProgressFile(sessionWorkspace).jobs ?? [];
}

function buildJobs(): readonly Readonly<Job>[] {
  return storedJobs().filter((job) => job.kind === 'build');
}

function requireBuildJob(): Readonly<Job> {
  const [job] = buildJobs();
  if (job === undefined) throw new Error(`no build job is live: ${runnerLog.join('\n')}`);
  return job;
}

function storedRecords(): { kind: string; jobId?: string; fields: Record<string, unknown> }[] {
  return readFileSync(sessionWorkspace.logFilePath, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as never);
}

function sessionJobFolder(jobId: string): string {
  return HostFleet.jobFolderOf(sessionWorkspace.trackerDirectory, jobId);
}

function hostRecordOf(jobId: string, instance: number): HostRecord | null {
  return HostFleet.hostRecordOf(sessionJobFolder(jobId), instance);
}

function processIsAlive(identity: ProcessIdentity): boolean {
  const current = identityOf(identity.processId);
  return current !== null && sameProcess(current, identity);
}

function eventLogTextOf(jobId: string, instance: number): string {
  const entries = HostFleet.eventsAfter(sessionJobFolder(jobId), instance, 0);
  return entries === 'malformed' ? '' : entries.map((entry) => entry.line).join('\n');
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < WAIT_TRIES; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(WAIT_MILLISECONDS);
  }
  throw new Error(`${what}:\n${runnerLog.join('\n')}\n${JSON.stringify(storedJobs())}`);
}

async function passUntil(drivePass: DrivePass, condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < WAIT_TRIES; attempt += 1) {
    await passOnce(drivePass);
    if (condition()) return;
    await Bun.sleep(WAIT_MILLISECONDS);
  }
  throw new Error(`${what}:\n${runnerLog.join('\n')}\n${JSON.stringify(storedJobs())}`);
}

function sessionRuns(job: Readonly<Job> | undefined): job is Readonly<Job> {
  if (job?.state !== 'running') return false;
  const record = hostRecordOf(job.id, job.hostInstance);
  return HostFleet.livenessOf(sessionJobFolder(job.id), job.hostInstance).verdict === 'live' && record?.childProcess !== undefined && record.childProcess !== null;
}

/** Passes until the build session's current instance runs a child; answers the job as stored then. */
async function runningBuildSession(drivePass: DrivePass): Promise<Readonly<Job>> {
  await passUntil(drivePass, () => sessionRuns(buildJobs()[0]), 'the build session never ran');
  return requireBuildJob();
}

function requireRecord(jobId: string, instance: number): HostRecord {
  const record = hostRecordOf(jobId, instance);
  const recordedBoth = record?.host !== null && record?.host !== undefined && record.childProcess !== null && record.childProcess !== undefined;
  if (!recordedBoth) throw new Error(`host ${instance} of ${jobId} recorded no processes`);
  return record;
}

function killHost(jobId: string, instance: number): void {
  const record = requireRecord(jobId, instance);
  process.kill(record.host?.processId ?? 0, 'SIGKILL');
}

function killChildGroup(jobId: string, instance: number): void {
  const record = requireRecord(jobId, instance);
  process.kill(-(record.childProcessGroupId ?? 0), 'SIGKILL');
}

/** What a reboot leaves: both processes gone, and the identities recorded under a boot that is no longer the machine's. */
async function reboot(jobId: string, instance: number): Promise<void> {
  const record = requireRecord(jobId, instance);
  killHost(jobId, instance);
  killChildGroup(jobId, instance);
  const child = record.childProcess;
  await until(() => child === null || child === undefined || !processIsAlive(child), 'the rebooted child never died');
  const foreign = (identity: ProcessIdentity | null | undefined): ProcessIdentity | null => (
    identity === null || identity === undefined ? null : { ...identity, bootIdentity: FOREIGN_BOOT }
  );
  const rebootedRecord = { ...record, host: foreign(record.host), childProcess: foreign(record.childProcess) };
  writeFileSync(hostFilesOf(sessionJobFolder(jobId), instance).hostRecordPath, `${JSON.stringify(rebootedRecord)}\n`);
}

function endEverySessionHost(): void {
  const jobsFolder = join(sessionWorkspace.trackerDirectory, 'jobs');
  if (!existsSync(jobsFolder)) return;
  for (const jobId of readdirSync(jobsFolder)) {
    for (const fileName of readdirSync(join(jobsFolder, jobId)).filter((name) => /^host-\d+\.json$/.test(name))) {
      const record = JSON.parse(readFileSync(join(jobsFolder, jobId, fileName), 'utf8')) as HostRecord;
      for (const target of [record.childProcessGroupId === undefined ? null : -record.childProcessGroupId, record.host?.processId ?? null]) {
        try {
          if (target !== null && (record.host?.bootIdentity ?? '') !== FOREIGN_BOOT) process.kill(target, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
    }
  }
}

function resumedRecordsOf(jobId: string): { kind: string; fields: Record<string, unknown> }[] {
  return storedRecords().filter((record) => record.kind === 'job-resumed' && record.jobId === jobId);
}

describeWhenGitIsPresent('the session, host, runner and reboot rows', () => {
  beforeEach(async () => {
    repository       = createScratchGitRepository('crash-rows');
    sessionWorkspace = workspacePathsFor(repository);
    monitorFolder    = createScratchDirectory('h');
    launches         = [];
    launchFacts      = [];
    runnerLog        = [];
    mkdirSync(sessionWorkspace.ticketsDirectory, { recursive: true });
    writeReadableTracker(sessionWorkspace);
    await writeTracker({
      workspace: sessionWorkspace,
      at:        CHANGED_AT,
      now,
      renderState,
      mutate:    (change) => {
        change.board.setCheckCommand('true', false, change.at);
        change.board.setDispatcherState('running', null, change.at);
      },
    });
  });

  afterEach(() => {
    endEverySessionHost();
    removeScratchDirectory(monitorFolder);
    removeScratchDirectory(repository);
  });

  test('runner dies: the hosts keep running, and a restart attaches with hello from the stored cursor and replays the history', async () => {
    const adapter = recordingAdapter({ fresh: LINE_THEN_WAITING_STEPS, resumed: WAITING_STEPS });
    const job     = await runningBuildSession(await startedRunner(adapter));
    await until(() => eventLogTextOf(job.id, 1).includes('"init"'), 'the session never started');
    // The runner is down from here: the session goes on and logs a turn nobody applies.
    await HostFleet.sendFrames(sessionJobFolder(job.id), 1, [{ kind: 'write', line: adapter.chatLineOf('Example line while the runner is down') }]);
    await until(() => eventLogTextOf(job.id, 1).includes('after-the-line'), 'the session never answered the line');
    const storedCursor = requireBuildJob().eventCursor;
    const unapplied    = HostFleet.eventsAfter(sessionJobFolder(job.id), 1, storedCursor.instance === 1 ? storedCursor.sequence : 0);

    const report = await (await startedRunner(adapter)).reattach();

    const attached = report.attached.find((host) => host.jobId === job.id);
    expect(attached?.instance).toBe(1);
    expect(attached?.replayedEntries).toEqual(unapplied === 'malformed' ? [] : unapplied);
    expect(JSON.stringify(attached?.replayedEntries)).toContain('after-the-line');
    expect(requireBuildJob()).toMatchObject({ id: job.id, state: 'running', hostInstance: 1 });
    expect(requireBuildJob().eventCursor.sequence).toBeGreaterThan(storedCursor.sequence);
    expect(storedRecords().filter((record) => record.kind === 'job-interrupted')).toEqual([]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('host dies with its agent alive: the agent group is killed first, the job is interrupted host-lost and resumed by id in place, told so', async () => {
    // The agent's own tool call keeps it alive whatever happens to its input, as a Bash child of a killed CLI does.
    const adapter  = recordingAdapter({ fresh: [STARTED, { kind: 'shell', command: 'sleep 60' }], resumed: LINE_THEN_WAITING_STEPS });
    const job      = await runningBuildSession(await startedRunner(adapter));
    const child    = requireRecord(job.id, 1).childProcess;
    killHost(job.id, 1);
    await until(() => HostFleet.livenessOf(sessionJobFolder(job.id), 1).verdict === 'lost', 'the host never read as lost');
    expect(child !== null && child !== undefined && processIsAlive(child), 'the orphaned agent outlives its host').toBe(true);

    const restarted = await startedRunner(adapter);
    const report    = await restarted.reattach();

    expect(report.lost).toEqual([{ jobId: job.id, instance: 1, cause: 'host-lost' }]);
    expect(child !== null && child !== undefined && processIsAlive(child)).toBe(false);
    expect(storedRecords().find((record) => record.kind === 'job-interrupted' && record.jobId === job.id)?.fields).toMatchObject({ cause: 'host-lost' });
    expect(requireBuildJob()).toMatchObject({
      id: job.id, state: 'running', hostInstance: 2, crashResumes: 1
    });
    const [freshLaunch, resumeLaunch] = launches;
    expect(resumeLaunch).toEqual({
      jobId: job.id, resume: true, firstMessage: RESUME_MESSAGE, workingDirectory: freshLaunch?.workingDirectory ?? '', sessionId: freshLaunch?.sessionId ?? '',
    });
    await passUntil(restarted, () => eventLogTextOf(job.id, 2).includes('after-the-line'), 'the resumed session never took its first line');
    expect(existsSync(join(sessionJobFolder(job.id), 'resume-message-2.sent'))).toBe(true);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('host and agent die with the input open: interrupted agent-crashed, and resumed', async () => {
    const adapter = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS });
    const job     = await runningBuildSession(await startedRunner(adapter));
    killHost(job.id, 1);
    killChildGroup(job.id, 1);
    await until(() => HostFleet.livenessOf(sessionJobFolder(job.id), 1).verdict === 'lost', 'the host never read as lost');

    const report = await (await startedRunner(adapter)).reattach();

    expect(report.lost).toEqual([{ jobId: job.id, instance: 1, cause: 'agent-crashed' }]);
    expect(report.leftoverWorktrees).toEqual([]);
    expect(requireBuildJob()).toMatchObject({
      id: job.id, state: 'running', hostInstance: 2, crashResumes: 1
    });
    expect(resumedRecordsOf(job.id).map((record) => record.fields)).toEqual([{ hostInstance: 2, cause: 'agent-crashed' }]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('agent exits with its closing result while the runner is down: on reattach the result is read from the event log into verifying', async () => {
    const statesAfterHostEvents: (string | undefined)[] = [];
    const adapter = recordingAdapter({ fresh: [STARTED, { kind: 'print', line: fakeResultLine({ outcome: 'built' }) }, { kind: 'await-line' }], resumed: WAITING_STEPS });
    const first   = await startedRunner(adapter);
    await passUntil(first, () => HostFleet.livenessOf(sessionJobFolder(requireBuildJob().id), 1).verdict !== 'unclaimed', 'the build session was never spawned');
    const job = requireBuildJob();
    await until(() => eventLogTextOf(job.id, 1).includes('"result"'), 'the session never closed its turn');

    await (await startedRunner(adapter, (phase, board) => {
      if (phase === 'host-events') statesAfterHostEvents.push(board.jobById(job.id)?.state);
    })).reattach();

    expect(statesAfterHostEvents[0]).toBe('verifying');
    expect(storedRecords().filter((record) => record.jobId === job.id && record.kind === 'job-interrupted')).toEqual([]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('agent exits mid-turn with no closing result: interrupted agent-crashed, and resumed', async () => {
    const adapter = recordingAdapter({ fresh: [STARTED, { kind: 'print', line: fakeAssistantTurnLine('mid-turn') }, { kind: 'crash' }], resumed: WAITING_STEPS });
    const drivePass = await startedRunner(adapter);
    await passUntil(drivePass, () => resumedRecordsOf(buildJobs()[0]?.id ?? '').length > 0, 'the crashed session was never resumed');
    const job = requireBuildJob();
    expect(storedRecords().find((record) => record.kind === 'job-interrupted' && record.jobId === job.id)?.fields).toMatchObject({ cause: 'agent-crashed' });
    expect(job).toMatchObject({ attempt: 1, hostInstance: 2 });
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a job crash-resumed twice and interrupted again ends replaced, a fresh attempt takes the same worktree, and two replaced in a row open job-lost', async () => {
    const drivePass = await startedRunner(recordingAdapter({ fresh: CRASHING_STEPS, resumed: CRASHING_STEPS }));
    const jobLostIsOpen = (): boolean => (requireProgressFile(sessionWorkspace).incidents ?? []).some((incident) => incident.kind === 'job-lost');
    await passUntil(drivePass, jobLostIsOpen, 'job-lost never opened');

    const endings = storedRecords().filter((record) => record.kind === 'job-ended' && launches.some((launch) => launch.jobId === record.jobId));
    expect(endings.map((record) => record.fields['outcome'])).toEqual(['replaced', 'replaced']);
    const attempts = storedRecords().filter((record) => record.kind === 'job-launched' && record.fields['kind'] === 'build').map((record) => record.fields['attempt']);
    expect(attempts).toEqual([1, 2]);
    const [firstJobId, secondJobId] = endings.map((record) => record.jobId);
    expect(launches.filter((launch) => launch.jobId === firstJobId).map((launch) => launch.resume)).toEqual([false, true, true]);
    expect(new Set(launches.map((launch) => launch.workingDirectory)).size).toBe(1);
    expect(launchFacts.find((launch) => launch.jobId === secondJobId)?.facts.earlierSessionReplaced).toBe(true);
    expect(launchFacts.find((launch) => launch.jobId === firstJobId)?.facts.earlierSessionReplaced).toBe(false);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a resume the vendor cannot take opens resume-failed and ends the job replaced; its default fresh job takes the same worktree and the earlier-session note', async () => {
    const drivePass = await startedRunner(recordingAdapter({ fresh: CRASHING_STEPS, resumed: [{ kind: 'exit', code: 1 }] }));
    const resumeFailed = (): Readonly<{ id: string; kind: string; jobId: string | null }> | undefined => (
      (requireProgressFile(sessionWorkspace).incidents ?? []).find((incident) => incident.kind === 'resume-failed')
    );
    await passUntil(drivePass, () => resumeFailed() !== undefined, 'resume-failed never opened');
    const incident   = resumeFailed();
    const firstJobId = incident?.jobId ?? '';
    expect(storedRecords().find((record) => record.kind === 'job-ended' && record.jobId === firstJobId)?.fields).toMatchObject({ outcome: 'replaced', cause: 'resume-failed' });

    await writeTracker({
      workspace: sessionWorkspace, at: CHANGED_AT, now, renderState, mutate: (change) => { change.board.defaultIncident(incident?.id ?? '', 'turn-closed', change.at); },
    });
    await passUntil(drivePass, () => launches.some((launch) => launch.jobId !== firstJobId), 'no fresh job was launched');

    const freshLaunch = launches.find((launch) => launch.jobId !== firstJobId);
    expect(freshLaunch).toMatchObject({ resume: false, workingDirectory: launches[0]?.workingDirectory ?? '' });
    expect(launchFacts.find((launch) => launch.jobId === freshLaunch?.jobId)?.facts.earlierSessionReplaced).toBe(true);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('three reboots in a row during one build: three resumes of the same session, none counted, and no fresh agent', async () => {
    const adapter = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS });
    let job = await runningBuildSession(await startedRunner(adapter));
    for (let rebootNumber = 1; rebootNumber <= 3; rebootNumber += 1) {
      const { id, hostInstance } = job;
      await until(() => eventLogTextOf(id, hostInstance).includes('"init"'), 'the session never started');
      await reboot(job.id, job.hostInstance);
      const restarted = await startedRunner(adapter);
      const report    = await restarted.reattach();
      expect(report.lost).toEqual([{ jobId: job.id, instance: rebootNumber, cause: 'reboot' }]);
      job = await runningBuildSession(restarted);
    }

    expect(job).toMatchObject({ attempt: 1, hostInstance: 4, crashResumes: 0 });
    expect(resumedRecordsOf(job.id).map((record) => record.fields['cause'])).toEqual(['reboot', 'reboot', 'reboot']);
    expect(new Set(launches.map((launch) => `${launch.jobId} ${launch.sessionId} ${launch.workingDirectory}`)).size).toBe(1);
    expect(storedRecords().filter((record) => record.kind === 'job-ended')).toEqual([]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('runner dies after the hold that launched a job, before the spawn: reattach re-spawns the same instance', async () => {
    let orchestratorJobId = '';
    await writeTracker({
      workspace: sessionWorkspace,
      at:        CHANGED_AT,
      now,
      renderState,
      mutate:    (change) => {
        orchestratorJobId = change.board.launchJob({
          kind: 'orchestrator', role: 'orchestrator', ticketIds: [], parentJobId: null, attempt: 1, target: null
        }, change.at).job.id;
      },
    });

    const report = await (await startedRunner(recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS }))).reattach();

    expect(report.respawnJobIds).toContain(orchestratorJobId);
    await until(() => HostFleet.livenessOf(sessionJobFolder(orchestratorJobId), 1).verdict === 'live', 'the same instance was never claimed');
    expect(storedJobs().find((job) => job.id === orchestratorJobId)?.hostInstance).toBe(1);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('an orchestrator session finishes only once the runner closed its input: a turn\'s result keeps it running, its host gone while stopping ends it closed', async () => {
    const orchestratorSteps: readonly FakeAgentStep[] = [STARTED, { kind: 'print', line: fakeResultLine({ outcome: 'built' }) }, { kind: 'await-line' }];
    const adapter = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS, orchestrator: orchestratorSteps });
    const drivePass        = await startedRunner(adapter);
    const orchestratorJob  = (): Readonly<Job> | undefined => storedJobs().find((job) => job.kind === 'orchestrator');
    const orchestratorId   = (): string => orchestratorJob()?.id ?? '';
    await passUntil(drivePass, () => orchestratorJob() !== undefined && eventLogTextOf(orchestratorId(), 1).includes('"result"'), 'the orchestrator never ended a turn');
    await passOnce(drivePass);
    expect(orchestratorJob()).toMatchObject({ state: 'running', hostInstance: 1 });

    const jobId = orchestratorId();
    await writeTracker({
      workspace: sessionWorkspace, at: CHANGED_AT, now, renderState, mutate: (change) => { change.board.moveJob(jobId, 'stopping', change.at); },
    });
    killHost(jobId, 1);
    killChildGroup(jobId, 1);
    await until(() => HostFleet.livenessOf(sessionJobFolder(jobId), 1).verdict === 'lost', 'the orchestrator host never read as lost');
    await passUntil(drivePass, () => storedRecords().some((record) => record.kind === 'job-ended' && record.jobId === jobId), 'the stopped orchestrator never ended');

    expect(storedRecords().find((record) => record.kind === 'job-ended' && record.jobId === jobId)?.fields).toMatchObject({ outcome: 'closed' });
    expect(storedRecords().filter((record) => record.kind === 'job-interrupted' && record.jobId === jobId)).toEqual([]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a ticket held while its job runs interrupts nothing', async () => {
    const drivePass = await startedRunner(recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS }));
    const job       = await runningBuildSession(drivePass);
    await writeTracker({
      workspace: sessionWorkspace, at: CHANGED_AT, now, renderState, mutate: (change) => { change.board.holdTicket('001', 'Waiting on Alex Example', change.at); },
    });
    await passOnce(drivePass);
    expect(requireBuildJob()).toMatchObject({ id: job.id, state: 'running', hostInstance: 1 });
    expect(HostFleet.livenessOf(sessionJobFolder(job.id), 1).verdict).toBe('live');
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a finished session is never continued: a move of an ended job is refused job-finished', async () => {
    const failure = await failureOf(() => writeTracker({
      workspace: sessionWorkspace,
      at:        CHANGED_AT,
      now,
      renderState,
      mutate:    (change) => {
        const { job } = change.board.launchJob({
          kind: 'orchestrator', role: 'orchestrator', ticketIds: [], parentJobId: null, attempt: 1, target: null
        }, change.at);
        change.board.endJob(job.id, { outcome: 'closed' }, change.at);
        change.board.moveJob(job.id, 'running', change.at);
      },
    }));
    expect(refusalIsOperationRefusal(failure) ? JSON.stringify(failure.detail) : String(failure)).toContain('job-finished');
  });

  test('a reused pid is never signalled: a lost host whose recorded child names another process reads agent-crashed', () => {
    // Outside the jobs folder, so the cleanup that kills every recorded host never reads this spec's own process.
    const jobFolder = join(monitorFolder, 'J99');
    mkdirSync(jobFolder, { recursive: true });
    const self = identityOf(process.pid);
    if (self === null) throw new Error('this process has no readable identity');
    const reused = { ...self, startEpochSeconds: self.startEpochSeconds - 1 };
    writeFileSync(hostFilesOf(jobFolder, 1).hostRecordPath, `${JSON.stringify({
      protocolVersion: 1, eventLogFormatVersion: 1, hostInstance: 1, state: 'running', host: reused, childProcess: reused, childProcessGroupId: process.pid,
    })}\n`);
    expect(HostFleet.livenessOf(jobFolder, 1).verdict).toBe('lost');
    expect(Reattachment.settleLostHost(jobFolder, 1)).toBe('agent-crashed');
    expect(processIsAlive(self)).toBe(true);
  });

  test('a worktree folder no job or branch owns opens leftover-worktree to User once, however often the runner starts', async () => {
    const worktreesRoot = join(repository, PRODUCT_NAMES.WORKTREES_FOLDER);
    mkdirSync(join(worktreesRoot, 'ticket-999'), { recursive: true });
    gitOutputIn(repository, ['worktree', 'add', '-q', '-b', 'example-owned', join(worktreesRoot, 'example-owned')]);
    await writeTracker({
      workspace: sessionWorkspace, at: CHANGED_AT, now, renderState, mutate: (change) => { change.board.setDispatcherState('stopped', null, change.at); },
    });
    const adapter = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS });

    const report = await (await startedRunner(adapter)).reattach();
    await (await startedRunner(adapter)).reattach();

    expect(report.leftoverWorktrees.map((folder) => basename(folder))).toEqual(['ticket-999']);
    const decisions = (requireProgressFile(sessionWorkspace).decisions ?? []).filter((decision) => decision.kind === 'leftover-worktree');
    expect(decisions.map((decision) => basename(decision.context))).toEqual(['ticket-999']);
  }, ROW_TIMEOUT_MILLISECONDS);
});
