/**
 * The crash, reboot and update matrix, one row per scenario, each held against the mechanism that settles it; later mechanisms add their
 * rows here. What matters in these rows: a hold cut short after its journal is finished by the next holder before that holder reads, and a
 * holder whose lock was taken over writes nothing further, its committed journal replayed by its successor.
 *
 * The session, Watcher, Overseer, reboot and question rows that need no Airlock run a build job on a scratch repository, its
 * session the fake child: every crash is made by killing the Watcher, the child's group or both, a reboot by also giving the Watcher record a
 * foreign boot, and an Overseer restart by a fresh DrivePass regrouping. What matters there: an orphaned agent group is killed before the
 * resume, only the crash causes count toward the bound, a resume is by id in the same folder, and a finished session never continues,
 * save a closed product owner User messages, which resumes by id. A Baton pass row hands a running session's board to a successor and
 * holds that no Watcher is touched; a Watcher below the supported protocol window is watched from its files and stopped by its group. The
 * Assistant rows hold that it continues across an Overseer restart, is replaced and never resumed when down, and boots past two failed boots
 * only on a sweep while every incident defaults. The rows
 * "the old Overseer dies during a baton-pass" and "a Baton pass's successor fails" are held by `src/services/overseer/BatonPass.spec.ts`. The
 * usage-limit row is held by `src/services/overseer/UsageLimits.spec.ts` and `cli/overseer/OverseerDrivePass.spec.ts`, the body-edit row by V6
 * in `src/services/lifecycle/Customs.spec.ts`.
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
import { writeHatchRequest }                             from '../../adapters/hatch/HatchFolder.ts';
import type { AgentAdapter }                             from '../../lib/agent-launch/AgentAdapter.ts';
import type { AgentLaunchRequest }                       from '../../lib/agent-launch/AgentLaunchRequest.ts';
import type { AgentQuestion }                            from '../../lib/agent-launch/AgentSessionEvent.ts';
import type { WorkerProfile }                            from '../../lib/agent-launch/WorkerProfile.ts';
import { identityOf, sameProcess, type ProcessIdentity } from '../../lib/process-identity/ProcessIdentity.ts';
import type { Decision }                                 from '../../lib/tracker-model/@types/Decision.ts';
import type { Incident }                                 from '../../lib/tracker-model/@types/Incident.ts';
import type { Job }                                      from '../../lib/tracker-model/@types/Job.ts';
import type { Board }                                    from '../../lib/tracker-model/Board.ts';
import type { EventLogEntry }                            from '../../lib/watcher/EventLog.ts';
import { watcherFilesOf }                                from '../../lib/watcher/WatcherFiles.ts';
import type { WatcherRecord }                            from '../../lib/watcher/WatcherRecord.ts';
import { WATCHER_PROTOCOL_OLDEST_SUPPORTED }             from '../../lib/watcher/constants/WatcherProtocol.ts';
import type { ControlCommand }                           from '../../shared/@types/ControlCommand.ts';
import { refusalIsOperationRefusal }                     from '../../shared/OperationRefusal.ts';
import { LIFECYCLE_LIMITS }                              from '../../shared/constants/LifecycleLimits.ts';
import { LIMITS }                                        from '../../shared/constants/Limits.ts';
import { PRODUCT_NAMES }                                 from '../../shared/constants/ProductNames.ts';
import { boardFixture, ticketFixture }                   from '../../testing/BoardFixtures.ts';
import {
  fakeAgentAdapter,
  fakeAssistantTurnLine,
  fakeQuestionLine,
  type FakeAgentStep,
  fakeResultLine,
  fakeStartedLine
} from '../../testing/FakeAgentAdapter.ts';
import {
  createScratchDirectory,
  commitFile,
  createScratchGitRepository,
  currentBranchOf,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                             from '../../testing/ToolGuard.ts';
import { EXAMPLE_TICKET_FILE_NAME, writeReadableTracker }       from '../../testing/TrackerFileFixtures.ts';
import { ControlService }                                       from '../control/ControlService.ts';
import { holdJournalFilePathOf }                                from '../tracker/HoldJournal.ts';
import { LockGenerationSteps }                                  from '../tracker/TrackerLock.ts';
import { writeTracker, type TrackerChange }                     from '../tracker/TrackerPipeline.ts';
import { requireProgressFile }                                  from '../tracker/TrackerReader.ts';
import { workspacePathsFor, type Workspace }                    from '../tracker/Workspace.ts';
import { Baton }                                                from './Baton.ts';
import { BatonPass }                                            from './BatonPass.ts';
import { createDrivePass, type DrivePass, type JobLaunchFacts } from './DrivePass.ts';
import { GroupWorktrees }                                       from './GroupWorktrees.ts';
import { HatchInbox }                                           from './HatchInbox.ts';
import { CONSTITUTION_DEFAULT_PATH, defaultInstructionPathOf }  from './InstructionFiles.ts';
import { IntakeSessions }                                       from './IntakeSessions.ts';
import { JobResumption }                                        from './JobResumption.ts';
import { overseerFilesIn }                                      from './OverseerFiles.ts';
import { Regrouping }                                           from './Regrouping.ts';
import { WATCHER_ENTRY_PATH, WatcherBundle }                    from './WatcherBundle.ts';
import { WatcherFleet }                                         from './WatcherFleet.ts';
import { createAirlocksHarness, HARNESS_AT, resolveAs }         from './testing/AirlocksHarness.ts';

const CHANGED_AT = '2026-09-18T20:05:00+02:00';

const now = (): Date => new Date('2026-09-18T18:05:00Z');


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
      mutate:           holdTheExampleTicket,
      afterFileWritten: (filePath) => { if (filePath === workspace.progressFilePath) throw crash; },
    }));
    expect(failure).toBe(crash);
    expect(readFileSync(workspace.progressFilePath, 'utf8')).toContain('Example cut-short row');
    expect(ticketText(), 'the board is torn: the ticket was not written').toBe(ticketBefore);

    const written = await writeTracker({
      workspace, at: CHANGED_AT, now, mutate: noteAnExample,
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
      mutate:           holdTheExampleTicket,
      afterFileWritten: (filePath) => { if (filePath === workspace.progressFilePath) takeTheLockOver(); },
    }));

    expect(refusalIsOperationRefusal(failure) ? failure.detail?.kind : null).toBe('lock-taken-over');
    expect(ticketText()).toBe(ticketBefore);
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(true);

    await writeTracker({
      workspace, at: CHANGED_AT, now, mutate: noteAnExample,
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
  /** The product owner, told apart as the one session launched with skills on. */
  productOwner?: { fresh: readonly FakeAgentStep[]; resumed: readonly FakeAgentStep[] };
}

const SESSION_STAMP          = '2026-09-18T22:11:03+02:00';
const RESUME_MESSAGE         = 'Example resume message';
const ASSISTANT_CHAT_PREFIX  = 'Example chat';
const EARLIER_SESSION_NOTE   = 'Example earlier-session note.';
const ANSWER_MESSAGE_PREFIX  = 'Example answers';
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

const EXAMPLE_QUESTION: AgentQuestion = {
  question: 'Ship the example export?', header: 'Export', multiSelect: false, options: [{ label: 'Yes', description: 'Ship it' }, { label: 'No', description: 'Hold it' }],
};

function askingSteps(question: AgentQuestion): readonly FakeAgentStep[] {
  return [
    STARTED,
    { kind: 'print', line: fakeQuestionLine('request-1', [question]) },
    { kind: 'await-line' },
    { kind: 'print', line: fakeAssistantTurnLine('after-the-answer') },
    { kind: 'await-line' },
  ];
}

const ASKING_STEPS = askingSteps(EXAMPLE_QUESTION);

let repository = '';
let sessionWorkspace: Workspace;
let monitorFolder = '';
let launches: RecordedLaunch[] = [];
let launchFacts: { jobId: string; facts: JobLaunchFacts }[] = [];
let assistantLaunches: AgentLaunchRequest[] = [];
let overseerLog: string[] = [];

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
      const productOwnerSteps = request.resume ? scenario.productOwner?.resumed : scenario.productOwner?.fresh;
      if (!isWorker && !request.profile.skills) assistantLaunches.push(request);
      const sessionSteps = request.profile.skills ? productOwnerSteps ?? WAITING_STEPS : scenario.orchestrator ?? WAITING_STEPS;
      const steps = isWorker ? (request.resume ? scenario.resumed : scenario.fresh) : sessionSteps;
      return fakeAgentAdapter(steps).planOf(request);
    },
  };
}

/** An Overseer start: a newer Baton generation and a fresh DrivePass, which the spec regroups. */
async function startedOverseer(
  adapter: AgentAdapter,
  afterHoldPhase?: (phase: string, board: Board) => void,
  deliversByControlResponse?: boolean,
  onUsageMarkerRead?: () => void,
): Promise<DrivePass> {
  const { overseerDirectory } = overseerFilesIn(sessionWorkspace.trackerDirectory);
  mkdirSync(overseerDirectory, { recursive: true });
  const acquisition = Baton.acquire(overseerDirectory, {
    processId:                process.pid,
    processStartEpochSeconds: 1,
    bootIdentity:             'example-boot',
    port:                     1,
    url:                      'http://127.0.0.1:1/',
    tokenFile:                join(overseerDirectory, 'token'),
    codeVersion:              'code-example',
    installVersion:           1,
    watcherProtocolVersion:   1,
  });
  if (acquisition.verdict !== 'acquired') throw new Error('the scratch Baton was not acquired');
  const watcherBundlePath = await WatcherBundle.pinWatcherBundle({ overseerDirectory, codeVersion: 'code-example', entryPath: WATCHER_ENTRY_PATH });
  return createDrivePass({
    workspace:    sessionWorkspace,
    now:          () => new Date(Date.parse(SESSION_STAMP)),
    formatStamp:  () => SESSION_STAMP,
    overseerDirectory,
    generation:   acquisition.generation,
    watcherBundlePath,
    codeVersion:  'code-example',
    agentAdapter: adapter,
    // A pass reads the usage marker after the Hatch folders: the hook acts there, between the observation's reads.
    get monitorFolder() {
      onUsageMarkerRead?.();
      return monitorFolder;
    },
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
      return { firstMessage: `${facts.earlierSessionReplaced ? `${EARLIER_SESSION_NOTE} ` : ''}Example first message of ${job.id}`, roleBrief: 'Example role' };
    },
    assistantChatTextOf: (facts) => `${ASSISTANT_CHAT_PREFIX} ${facts.sequence}: ${facts.incidents.map((incident) => incident.id).join(', ')}`,
    windDownMessage:     'Example wind-down message',
    resumeMessage:       RESUME_MESSAGE,
    redHandoffMessageOf: (facts) => `Red handoff: ${facts.name}, resume ${facts.resume}`,
    answerMessageOf:     (answer) => `${ANSWER_MESSAGE_PREFIX} ${JSON.stringify(answer)}`,
    ...(deliversByControlResponse === undefined ? {} : { deliversAnswersByControlResponse: deliversByControlResponse }),
    homeDirectory:       monitorFolder,
    log:                 (line) => overseerLog.push(line),
    onBatonTakenOver:    () => overseerLog.push('taken over'),
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
  if (job === undefined) throw new Error(`no build job is live: ${overseerLog.join('\n')}`);
  return job;
}

function storedRecords(): { kind: string; jobId?: string; fields: Record<string, unknown> }[] {
  return readFileSync(sessionWorkspace.logFilePath, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as never);
}

function sessionJobFolder(jobId: string): string {
  return WatcherFleet.jobFolderOf(sessionWorkspace.trackerDirectory, jobId);
}

function watcherRecordOf(jobId: string, instance: number): WatcherRecord | null {
  return WatcherFleet.watcherRecordOf(sessionJobFolder(jobId), instance);
}

function processIsAlive(identity: ProcessIdentity): boolean {
  const current = identityOf(identity.processId);
  return current !== null && sameProcess(current, identity);
}

function eventLogTextOf(jobId: string, instance: number): string {
  const entries = WatcherFleet.eventsAfter(sessionJobFolder(jobId), instance, 0);
  return entries === 'malformed' ? '' : entries.map((entry) => entry.line).join('\n');
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < WAIT_TRIES; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(WAIT_MILLISECONDS);
  }
  throw new Error(`${what}:\n${overseerLog.join('\n')}\n${JSON.stringify(storedJobs())}`);
}

async function passUntil(drivePass: DrivePass, condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < WAIT_TRIES; attempt += 1) {
    await passOnce(drivePass);
    if (condition()) return;
    await Bun.sleep(WAIT_MILLISECONDS);
  }
  throw new Error(`${what}:\n${overseerLog.join('\n')}\n${JSON.stringify(storedJobs())}`);
}

function sessionRuns(job: Readonly<Job> | undefined): job is Readonly<Job> {
  if (job?.state !== 'running') return false;
  const record = watcherRecordOf(job.id, job.watcherInstance);
  return WatcherFleet.livenessOf(sessionJobFolder(job.id), job.watcherInstance).verdict === 'live' && record?.childProcess !== undefined && record.childProcess !== null;
}

/** Passes until the build session's current instance runs a child; answers the job as stored then. */
async function runningBuildSession(drivePass: DrivePass): Promise<Readonly<Job>> {
  await passUntil(drivePass, () => sessionRuns(buildJobs()[0]), 'the build session never ran');
  return requireBuildJob();
}

function requireRecord(jobId: string, instance: number): WatcherRecord {
  const record = watcherRecordOf(jobId, instance);
  const recordedBoth = record?.watcher !== null && record?.watcher !== undefined && record.childProcess !== null && record.childProcess !== undefined;
  if (!recordedBoth) throw new Error(`watcher ${instance} of ${jobId} recorded no processes`);
  return record;
}

function killWatcher(jobId: string, instance: number): void {
  const record = requireRecord(jobId, instance);
  process.kill(record.watcher?.processId ?? 0, 'SIGKILL');
}

function killChildGroup(jobId: string, instance: number): void {
  const record = requireRecord(jobId, instance);
  process.kill(-(record.childProcessGroupId ?? 0), 'SIGKILL');
}

/** What a reboot leaves: both processes gone, and the identities recorded under a boot that is no longer the machine's. */
async function reboot(jobId: string, instance: number): Promise<void> {
  const record = requireRecord(jobId, instance);
  killWatcher(jobId, instance);
  killChildGroup(jobId, instance);
  const child = record.childProcess;
  await until(() => child === null || child === undefined || !processIsAlive(child), 'the rebooted child never died');
  const foreign = (identity: ProcessIdentity | null | undefined): ProcessIdentity | null => (
    identity === null || identity === undefined ? null : { ...identity, bootIdentity: FOREIGN_BOOT }
  );
  const rebootedRecord = { ...record, watcher: foreign(record.watcher), childProcess: foreign(record.childProcess) };
  writeFileSync(watcherFilesOf(sessionJobFolder(jobId), instance).watcherRecordPath, `${JSON.stringify(rebootedRecord)}\n`);
}

function endEverySessionWatcher(): void {
  const jobsFolder = join(sessionWorkspace.trackerDirectory, 'jobs');
  if (!existsSync(jobsFolder)) return;
  for (const jobId of readdirSync(jobsFolder)) {
    for (const fileName of readdirSync(join(jobsFolder, jobId)).filter((name) => /^watcher-\d+\.json$/.test(name))) {
      const record = JSON.parse(readFileSync(join(jobsFolder, jobId, fileName), 'utf8')) as WatcherRecord;
      for (const target of [record.childProcessGroupId === undefined ? null : -record.childProcessGroupId, record.watcher?.processId ?? null]) {
        try {
          if (target !== null && (record.watcher?.bootIdentity ?? '') !== FOREIGN_BOOT) process.kill(target, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
    }
  }
}

function openDecisions(): readonly Readonly<Decision>[] {
  return requireProgressFile(sessionWorkspace).decisions ?? [];
}

/** `decide`'s change, applied as the command line applies it: a hold of its own, with no Overseer pass in it. */
async function decideWithTheOverseerDown(decisionId: string, choices: readonly string[]): Promise<void> {
  await writeTracker({
    workspace: sessionWorkspace,
    at:        CHANGED_AT,
    now,
    mutate:    (change) => ControlService.apply({ kind: 'decision-answer', decisionId, answer: { form: 'letters', choices } }, change),
  });
}

/** A control applied as its verb applies it with the Overseer down: a hold of its own. */
async function applyControl(command: ControlCommand): Promise<void> {
  await writeTracker({
    workspace: sessionWorkspace, at: CHANGED_AT, now, mutate: (change) => ControlService.apply(command, change),
  });
}

const FIRST_TURN_RESULT: FakeAgentStep = { kind: 'print', line: fakeResultLine(null) };

function requireAssistant(): Readonly<Job> {
  const assistant = storedJobs().find((job) => job.kind === 'assistant');
  if (assistant === undefined) throw new Error(`no Assistant is live: ${overseerLog.join('\n')}`);
  return assistant;
}

function assistantAnswered(results: number): boolean {
  const assistant = storedJobs().find((job) => job.kind === 'assistant');
  return assistant !== undefined && eventLogTextOf(assistant.id, 1).split('"type":"result"').length - 1 >= results;
}

function openIncidents(): readonly Readonly<Incident>[] {
  return requireProgressFile(sessionWorkspace).incidents ?? [];
}

function failedAssistantBoots(): number {
  const assistantIds = new Set(storedRecords().filter((record) => record.kind === 'job-launched' && record.fields['kind'] === 'assistant').map((record) => record.jobId));
  return storedRecords().filter((record) => record.kind === 'job-ended' && assistantIds.has(record.jobId) && record.fields['outcome'] === 'failed').length;
}

async function openBlockedIncident(): Promise<void> {
  await writeTracker({
    workspace: sessionWorkspace,
    at:        CHANGED_AT,
    now,
    mutate:    (change) => {
      change.board.openIncident({
        kind: 'blocked', ticketIds: ['001'], jobId: null, facts: {}, defaultMove: 'ticket-park'
      }, change.at);
    },
  });
}

function productOwnerJob(): Readonly<Job> | undefined {
  return storedJobs().find((job) => job.kind === 'product-owner');
}

function resumedRecordsOf(jobId: string):{ kind: string; fields: Record<string, unknown> }[] {
  return storedRecords().filter((record) => record.kind === 'job-resumed' && record.jobId === jobId);
}

describeWhenGitIsPresent('the session, Watcher, Overseer and reboot rows', () => {
  beforeEach(async () => {
    repository       = createScratchGitRepository('crash-rows');
    sessionWorkspace = workspacePathsFor(repository);
    monitorFolder    = createScratchDirectory('h');
    launches         = [];
    launchFacts      = [];
    assistantLaunches = [];
    overseerLog        = [];
    mkdirSync(sessionWorkspace.ticketsDirectory, { recursive: true });
    writeReadableTracker(sessionWorkspace);
    const instructionDefaults = [CONSTITUTION_DEFAULT_PATH, ...(['builder', 'reviewer', 'merger', 'productOwner', 'assistant'] as const).map(defaultInstructionPathOf)];
    for (const path of instructionDefaults) {
      mkdirSync(join(repository, path, '..'), { recursive: true });
      writeFileSync(join(repository, path), 'Example instructions.\n');
    }
    await writeTracker({
      workspace: sessionWorkspace,
      at:        CHANGED_AT,
      now,
      mutate:    (change) => {
        change.board.addGate({ name: 'checks', run: 'true' }, change.at);
        change.board.setOverseerState('running', change.at);
      },
    });
  });

  afterEach(() => {
    endEverySessionWatcher();
    removeScratchDirectory(monitorFolder);
    removeScratchDirectory(repository);
  });

  test('overseer dies: the Watchers keep running, and a restart attaches with hello from the stored cursor and replays the history', async () => {
    const adapter = recordingAdapter({ fresh: LINE_THEN_WAITING_STEPS, resumed: WAITING_STEPS });
    const job     = await runningBuildSession(await startedOverseer(adapter));
    await until(() => eventLogTextOf(job.id, 1).includes('"init"'), 'the session never started');
    // The Overseer is down from here: the session goes on and logs a turn nobody applies.
    await WatcherFleet.sendFrames(sessionJobFolder(job.id), 1, [{ kind: 'write', line: adapter.chatLineOf('Example line while the Overseer is down') }]);
    await until(() => eventLogTextOf(job.id, 1).includes('after-the-line'), 'the session never answered the line');
    const storedCursor = requireBuildJob().eventCursor;
    const unapplied    = WatcherFleet.eventsAfter(sessionJobFolder(job.id), 1, storedCursor.instance === 1 ? storedCursor.sequence : 0);

    const report = await (await startedOverseer(adapter)).regroup();

    const attached = report.attached.find((watcher) => watcher.jobId === job.id);
    expect(attached?.instance).toBe(1);
    expect(attached?.replayedEntries).toEqual(unapplied === 'malformed' ? [] : unapplied);
    expect(JSON.stringify(attached?.replayedEntries)).toContain('after-the-line');
    expect(requireBuildJob()).toMatchObject({ id: job.id, state: 'running', watcherInstance: 1 });
    expect(requireBuildJob().eventCursor.sequence).toBeGreaterThan(storedCursor.sequence);
    expect(storedRecords().filter((record) => record.kind === 'job-interrupted')).toEqual([]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a fresh session takes its first message as its first input, once, and a later pass sends it no second time', async () => {
    const drivePass = await startedOverseer(recordingAdapter({ fresh: LINE_THEN_WAITING_STEPS, resumed: WAITING_STEPS }));
    const job       = await runningBuildSession(drivePass);
    const firstLine = recordingAdapter({ fresh: [], resumed: [] }).chatLineOf(`Example first message of ${job.id}`);
    await passUntil(drivePass, () => eventLogTextOf(job.id, 1).includes('after-the-line'), 'the fresh session never took its first message');
    await passOnce(drivePass);

    const clientLines = (WatcherFleet.eventsAfter(sessionJobFolder(job.id), 1, 0) as readonly EventLogEntry[]).filter((entry) => entry.origin === 'client');
    expect(clientLines.map((entry) => entry.line)).toEqual([JSON.stringify({ kind: 'write', line: firstLine })]);
    expect(existsSync(join(sessionJobFolder(job.id), 'first-message-1.sent'))).toBe(true);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a replaced job\'s fresh session takes the earlier-session note in its first message', async () => {
    const drivePass = await startedOverseer(recordingAdapter({ fresh: [STARTED, { kind: 'await-line' }, { kind: 'crash' }], resumed: [{ kind: 'exit', code: 1 }] }));
    const resumeFailed = (): Readonly<{ id: string; jobId: string | null }> | undefined => (
      (requireProgressFile(sessionWorkspace).incidents ?? []).find((incident) => incident.kind === 'resume-failed')
    );
    await passUntil(drivePass, () => resumeFailed() !== undefined, 'resume-failed never opened');
    const firstJobId = resumeFailed()?.jobId ?? '';
    expect(eventLogTextOf(firstJobId, 1)).toContain(`Example first message of ${firstJobId}`);
    expect(eventLogTextOf(firstJobId, 1)).not.toContain(EARLIER_SESSION_NOTE);

    await writeTracker({
      workspace: sessionWorkspace, at: CHANGED_AT, now, mutate: (change) => { change.board.defaultIncident(resumeFailed()?.id ?? '', 'turn-closed', change.at); },
    });
    await passUntil(drivePass, () => launches.some((launch) => launch.jobId !== firstJobId), 'no fresh job was launched');
    const freshJobId = launches.find((launch) => launch.jobId !== firstJobId)?.jobId ?? '';
    await passUntil(drivePass, () => eventLogTextOf(freshJobId, 1).includes(EARLIER_SESSION_NOTE), 'the fresh session never took the earlier-session note');
  }, ROW_TIMEOUT_MILLISECONDS);

  test('watcher dies with its agent alive: the agent group is killed first, the job is interrupted watcher-lost and resumed by id in place, told so', async () => {
    // The agent's own tool call keeps it alive whatever happens to its input, as a Bash child of a killed CLI does.
    const adapter  = recordingAdapter({ fresh: [STARTED, { kind: 'shell', command: 'sleep 60' }], resumed: LINE_THEN_WAITING_STEPS });
    const job      = await runningBuildSession(await startedOverseer(adapter));
    const child    = requireRecord(job.id, 1).childProcess;
    killWatcher(job.id, 1);
    await until(() => WatcherFleet.livenessOf(sessionJobFolder(job.id), 1).verdict === 'lost', 'the Watcher never read as lost');
    expect(child !== null && child !== undefined && processIsAlive(child), 'the orphaned agent outlives its watcher').toBe(true);

    const restarted = await startedOverseer(adapter);
    const report    = await restarted.regroup();

    expect(report.lost).toEqual([{ jobId: job.id, instance: 1, cause: 'watcher-lost' }]);
    expect(child !== null && child !== undefined && processIsAlive(child)).toBe(false);
    expect(storedRecords().find((record) => record.kind === 'job-interrupted' && record.jobId === job.id)?.fields).toMatchObject({ cause: 'watcher-lost' });
    expect(requireBuildJob()).toMatchObject({
      id: job.id, state: 'running', watcherInstance: 2, crashResumes: 1
    });
    const [freshLaunch, resumeLaunch] = launches;
    expect(resumeLaunch).toEqual({
      jobId: job.id, resume: true, firstMessage: RESUME_MESSAGE, workingDirectory: freshLaunch?.workingDirectory ?? '', sessionId: freshLaunch?.sessionId ?? '',
    });
    await passUntil(restarted, () => eventLogTextOf(job.id, 2).includes('after-the-line'), 'the resumed session never took its first line');
    expect(existsSync(join(sessionJobFolder(job.id), 'resume-message-2.sent'))).toBe(true);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('watcher and agent die with the input open: interrupted agent-crashed, and resumed', async () => {
    const adapter = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS });
    const job     = await runningBuildSession(await startedOverseer(adapter));
    killWatcher(job.id, 1);
    killChildGroup(job.id, 1);
    await until(() => WatcherFleet.livenessOf(sessionJobFolder(job.id), 1).verdict === 'lost', 'the Watcher never read as lost');

    const report = await (await startedOverseer(adapter)).regroup();

    expect(report.lost).toEqual([{ jobId: job.id, instance: 1, cause: 'agent-crashed' }]);
    expect(report.leftoverWorktrees).toEqual([]);
    expect(requireBuildJob()).toMatchObject({
      id: job.id, state: 'running', watcherInstance: 2, crashResumes: 1
    });
    expect(resumedRecordsOf(job.id).map((record) => record.fields)).toEqual([{ watcherInstance: 2, cause: 'agent-crashed' }]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('agent exits with its closing result while the Overseer is down: on regroup the result is read from the event log into verifying', async () => {
    const statesAfterWatcherEvents: (string | undefined)[] = [];
    const adapter = recordingAdapter({ fresh: [STARTED, { kind: 'print', line: fakeResultLine({ outcome: 'built' }) }, { kind: 'await-line' }], resumed: WAITING_STEPS });
    const first   = await startedOverseer(adapter);
    await passUntil(first, () => WatcherFleet.livenessOf(sessionJobFolder(requireBuildJob().id), 1).verdict !== 'unclaimed', 'the build session was never spawned');
    const job = requireBuildJob();
    await until(() => eventLogTextOf(job.id, 1).includes('"result"'), 'the session never closed its turn');

    await (await startedOverseer(adapter, (phase, board) => {
      if (phase === 'watcher-events') statesAfterWatcherEvents.push(board.jobById(job.id)?.state);
    })).regroup();

    expect(statesAfterWatcherEvents[0]).toBe('in-customs');
    expect(storedRecords().filter((record) => record.jobId === job.id && record.kind === 'job-interrupted')).toEqual([]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('agent exits mid-turn with no closing result: interrupted agent-crashed, and resumed', async () => {
    const adapter = recordingAdapter({ fresh: [STARTED, { kind: 'print', line: fakeAssistantTurnLine('mid-turn') }, { kind: 'crash' }], resumed: WAITING_STEPS });
    const drivePass = await startedOverseer(adapter);
    await passUntil(drivePass, () => resumedRecordsOf(buildJobs()[0]?.id ?? '').length > 0, 'the crashed session was never resumed');
    const job = requireBuildJob();
    expect(storedRecords().find((record) => record.kind === 'job-interrupted' && record.jobId === job.id)?.fields).toMatchObject({ cause: 'agent-crashed' });
    expect(job).toMatchObject({ attempt: 1, watcherInstance: 2 });
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a job crash-resumed twice and interrupted again ends replaced, a fresh attempt takes the same worktree, and two replaced in a row open job-lost', async () => {
    const drivePass = await startedOverseer(recordingAdapter({ fresh: CRASHING_STEPS, resumed: CRASHING_STEPS }));
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
    const drivePass = await startedOverseer(recordingAdapter({ fresh: CRASHING_STEPS, resumed: [{ kind: 'exit', code: 1 }] }));
    const resumeFailed = (): Readonly<{ id: string; kind: string; jobId: string | null }> | undefined => (
      (requireProgressFile(sessionWorkspace).incidents ?? []).find((incident) => incident.kind === 'resume-failed')
    );
    await passUntil(drivePass, () => resumeFailed() !== undefined, 'resume-failed never opened');
    const incident   = resumeFailed();
    const firstJobId = incident?.jobId ?? '';
    expect(storedRecords().find((record) => record.kind === 'job-ended' && record.jobId === firstJobId)?.fields).toMatchObject({ outcome: 'replaced', cause: 'resume-failed' });

    await writeTracker({
      workspace: sessionWorkspace, at: CHANGED_AT, now, mutate: (change) => { change.board.defaultIncident(incident?.id ?? '', 'turn-closed', change.at); },
    });
    await passUntil(drivePass, () => launches.some((launch) => launch.jobId !== firstJobId), 'no fresh job was launched');

    const freshLaunch = launches.find((launch) => launch.jobId !== firstJobId);
    expect(freshLaunch).toMatchObject({ resume: false, workingDirectory: launches[0]?.workingDirectory ?? '' });
    expect(launchFacts.find((launch) => launch.jobId === freshLaunch?.jobId)?.facts.earlierSessionReplaced).toBe(true);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('three reboots in a row during one build: three resumes of the same session, none counted, and no fresh agent', async () => {
    const adapter = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS });
    let job = await runningBuildSession(await startedOverseer(adapter));
    for (let rebootNumber = 1; rebootNumber <= 3; rebootNumber += 1) {
      const { id, watcherInstance } = job;
      await until(() => eventLogTextOf(id, watcherInstance).includes('"init"'), 'the session never started');
      await reboot(job.id, job.watcherInstance);
      const restarted = await startedOverseer(adapter);
      const report    = await restarted.regroup();
      expect(report.lost).toEqual([{ jobId: job.id, instance: rebootNumber, cause: 'reboot' }]);
      job = await runningBuildSession(restarted);
    }

    expect(job).toMatchObject({ attempt: 1, watcherInstance: 4, crashResumes: 0 });
    expect(resumedRecordsOf(job.id).map((record) => record.fields['cause'])).toEqual(['reboot', 'reboot', 'reboot']);
    expect(new Set(launches.map((launch) => `${launch.jobId} ${launch.sessionId} ${launch.workingDirectory}`)).size).toBe(1);
    expect(storedRecords().filter((record) => record.kind === 'job-ended')).toEqual([]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a question answered while the Overseer is down: the restart replays it without a second decision and the live Watcher takes the control_response', async () => {
    const adapter = recordingAdapter({ fresh: ASKING_STEPS, resumed: WAITING_STEPS });
    const first   = await startedOverseer(adapter);
    const job     = await runningBuildSession(first);
    await passUntil(first, () => requireBuildJob().state === 'waiting-for-answer', 'the question never opened its decision');
    expect(openDecisions()).toMatchObject([{
      id: 'E1', kind: 'agent-question', jobId: job.id, requestId: 'request-1', questions: [EXAMPLE_QUESTION]
    }]);
    await first.stop();

    await decideWithTheOverseerDown('E1', ['b']);
    expect(requireBuildJob()).toMatchObject({ state: 'running', answeredRequestIds: ['request-1'] });

    const restarted = await startedOverseer(adapter);
    await restarted.regroup();
    await passUntil(restarted, () => eventLogTextOf(job.id, 1).includes('after-the-answer'), 'the live session never took the answer');
    // The Watcher logs the line it wrote inside its own frame, so the answer's quotes read escaped.
    expect(eventLogTextOf(job.id, 1)).toContain('\\"type\\":\\"control_response\\"');
    expect(eventLogTextOf(job.id, 1)).toContain('\\"answers\\":{\\"Ship the example export?\\":\\"No\\"}');
    expect(storedRecords().filter((record) => record.kind === 'decision-opened')).toHaveLength(1);
    expect(requireBuildJob()).toMatchObject({ watcherInstance: 1, state: 'running' });
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a question pending when the machine reboots stays open, nothing resumes until it is answered, and the resume carries the answer', async () => {
    const adapter = recordingAdapter({ fresh: ASKING_STEPS, resumed: LINE_THEN_WAITING_STEPS });
    const first   = await startedOverseer(adapter);
    const job     = await runningBuildSession(first);
    await passUntil(first, () => requireBuildJob().state === 'waiting-for-answer', 'the question never opened its decision');
    await first.stop();
    await reboot(job.id, 1);

    const restarted = await startedOverseer(adapter);
    await restarted.regroup();
    await passOnce(restarted);
    expect(requireBuildJob()).toMatchObject({ state: 'interrupted', interruption: 'reboot', watcherInstance: 1 });
    expect(openDecisions().map((decision) => decision.id)).toEqual(['E1']);

    await decideWithTheOverseerDown('E1', ['a']);
    await passUntil(restarted, () => eventLogTextOf(job.id, 2).includes('after-the-line'), 'the resumed session never took the answer');
    expect(eventLogTextOf(job.id, 2)).toContain(ANSWER_MESSAGE_PREFIX);
    expect(eventLogTextOf(job.id, 2)).not.toContain(RESUME_MESSAGE);
    expect(launches.map((launch) => launch.resume)).toEqual([false, true]);
    expect(requireBuildJob()).toMatchObject({ crashResumes: 0, watcherInstance: 2 });
  }, ROW_TIMEOUT_MILLISECONDS);

  test('without a control_response delivery the Overseer stops the live Watcher and resumes with the answer, cause answer-delivery, never counted', async () => {
    const adapter = recordingAdapter({ fresh: ASKING_STEPS, resumed: LINE_THEN_WAITING_STEPS });
    const drivePass = await startedOverseer(adapter, undefined, false);
    const job       = await runningBuildSession(drivePass);
    await passUntil(drivePass, () => requireBuildJob().state === 'waiting-for-answer', 'the question never opened its decision');

    await decideWithTheOverseerDown('E1', ['a']);
    await passUntil(drivePass, () => eventLogTextOf(job.id, 2).includes('after-the-line'), 'the resumed session never took the answer');

    expect(resumedRecordsOf(job.id).map((record) => record.fields)).toEqual([{ watcherInstance: 2, cause: 'answer-delivery' }]);
    expect(eventLogTextOf(job.id, 1)).not.toContain('control_response');
    expect(eventLogTextOf(job.id, 2)).toContain(ANSWER_MESSAGE_PREFIX);
    expect(requireBuildJob()).toMatchObject({ crashResumes: 0 });
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a worker reports a malformed ticket, then the machine reboots: one incident survives, escalates with the agent\'s words, and the answer resumes it', async () => {
    const adapter = recordingAdapter({ fresh: askingSteps({ ...EXAMPLE_QUESTION, header: 'ticket' }), resumed: LINE_THEN_WAITING_STEPS });
    const first   = await startedOverseer(adapter);
    const job     = await runningBuildSession(first);
    await passUntil(first, () => requireBuildJob().state === 'waiting-for-answer', 'the report never opened its incident');
    expect(openDecisions()).toEqual([]);
    await first.stop();
    await reboot(job.id, 1);

    const restarted = await startedOverseer(adapter);
    await restarted.regroup();
    await passOnce(restarted);
    const incidents = requireProgressFile(sessionWorkspace).incidents ?? [];
    expect(incidents).toMatchObject([{
      id: 'I1', kind: 'malformed-ticket', jobId: job.id, defaultMove: 'incident-escalate'
    }]);
    expect(requireBuildJob()).toMatchObject({ state: 'interrupted', watcherInstance: 1 });

    await writeTracker({
      workspace: sessionWorkspace, at: CHANGED_AT, now, mutate: (change) => change.board.escalateQuestionIncident('I1', change.at),
    });
    expect(openDecisions()).toMatchObject([{
      kind: 'agent-question', jobId: job.id, requestId: 'request-1', questions: [{ ...EXAMPLE_QUESTION, header: 'ticket' }], context: ''
    }]);
    await decideWithTheOverseerDown('E1', ['b']);
    await passUntil(restarted, () => eventLogTextOf(job.id, 2).includes('after-the-line'), 'the resumed session never took the answer');
    expect(eventLogTextOf(job.id, 2)).toContain(ANSWER_MESSAGE_PREFIX);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('overseer dies after the hold that launched a job, before the spawn: regroup re-spawns the same instance', async () => {
    let orchestratorJobId = '';
    await writeTracker({
      workspace: sessionWorkspace,
      at:        CHANGED_AT,
      now,
      mutate:    (change) => {
        orchestratorJobId = change.board.launchJob({
          kind: 'assistant', role: 'assistant', ticketIds: [], parentJobId: null, attempt: 1, target: null
        }, change.at).job.id;
      },
    });

    const report = await (await startedOverseer(recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS }))).regroup();

    expect(report.respawnJobIds).toContain(orchestratorJobId);
    await until(() => WatcherFleet.livenessOf(sessionJobFolder(orchestratorJobId), 1).verdict === 'live', 'the same instance was never claimed');
    expect(storedJobs().find((job) => job.id === orchestratorJobId)?.watcherInstance).toBe(1);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('an orchestrator session finishes only once the Overseer closed its input: a turn\'s result keeps it running, its Watcher gone while stopping ends it closed', async () => {
    const orchestratorSteps: readonly FakeAgentStep[] = [STARTED, { kind: 'print', line: fakeResultLine({ outcome: 'built' }) }, { kind: 'await-line' }];
    const adapter = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS, orchestrator: orchestratorSteps });
    const drivePass        = await startedOverseer(adapter);
    const orchestratorJob  = (): Readonly<Job> | undefined => storedJobs().find((job) => job.kind === 'assistant');
    const orchestratorId   = (): string => orchestratorJob()?.id ?? '';
    await passUntil(drivePass, () => orchestratorJob() !== undefined && eventLogTextOf(orchestratorId(), 1).includes('"result"'), 'the orchestrator never ended a turn');
    await passOnce(drivePass);
    expect(orchestratorJob()).toMatchObject({ state: 'running', watcherInstance: 1 });

    const jobId = orchestratorId();
    await writeTracker({
      workspace: sessionWorkspace, at: CHANGED_AT, now, mutate: (change) => { change.board.moveJob(jobId, 'stopping', change.at); },
    });
    killWatcher(jobId, 1);
    killChildGroup(jobId, 1);
    await until(() => WatcherFleet.livenessOf(sessionJobFolder(jobId), 1).verdict === 'lost', 'the orchestrator Watcher never read as lost');
    await passUntil(drivePass, () => storedRecords().some((record) => record.kind === 'job-ended' && record.jobId === jobId), 'the stopped orchestrator never ended');

    expect(storedRecords().find((record) => record.kind === 'job-ended' && record.jobId === jobId)?.fields).toMatchObject({ outcome: 'closed' });
    expect(storedRecords().filter((record) => record.kind === 'job-interrupted' && record.jobId === jobId)).toEqual([]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('Assistant mid-turn, Overseer restarted: the session continues, its turn\'s result is read from history and closes the delivery turn', async () => {
    const assistantSteps: readonly FakeAgentStep[] = [STARTED, FIRST_TURN_RESULT, { kind: 'await-line' }, FIRST_TURN_RESULT, { kind: 'await-line' }];
    const adapter   = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS, orchestrator: assistantSteps });
    const drivePass = await startedOverseer(adapter);
    await passUntil(drivePass, () => assistantAnswered(1), 'the Assistant never answered its first message');
    const assistantId = requireAssistant().id;
    await openBlockedIncident();
    await passUntil(drivePass, () => openIncidents()[0]?.deliveredInTurn?.chatSequence === 2, 'the incident was never delivered as chat 2');
    await drivePass.stop();
    // The Overseer is down from here: the Assistant answers chat 2, a result nobody applies.
    await until(() => assistantAnswered(2), 'the Assistant never answered chat 2');

    const successor = await startedOverseer(adapter);
    await successor.regroup();
    await passUntil(successor, () => openIncidents().length === 0, 'the closed turn never defaulted its incident');

    expect(requireAssistant()).toMatchObject({ id: assistantId, state: 'running', watcherInstance: 1 });
    expect(storedRecords().find((record) => record.kind === 'incident-defaulted')?.fields).toMatchObject({ cause: 'turn-closed' });
    expect(storedRecords().filter((record) => record.jobId === assistantId && ['job-interrupted', 'job-ended'].includes(record.kind))).toEqual([]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('Assistant move queued just before its turn\'s result: the move is applied before the turn\'s default, which never comes', async () => {
    const releaseFile = join(monitorFolder, 'release-the-result');
    const assistantSteps: readonly FakeAgentStep[] = [
      STARTED,
      FIRST_TURN_RESULT,
      { kind: 'await-line' },
      { kind: 'shell', command: `while [ ! -f '${releaseFile}' ]; do sleep 0.02; done` },
      FIRST_TURN_RESULT,
      { kind: 'await-line' },
    ];
    let moveIsDue = false;
    const queueTheMoveThenAnswer = (): void => {
      if (!moveIsDue) return;
      moveIsDue = false;
      const assistant = requireAssistant();
      writeHatchRequest(HatchInbox.hatchDirectoryOf(repository, assistant.id), {
        hatchFormatVersion: 1,
        requestId:          'request-park',
        command:            {
          kind: 'ticket-park', ticketReference: '001', reason: 'Example park reason', incidentId: openIncidents()[0]?.id ?? ''
        },
      });
      writeFileSync(releaseFile, '');
      for (let attempt = 0; attempt < WAIT_TRIES && !assistantAnswered(2); attempt += 1) Bun.sleepSync(WAIT_MILLISECONDS);
    };
    const adapter   = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS, orchestrator: assistantSteps });
    const drivePass = await startedOverseer(adapter, undefined, undefined, queueTheMoveThenAnswer);
    await passUntil(drivePass, () => assistantAnswered(1), 'the Assistant never answered its first message');
    await openBlockedIncident();
    await passUntil(drivePass, () => openIncidents()[0]?.deliveredInTurn?.chatSequence === 2, 'the incident was never delivered as chat 2');
    moveIsDue = true;
    await passUntil(drivePass, () => openIncidents().length === 0, 'the incident never closed');

    expect(assistantAnswered(2)).toBe(true);
    expect(storedRecords().filter((record) => ['incident-handled', 'incident-defaulted'].includes(record.kind)).map((record) => record.kind)).toEqual(['incident-handled']);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('Assistant down during a delivery turn: ended replaced, cause assistant-down, never resumed, and a fresh one\'s first message carries the incident', async () => {
    const assistantSteps: readonly FakeAgentStep[] = [STARTED, FIRST_TURN_RESULT, { kind: 'await-line' }, { kind: 'crash' }];
    const drivePass = await startedOverseer(recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS, orchestrator: assistantSteps }));
    await passUntil(drivePass, () => assistantAnswered(1), 'the Assistant never answered its first message');
    const downId = requireAssistant().id;
    await openBlockedIncident();
    await passUntil(drivePass, () => (requireAssistant().id !== downId), 'no fresh Assistant was booted');

    expect(storedRecords().find((record) => record.kind === 'job-ended' && record.jobId === downId)?.fields).toMatchObject({ outcome: 'replaced', cause: 'assistant-down' });
    expect(resumedRecordsOf(downId)).toEqual([]);
    const fresh = requireAssistant();
    expect(openIncidents().map((incident) => incident.deliveredInTurn)).toEqual([{ jobId: fresh.id, chatSequence: 1 }]);
    expect(launchFacts.find((launched) => launched.jobId === fresh.id)?.facts.assistant?.incidents.map((incident) => incident.kind)).toEqual(['blocked']);
    const freshLaunch = assistantLaunches.find((request) => basename(request.jobFilesDirectory) === fresh.id);
    expect(freshLaunch).toMatchObject({
      resume: false, model: 'sonnet', effort: 'medium', reportSchema: null
    });
    expect(freshLaunch?.workingDirectory).toBe(join(repository, PRODUCT_NAMES.WORKTREES_FOLDER, 'sessions', fresh.id));
    // No question tool and no network: the adapter disallows AskUserQuestion, WebFetch and WebSearch from these.
    expect(freshLaunch?.profile).toMatchObject({ askUser: false, webNetworkDomains: 'none', bashNetworkDomains: [] });
  }, ROW_TIMEOUT_MILLISECONDS);

  test('no Assistant can come up: two boots failing before a result default every incident, and the next boot waits for a sweep', async () => {
    const drivePass = await startedOverseer(recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS, orchestrator: CRASHING_STEPS }));
    await openBlockedIncident();
    await passUntil(drivePass, () => failedAssistantBoots() === 2, 'two Assistant boots never failed');
    await passUntil(drivePass, () => openIncidents().length === 0, 'the open incident never took its default');
    await passOnce(drivePass);
    await passOnce(drivePass);

    expect(storedRecords().find((record) => record.kind === 'incident-defaulted')?.fields).toMatchObject({ cause: 'no-assistant' });
    expect(storedJobs().filter((job) => job.kind === 'assistant')).toEqual([]);

    drivePass.sweep();
    await drivePass.idle();
    expect(storedRecords().filter((record) => record.kind === 'job-launched' && record.fields['kind'] === 'assistant')).toHaveLength(3);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a product owner stopped by User with its question open is finished: the decision withdrawn in that hold, and it ends closed, never resumed by itself', async () => {
    const adapter = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS, productOwner: { fresh: ASKING_STEPS, resumed: WAITING_STEPS } });
    const drivePass = await startedOverseer(adapter);
    await applyControl({ kind: 'intake-start', text: 'Example basket' });
    await passUntil(drivePass, () => productOwnerJob()?.state === 'waiting-for-answer', 'the product owner never asked');
    const jobId = productOwnerJob()?.id ?? '';

    await applyControl({ kind: 'job-stop', jobId, mode: 'stop' });
    expect(openDecisions()).toEqual([]);
    expect(storedRecords().filter((record) => record.kind === 'decision-withdrawn').map((record) => record.fields)).toHaveLength(1);
    await passUntil(drivePass, () => productOwnerJob() === undefined, 'the stopped product owner never ended');

    expect(storedRecords().find((record) => record.kind === 'job-ended' && record.jobId === jobId)?.fields).toMatchObject({ outcome: 'closed' });
    expect(resumedRecordsOf(jobId)).toEqual([]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a product owner interrupted by a reboot at its question waits, and resumes by id once the question is answered', async () => {
    const adapter = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS, productOwner: { fresh: ASKING_STEPS, resumed: LINE_THEN_WAITING_STEPS } });
    const first = await startedOverseer(adapter);
    await applyControl({ kind: 'intake-start', text: 'Example basket' });
    await passUntil(first, () => productOwnerJob()?.state === 'waiting-for-answer', 'the product owner never asked');
    const jobId = productOwnerJob()?.id ?? '';
    await first.stop();
    await reboot(jobId, 1);

    const restarted = await startedOverseer(adapter);
    await restarted.regroup();
    await passOnce(restarted);
    expect(productOwnerJob()).toMatchObject({ state: 'interrupted', interruption: 'reboot', watcherInstance: 1 });

    await decideWithTheOverseerDown(openDecisions()[0]?.id ?? '', ['a']);
    await passUntil(restarted, () => eventLogTextOf(jobId, 2).includes('after-the-line'), 'the resumed product owner never took the answer');
    expect(resumedRecordsOf(jobId).map((record) => record.fields)).toEqual([{ watcherInstance: 2, cause: 'reboot' }]);
    expect(eventLogTextOf(jobId, 2)).toContain(ANSWER_MESSAGE_PREFIX);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a product owner closed by its own intake-close quietly, then messaged by User, resumes by id in the same folder with the message first', async () => {
    const productOwnerLaunches: RecordedLaunch[] = [];
    const scenario = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS, productOwner: { fresh: WAITING_STEPS, resumed: LINE_THEN_WAITING_STEPS } });
    const adapter: AgentAdapter = {
      ...scenario,
      planOf(request) {
        if (request.profile.skills) {
          productOwnerLaunches.push({
            jobId:            basename(request.jobFilesDirectory),
            resume:           request.resume,
            firstMessage:     request.firstMessage,
            workingDirectory: request.workingDirectory,
            sessionId:        request.sessionId,
          });
        }
        return scenario.planOf(request);
      },
    };
    const drivePass = await startedOverseer(adapter);
    await applyControl({ kind: 'intake-start', text: 'Example basket' });
    await passUntil(drivePass, () => sessionRuns(productOwnerJob()), 'the product owner never ran');
    const jobId = productOwnerJob()?.id ?? '';
    await applyControl({ kind: 'intake-close', jobId, proposedDraftSets: [] });
    await passUntil(drivePass, () => productOwnerJob() === undefined, 'the closed product owner never ended');
    expect(storedRecords().find((record) => record.kind === 'job-ended' && record.jobId === jobId)?.fields).toMatchObject({ outcome: 'closed' });
    expect(storedRecords().filter((record) => record.kind === 'incident-opened')).toEqual([]);
    expect(drivePass.state().notices).toEqual([]);

    await applyControl({ kind: 'job-message', jobId, text: 'Example follow-up from Alex Example' });
    expect(productOwnerJob()).toMatchObject({ id: jobId, state: 'running', watcherInstance: 2 });
    await passUntil(drivePass, () => eventLogTextOf(jobId, 2).includes('after-the-line'), 'the reopened product owner never took the message');

    const [first, reopened] = productOwnerLaunches;
    expect(reopened).toEqual({
      jobId, resume: true, firstMessage: 'Example follow-up from Alex Example', workingDirectory: first?.workingDirectory ?? '', sessionId: first?.sessionId ?? '',
    });
    expect(first?.resume).toBe(false);
    expect(eventLogTextOf(jobId, 2)).toContain('Example follow-up from Alex Example');
    expect(eventLogTextOf(jobId, 2)).not.toContain(RESUME_MESSAGE);
    expect(storedRecords().filter((record) => record.kind === 'job-reopened' && record.jobId === jobId).map((record) => record.fields['watcherInstance'])).toEqual([2]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a ticket held while its job runs interrupts nothing', async () => {
    const drivePass = await startedOverseer(recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS }));
    const job       = await runningBuildSession(drivePass);
    await writeTracker({
      workspace: sessionWorkspace, at: CHANGED_AT, now, mutate: (change) => { change.board.holdTicket('001', 'Waiting on Alex Example', change.at); },
    });
    await passOnce(drivePass);
    expect(requireBuildJob()).toMatchObject({ id: job.id, state: 'running', watcherInstance: 1 });
    expect(WatcherFleet.livenessOf(sessionJobFolder(job.id), 1).verdict).toBe('live');
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a resolver merge agent launches bound to the resolver report schema, with the question tool disallowed', async () => {
    const plans = new Map<string, { reportTitle: unknown; askUser: boolean }>();
    const adapter: AgentAdapter = {
      ...fakeAgentAdapter(),
      planOf(request) {
        plans.set(basename(request.jobFilesDirectory), { reportTitle: (request.reportSchema as { title?: string } | null)?.title, askUser: request.profile.askUser });
        return fakeAgentAdapter(WAITING_STEPS).planOf(request);
      },
    };
    let resolverJobId = '';
    await writeTracker({
      workspace: sessionWorkspace,
      at:        CHANGED_AT,
      now,
      mutate:    (change) => {
        resolverJobId = change.board.launchJob({
          kind: 'merge-agent', role: 'resolver', ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main',
        }, change.at).job.id;
      },
    });
    await passOnce(await startedOverseer(adapter));
    expect(plans.get(resolverJobId)).toEqual({ reportTitle: 'resolver report', askUser: false });
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a resolver merge agent launches under the resolver profile: the target ref denied, the git verbs allowed, no network', async () => {
    const profiles = new Map<string, WorkerProfile>();
    const adapter: AgentAdapter = {
      ...fakeAgentAdapter(),
      planOf(request) {
        profiles.set(basename(request.jobFilesDirectory), request.profile);
        return fakeAgentAdapter(WAITING_STEPS).planOf(request);
      },
    };
    let resolverJobId = '';
    await writeTracker({
      workspace: sessionWorkspace,
      at:        CHANGED_AT,
      now,
      mutate:    (change) => {
        resolverJobId = change.board.launchJob({
          kind: 'merge-agent', role: 'resolver', ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main',
        }, change.at).job.id;
      },
    });
    await passOnce(await startedOverseer(adapter));
    const profile = profiles.get(resolverJobId);
    expect(profile?.deniedWritableRoots.some((path) => path.endsWith(join('refs', 'heads', currentBranchOf(repository))))).toBe(true);
    expect(profile?.deniedWritableRoots.some((path) => path.endsWith('packed-refs'))).toBe(true);
    expect(profile?.allowedCommandPrefixes).toEqual(expect.arrayContaining([['git', 'add'], ['git', 'commit']]));
    expect(profile).toMatchObject({
      bashNetworkDomains: [], webNetworkDomains: 'none', askUser: false, networkDomainGuard: null
    });
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a group refresh\'s resolver takes its profile from the refresh worktree: its own admin folder writable, the group branch and every ticket branch denied', async () => {
    const groupBranch   = 'group-example';
    const ticketBranches = ['ticket-001', 'ticket-002'];
    for (const branch of [groupBranch, ...ticketBranches]) gitOutputIn(repository, ['branch', branch]);
    const worktreesRoot   = join(repository, PRODUCT_NAMES.WORKTREES_FOLDER);
    const refreshWorktree = GroupWorktrees.refreshWorktreeOf(worktreesRoot, groupBranch);
    GroupWorktrees.prepareRefreshWorktree(repository, worktreesRoot, groupBranch, gitOutputIn(repository, ['rev-parse', groupBranch]).trim());
    const refreshAdminFolder = gitOutputIn(refreshWorktree, ['rev-parse', '--absolute-git-dir']).trim();
    const profiles = new Map<string, WorkerProfile>();
    const adapter: AgentAdapter = {
      ...fakeAgentAdapter(),
      planOf(request) {
        profiles.set(basename(request.jobFilesDirectory), request.profile);
        return fakeAgentAdapter(WAITING_STEPS).planOf(request);
      },
    };
    let resolverJobId = '';
    await writeTracker({
      workspace: sessionWorkspace,
      at:        CHANGED_AT,
      now,
      mutate:    (change) => {
        resolverJobId = change.board.launchJob({
          kind: 'merge-agent', role: 'resolver', ticketIds: [], parentJobId: null, attempt: 1, target: groupBranch,
        }, change.at).job.id;
      },
    });
    await passOnce(await startedOverseer(adapter));
    const deniedWritableRoots = profiles.get(resolverJobId)?.deniedWritableRoots ?? [];
    const deniesRef = (branch: string): boolean => deniedWritableRoots.some((path) => path.endsWith(join('refs', 'heads', branch)));
    expect(deniedWritableRoots).not.toBeEmpty();
    expect(deniedWritableRoots.map((path) => basename(path))).not.toContain(basename(refreshAdminFolder));
    expect(deniesRef(groupBranch)).toBe(true);
    expect(ticketBranches.filter((branch) => !deniesRef(branch))).toEqual([]);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('a finished session is never continued: a move of an ended job is refused job-finished', async () => {
    const failure = await failureOf(() => writeTracker({
      workspace: sessionWorkspace,
      at:        CHANGED_AT,
      now,
      mutate:    (change) => {
        const { job } = change.board.launchJob({
          kind: 'assistant', role: 'assistant', ticketIds: [], parentJobId: null, attempt: 1, target: null
        }, change.at);
        change.board.endJob(job.id, { outcome: 'closed' }, change.at);
        change.board.moveJob(job.id, 'running', change.at);
      },
    }));
    expect(refusalIsOperationRefusal(failure) ? JSON.stringify(failure.detail) : String(failure)).toContain('job-finished');
  });

  test('a reused pid is never signalled: a lost Watcher whose recorded child names another process reads agent-crashed', () => {
    // Outside the jobs folder, so the cleanup that kills every recorded Watcher never reads this spec's own process.
    const jobFolder = join(monitorFolder, 'J99');
    mkdirSync(jobFolder, { recursive: true });
    const self = identityOf(process.pid);
    if (self === null) throw new Error('this process has no readable identity');
    const reused = { ...self, startEpochSeconds: self.startEpochSeconds - 1 };
    writeFileSync(watcherFilesOf(jobFolder, 1).watcherRecordPath, `${JSON.stringify({
      protocolVersion: 1, eventLogFormatVersion: 1, watcherInstance: 1, state: 'running', watcher: reused, childProcess: reused, childProcessGroupId: process.pid,
    })}\n`);
    expect(WatcherFleet.livenessOf(jobFolder, 1).verdict).toBe('lost');
    expect(Regrouping.settleLostWatcher(jobFolder, 1)).toBe('agent-crashed');
    expect(processIsAlive(self)).toBe(true);
  });

  test('a worktree folder no job or branch owns opens leftover-worktree to User once, however often the Overseer starts', async () => {
    const worktreesRoot = join(repository, PRODUCT_NAMES.WORKTREES_FOLDER);
    mkdirSync(join(worktreesRoot, 'ticket-999'), { recursive: true });
    mkdirSync(join(worktreesRoot, 'onboard', 'J9'), { recursive: true });
    gitOutputIn(repository, ['worktree', 'add', '-q', '-b', 'example-owned', join(worktreesRoot, 'example-owned')]);
    await writeTracker({
      workspace: sessionWorkspace, at: CHANGED_AT, now, mutate: (change) => { change.board.setOverseerState('paused', change.at); },
    });
    const adapter = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS });

    const report = await (await startedOverseer(adapter)).regroup();
    await (await startedOverseer(adapter)).regroup();

    expect(report.leftoverWorktrees.map((folder) => basename(folder))).toEqual(['ticket-999']);
    const decisions = (requireProgressFile(sessionWorkspace).decisions ?? []).filter((decision) => decision.kind === 'leftover-worktree');
    expect(decisions.map((decision) => basename(decision.context))).toEqual(['ticket-999']);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('run restart mid-session or mid-gate: the Baton pass sends no Watcher anything, and the successor regroups it from the stored cursor', async () => {
    const adapter   = recordingAdapter({ fresh: WAITING_STEPS, resumed: WAITING_STEPS });
    const oldOverseer = await startedOverseer(adapter);
    const job       = await runningBuildSession(oldOverseer);
    const child     = requireRecord(job.id, 1).childProcess;
    const { overseerDirectory } = overseerFilesIn(sessionWorkspace.trackerDirectory);
    const batonPassFilePath = BatonPass.batonPassFilePathOf(overseerDirectory, oldOverseer.state().generation);
    BatonPass.writeBatonPass(batonPassFilePath, { state: 'requested' });
    const self = identityOf(process.pid);
    const successorReports: Awaited<ReturnType<DrivePass['regroup']>>[] = [];

    const [outcome] = await Promise.all([
      BatonPass.handOver({
        batonPassFilePath,
        successor:            self,
        successorCodeVersion: 'code-example',
        release:              () => oldOverseer.stop(),
        recordFailure:        () => Promise.resolve(),
        schedule:             { readyTries: WAIT_TRIES, releaseTries: WAIT_TRIES, intervalMilliseconds: WAIT_MILLISECONDS },
      }),
      (async () => {
        const schedule = { readyTries: WAIT_TRIES, releaseTries: WAIT_TRIES, intervalMilliseconds: WAIT_MILLISECONDS };
        const request  = {
          batonPassFilePath, codeVersion: 'code-example', predecessorIsLive: () => true, schedule
        };
        const readWatcherFiles = { step: 'read-watcher-files' as const, run: () => { if (watcherRecordOf(job.id, 1) === null) throw new Error('no Watcher file'); } };
        expect(await BatonPass.prepareAndAwaitRelease(request, [readWatcherFiles])).toBe('released');
        const successor = await startedOverseer(adapter);
        successorReports.push(await successor.regroup());
        BatonPass.reportServing(request, successor.state().generation, 'http://127.0.0.1:1/');
      })(),
    ]);

    expect(outcome.verdict).toBe('handed-over');
    expect(child !== null && child !== undefined && processIsAlive(child)).toBe(true);
    expect(successorReports[0]?.attached.map((watcher) => [watcher.jobId, watcher.instance])).toContainEqual([job.id, 1]);
    expect(successorReports[0]?.lost).toEqual([]);
    expect(requireBuildJob()).toMatchObject({ id: job.id, state: 'running', watcherInstance: 1 });
    expect(storedRecords().filter((record) => record.kind === 'job-interrupted')).toEqual([]);
    expect(launches.filter((launch) => launch.jobId === job.id)).toHaveLength(1);
  }, ROW_TIMEOUT_MILLISECONDS);

  test('overseer updated while Watchers run an older protocol: outside the window the Watcher is legacy, watched from its files and stopped by its group', async () => {
    const adapter = recordingAdapter({ fresh: LINE_THEN_WAITING_STEPS, resumed: WAITING_STEPS });
    const job     = await runningBuildSession(await startedOverseer(adapter));
    const record  = requireRecord(job.id, 1);
    // A Watcher spawned by code whose protocol the updated Overseer no longer speaks.
    writeFileSync(watcherFilesOf(sessionJobFolder(job.id), 1).watcherRecordPath, `${JSON.stringify({ ...record, protocolVersion: WATCHER_PROTOCOL_OLDEST_SUPPORTED - 1 })}\n`);

    const updatedOverseer = await startedOverseer(adapter);
    const report        = await updatedOverseer.regroup();

    expect(report.attached.map((watcher) => watcher.jobId)).not.toContain(job.id);
    expect(report.legacyHosts).toEqual([{ jobId: job.id, instance: 1, protocolVersion: WATCHER_PROTOCOL_OLDEST_SUPPORTED - 1 }]);
    expect(updatedOverseer.state().legacyWatcherJobIds).toEqual([job.id]);
    expect(WatcherFleet.eventsAfter(sessionJobFolder(job.id), 1, 0)).not.toBe('malformed');
    expect(requireBuildJob()).toMatchObject({ id: job.id, state: 'running', watcherInstance: 1 });

    expect(await WatcherFleet.sendFrames(sessionJobFolder(job.id), 1, [{ kind: 'write', line: adapter.chatLineOf('Example line') }])).toBe(false);
    expect(await WatcherFleet.sendFrames(sessionJobFolder(job.id), 1, [{ kind: 'stop', graceMilliseconds: 1 }])).toBe(true);
    const child = record.childProcess;
    await until(() => child === null || child === undefined || !processIsAlive(child), 'the legacy watcher\'s agent group was never stopped');
  }, ROW_TIMEOUT_MILLISECONDS);
});

describeWhenGitIsPresent('the main-line merge rows', () => {
  function conflicted(): ReturnType<typeof createAirlocksHarness> {
    const harness = createAirlocksHarness([{ id: '001', change: ['base.ts', 'export const base = 2;\n'] }]);
    commitFile(harness.repository, 'base.ts', 'export const base = 3;\n');
    return harness;
  }

  test('crash after the fast-forward, before the board write: the merged commit is an ancestor of main, so the board side finishes', async () => {
    const harness = createAirlocksHarness([{ id: '001', change: ['checkout.ts', 'export const checkout = 1;\n'] }]);
    harness.settings.beforeGate = () => gitOutputIn(harness.repository, ['merge', '-q', '--ff-only', gitOutputIn(harness.worktreeOf('001'), ['rev-parse', 'HEAD'])]);
    await harness.slots.sweep();
    expect(harness.board.tickets()[0]?.frontmatter.status).toBe('delivered');
    harness.remove();
  });

  test('mid-merge with no live holder: merge --abort, a reset to branchTip and a requeue', async () => {
    const harness = conflicted();
    const branchTip = harness.tipOf('ticket-001');
    harness.board.claimAirlock({
      ticketId: '001', target: 'main', targetTip: harness.tipOf('main'), branchTip, predictedConflictFiles: ['base.ts']
    }, () => 'main', HARNESS_AT);
    Bun.spawnSync(['git', 'merge', '--no-ff', '--no-edit', harness.tipOf('main')], { cwd: harness.worktreeOf('001') });
    const orphanedJobId = harness.mergeJob()?.id;
    await harness.slots.sweep();
    const ended = harness.board.logRecordsSoFar().find((record) => record.kind === 'job-ended' && record.jobId === orphanedJobId);
    expect(ended?.kind === 'job-ended' ? ended.fields.cause : null).toBe('orphaned');
    expect(harness.mergeJob()?.slot?.branchTip).toBe(branchTip);
    harness.remove();
  });

  test('restart during a live or interrupted resolver: the slot is kept, and the resolution then lands', async () => {
    const harness = conflicted();
    await harness.slots.sweep();
    const agentId = harness.mergeAgent()?.id ?? '';
    harness.board.moveJob(agentId, 'running', HARNESS_AT);
    harness.board.interruptJob(agentId, 'reboot', HARNESS_AT);
    const restarted = harness.slots;
    await restarted.sweep();
    expect(harness.mergeJob()?.slot?.phase).toBe('resolving');
    harness.board.moveJob(agentId, 'running', HARNESS_AT);
    resolveAs(harness, '001', 'base.ts', 'export const base = 4;\n');
    await harness.slots.sweep();
    expect(harness.board.tickets()[0]?.frontmatter.status).toBe('delivered');
    harness.remove();
  });

  test('target moved by hand: the compare-and-swap requeues from branchTip and never lands on the moved tip', async () => {
    const harness = createAirlocksHarness([{ id: '001', change: ['checkout.ts', 'export const checkout = 1;\n'] }]);
    harness.settings.beforeGate = () => {
      commitFile(harness.repository, 'by-hand.ts', 'export const byHand = true;\n');
      harness.settings.beforeGate = () => undefined;
    };
    await harness.slots.sweep();
    const landed = harness.board.logRecordsSoFar().filter((record) => record.kind === 'merge-landed');
    expect(landed).toHaveLength(1);
    gitOutputIn(harness.repository, ['merge-base', '--is-ancestor', harness.tipOf('main'), landed[0]?.kind === 'merge-landed' ? landed[0].fields.commit : '']);
    harness.remove();
  });
});

describeWhenGitIsPresent('the group merge rows', () => {
  const groupWorktreeOf = (repository: string): string => join(`${repository}-worktrees`, 'group-example');

  test('crash after a group ticket\'s fast-forward, before the board write: the merged commit is an ancestor of the group tip, so it is approved', async () => {
    const harness = createAirlocksHarness([{ id: '010', group: 'example', change: ['cart.ts', 'export const cart = 1;\n'] }]);
    const mergedCommit = (): string => gitOutputIn(harness.worktreeOf('010'), ['rev-parse', 'HEAD']);
    harness.settings.beforeGate = () => gitOutputIn(groupWorktreeOf(harness.repository), ['merge', '-q', '--ff-only', mergedCommit()]);
    await harness.slots.sweep();
    expect(harness.board.tickets()[0]?.frontmatter.status).toBe('reviewed');
    expect(harness.board.logRecordsSoFar().filter((record) => record.kind === 'merge-landed')).toHaveLength(1);
    harness.remove();
  });

  test('crash after the release\'s fast-forward of main, before the board write: the whole bundle is delivered', async () => {
    const harness = createAirlocksHarness([
      {
        id: '010', group: 'example', status: 'reviewed', change: ['cart.ts', 'export const cart = 1;\n']
      },
      {
        id: '012', group: 'example', releasesGroup: true, dependsOn: ['010'], change: ['release.ts', 'export const release = 1;\n']
      },
    ]);
    harness.settings.beforeGate = () => gitOutputIn(harness.repository, ['merge', '-q', '--ff-only', gitOutputIn(harness.worktreeOf('012'), ['rev-parse', 'HEAD'])]);
    await harness.slots.sweep();
    expect(harness.board.tickets().map((ticket) => ticket.frontmatter.status)).toEqual(['delivered', 'delivered']);
    harness.remove();
  });

  test('a refresh mid-merge with no live holder: aborted, its temporary worktree removed, and never two refreshes on the group at once', async () => {
    const harness = createAirlocksHarness([{
      id: '010', group: 'example', status: 'reviewed', change: ['base.ts', 'export const base = 2;\n']
    }]);
    commitFile(harness.repository, 'base.ts', 'export const base = 3;\n');
    const worktreesRoot = `${harness.repository}-worktrees`;
    const groupTip = harness.tipOf('group-example');
    const { job: orphaned } = harness.board.claimRefreshSlot({
      group: 'example', target: 'group-example', targetTip: groupTip, mainTip: harness.tipOf('main')
    }, HARNESS_AT);
    const refreshWorktree = GroupWorktrees.refreshWorktreeOf(worktreesRoot, 'group-example');
    GroupWorktrees.prepareRefreshWorktree(harness.repository, worktreesRoot, 'group-example', groupTip);
    Bun.spawnSync(['git', 'merge', '--no-ff', '--no-edit', harness.tipOf('main')], { cwd: refreshWorktree });

    await harness.slots.sweep();

    const ended = harness.board.logRecordsSoFar().find((record) => record.kind === 'job-ended' && record.jobId === orphaned.id);
    expect(ended?.kind === 'job-ended' ? ended.fields.cause : null).toBe('orphaned');
    const refreshes = harness.board.jobs().filter((job) => job.kind === 'refresh');
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.slot?.phase).toBe('resolving');
    expect(harness.tipOf('group-example')).toBe(groupTip);
    harness.remove();
  });
});

describe('the product-owner bound row', () => {
  const at = '2026-09-18T22:11:03+02:00';
  const observations = {
    mainLine:                     'main',
    groupTargetPrefix:            'group-',
    installVersionChanged:        false,
    targetsHoldingManagedBlock:   [],
    ticketIdsTouchingAgentConfig: [],
    closedDeliveryTurns:          [],
    budgetSpentDeliveryTurns:     [],
    orchestratorHasAnswered:      false,
    orchestratorBootRetryDue:     false,
  } as const;
  const wordingOf = (): { questions: { question: string; header: string; multiSelect: boolean; options: { label: string; description: string }[] }[]; context: string } => ({
    questions: [{
      question: 'Example?', header: 'example', multiSelect: false, options: []
    }],
    context: '',
  });

  test('a product owner replaced past the bound with a question open waits awaiting-answer; once answered a fresh one takes its drafts and answers, never a resume', () => {
    const { board } = boardFixture({
      tickets: [{
        ...ticketFixture({
          id: '004', status: 'draft', filedByJob: 'J2', title: 'Example basket'
        }),
        body: ''
      }]
    });
    board.setOverseerState('running', at);
    board.launchJob({
      kind: 'assistant', role: 'assistant', ticketIds: [], parentJobId: null, attempt: 1, target: null
    }, at);
    const { job } = board.startIntake('Example basket', at);
    board.moveJob(job.id, 'running', at);
    board.openDecision({
      kind: 'agent-question', ticketIds: [], jobId: job.id, askedBy: 'product-owner', requestId: 'request-1', questions: wordingOf().questions, context: '',
    }, at);
    for (let crash = 0; crash < LIFECYCLE_LIMITS.JOB_RESUMES_BEFORE_FRESH; crash += 1) {
      board.interruptJob(job.id, 'agent-crashed', at);
      board.moveJob(job.id, 'running', at);
    }
    board.interruptJob(job.id, 'agent-crashed', at);

    board.followPlaybook({ ...LIFECYCLE_LIMITS, now: at, usageResetsAt: null }, observations, wordingOf);
    expect(board.jobById(job.id)?.state).toBe('awaiting-answer');
    board.followPlaybook({ ...LIFECYCLE_LIMITS, now: at, usageResetsAt: null }, observations, wordingOf);
    expect(board.jobById(job.id)?.state).toBe('awaiting-answer');

    const [decision] = board.decisions();
    board.answerDecision(decision?.id ?? '', ['Example answer'], at);
    board.followPlaybook({ ...LIFECYCLE_LIMITS, now: at, usageResetsAt: null }, observations, wordingOf);

    expect(board.jobById(job.id)).toBeUndefined();
    const fresh = board.jobs().find((candidate) => candidate.kind === 'product-owner');
    expect(fresh).toMatchObject({
      parentJobId: job.id, state: 'launching', watcherInstance: 1, intake: { text: 'Example basket', carriedAnswers: [{ 'Example?': 'Example answer' }] }
    });
    if (fresh === undefined) throw new Error('no fresh product owner');
    expect(IntakeSessions.intakeFactsOf(board, fresh)?.drafts).toEqual([{ id: '004', title: 'Example basket' }]);
    expect(JobResumption.launchPartsOf(fresh, 'Example first', 'Example resume')).toEqual({ resume: false, firstMessage: 'Example first' });
  });
});
