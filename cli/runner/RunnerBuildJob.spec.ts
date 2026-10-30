/**
 * A build job end to end on a scratch tracker, the fake agent playing the builder through the pinned host bundle. What matters: each step
 * is a job state, from the worktree made off the target tip and the install line in a sandboxed process host, through the closing report,
 * verification and a sandboxed gate, to the Handoff code writes, the finished ticket and the review job the policy launches; and each
 * operational failure opens its own incident or decision rather than a failed pass, while a missing report or an attribution trailer is
 * a failed pass with its cause.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
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

import { hostFilesOf }                                 from '../../src/lib/agent-host/HostFiles.ts';
import type { HostLaunch }                             from '../../src/lib/agent-host/HostLaunch.ts';
import type { HostRecord }                             from '../../src/lib/agent-host/HostRecord.ts';
import type { AgentAdapter }                           from '../../src/lib/agent-launch/AgentAdapter.ts';
import type { AgentLaunchRequest }                     from '../../src/lib/agent-launch/AgentLaunchRequest.ts';
import { processIsGone }                               from '../../src/lib/process-identity/ProcessIdentity.ts';
import type { Job, JobState }                          from '../../src/lib/tracker-model/@types/Job.ts';
import type { PipelineReview }                         from '../../src/lib/tracker-model/@types/Pipeline.ts';
import type { Board }                                  from '../../src/lib/tracker-model/Board.ts';
import { createDrivePass, type DrivePass }             from '../../src/services/runner/DrivePass.ts';
import { HOST_ENTRY_PATH, HostBundle }                 from '../../src/services/runner/HostBundle.ts';
import { HostFleet }                                   from '../../src/services/runner/HostFleet.ts';
import { SANDBOX_EXEC_PATH, createProcessHostSandbox } from '../../src/services/runner/ProcessHostSandbox.ts';
import { runnerFilesIn }                               from '../../src/services/runner/RunnerFiles.ts';
import { RunnerLease }                                 from '../../src/services/runner/RunnerLease.ts';
import { requireWorkspace }                            from '../../src/services/tracker/Workspace.ts';
import { JOB_ID_VARIABLE }                             from '../../src/shared/Environment.ts';
import { DISPATCH_PROTOCOL }                           from '../../src/shared/constants/DispatchProtocol.ts';
import { WIND_DOWN_GRACE_CALLS }                       from '../../src/shared/constants/RunnerLimits.ts';
import {
  type FakeAgentStep,
  FAKE_HEAD_PLACEHOLDER,
  fakeAgentAdapter,
  fakeAssistantTurnLine,
  fakeResultLine,
  fakeStartedLine
} from '../../src/testing/FakeAgentAdapter.ts';
import { inheritedEnvironment }                                            from '../../src/testing/InheritedEnvironment.ts';
import { createScratchDirectory, currentBranchOf, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { runCommandLine }                                                  from '../Main.ts';
import { createCapturedCommandContext }                                    from '../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository }                              from '../testing/InitializedScratchRepository.ts';
import { fileReadyTicket }                                                 from '../testing/ReadyTicketFiling.ts';
import { storedLogTextOf }                                                 from '../testing/StoredLogText.ts';
import { storedProgressOf }                                                from '../testing/StoredProgress.ts';
import { RunnerWording }                                                   from './RunnerWording.ts';

const SPEC_CLOCK = (): Date => new Date('2026-09-18T20:11:03Z');
const PASS_TRIES = 300;
const PASS_INTERVAL_MILLISECONDS = 50;
const BUILD_TEST_TIMEOUT_MILLISECONDS = 60_000;
const WORKTREES_FOLDER = '.agent-progress-v2-worktrees';
const COMMIT = 'git -c user.name="Alex Example" -c user.email=alex@example.com -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -q';

let repositoryDirectory = '';
let monitorFolder = '';
let runnerLog: string[] = [];
let buildStates: string[] = [];
let launchRequests: AgentLaunchRequest[] = [];
let jobsNotingStateAssignments = new WeakSet<object>();
let mainTipAtStart = '';

async function run(commandLineArguments: readonly string[]) {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: SPEC_CLOCK });
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

function noteBuildState(state: string): void {
  if (buildStates.at(-1) !== state) buildStates.push(state);
}

/** Turns the job's `state` into an accessor, so every move the hold makes is noted however briefly the job stands in it. */
function noteEveryStateAssignmentOf(job: Readonly<Job>): void {
  let { state } = job;
  Object.defineProperty(job, 'state', {
    enumerable:   true,
    configurable: true,
    get:          () => state,
    set:          (movedState: JobState) => {
      state = movedState;
      noteBuildState(movedState);
    },
  });
  jobsNotingStateAssignments.add(job);
}

/**
 * Every state the first build job moved through, each recorded once in order; `ended` once it left the board. Each hold reads a fresh
 * board, so the job's stored state is read once, where the hold first shows it, and every move after that is noted as it is assigned.
 */
function recordBuildStateChanges(_phase: string, board: Board): void {
  const buildJob = board.jobs().find((job) => job.kind === 'build' && job.attempt === 1);
  if (buildJob === undefined) {
    if (buildStates.length > 0) noteBuildState('ended');
    return;
  }
  if (!jobsNotingStateAssignments.has(buildJob)) {
    noteBuildState(buildJob.state);
    noteEveryStateAssignmentOf(buildJob);
  }
}

function launchCapturingAdapterOf(adapter: AgentAdapter): AgentAdapter {
  return {
    ...adapter,
    planOf: (request) => {
      launchRequests.push(request);
      return adapter.planOf(request);
    },
  };
}

/** No verb sets the review phase: `pipeline.json` is edited by hand, as User would. */
function setReviewPhase(review: Readonly<PipelineReview>): void {
  const pipelinePath = join(requireWorkspace(repositoryDirectory).trackerDirectory, 'pipeline.json');
  const pipeline = JSON.parse(readFileSync(pipelinePath, 'utf8')) as Record<string, unknown>;
  writeFileSync(pipelinePath, `${JSON.stringify({ ...pipeline, review }, null, 2)}\n`);
}

async function drivePassPlaying(steps: readonly FakeAgentStep[]): Promise<DrivePass> {
  const workspace = requireWorkspace(repositoryDirectory);
  const { runnerDirectory } = runnerFilesIn(workspace.trackerDirectory);
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
    workspace,
    now:                   SPEC_CLOCK,
    formatStamp:           () => '2026-09-18T22:11:03+02:00',
    runnerDirectory,
    generation:            acquisition.generation,
    hostBundlePath,
    codeVersion:           'code-example',
    agentAdapter:          launchCapturingAdapterOf(fakeAgentAdapter(steps)),
    monitorFolder,
    inheritedEnvironment:  inheritedEnvironment(),
    mainLine:              currentBranchOf(repositoryDirectory),
    managedBlockMarker:    '<!-- example-managed-block -->',
    installVersionChanged: () => false,
    decisionWordingOf:     RunnerWording.decisionWordingOf,
    launchTextOf:          () => ({ firstMessage: 'Example first message', roleBrief: 'Example role' }),
    assistantChatTextOf:   (facts) => `Example chat ${facts.sequence}`,
    windDownMessage:       'Example wind-down message',
    resumeMessage:         'Example resume message',
    redHandoffMessageOf:   RunnerWording.redHandoffMessageOf,
    answerMessageOf:       (answer) => `Example answers ${JSON.stringify(answer)}`,
    homeDirectory:         monitorFolder,
    log:                   (line) => runnerLog.push(line),
    onLeaseTakenOver:      () => runnerLog.push('taken over'),
    afterHoldPhase:        recordBuildStateChanges,
  });
}

async function passUntil(drivePass: DrivePass, holds: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < PASS_TRIES; attempt += 1) {
    drivePass.wake(true);
    await drivePass.idle();
    if (holds()) return;
    await Bun.sleep(PASS_INTERVAL_MILLISECONDS);
  }
  const gateFolder = join(jobFolderOf(firstBuildJobId()), 'gate');
  const gateLog = existsSync(gateFolder) ? readdirSync(gateFolder).map((name) => `${name}: ${readFileSync(join(gateFolder, name), 'utf8')}`).join('\n') : '';
  throw new Error(`${what} never happened (states ${buildStates.join(' > ')}, ending ${JSON.stringify(buildJobEnding())}):\n${runnerLog.join('\n')}\n${gateLog}`);
}

function jobFolderOf(jobId: string): string {
  return HostFleet.jobFolderOf(requireWorkspace(repositoryDirectory).trackerDirectory, jobId);
}

interface LoggedEntry {
  kind:   string;
  jobId?: string;
  fields: Record<string, unknown>;
}

function loggedEntries(kind: string): LoggedEntry[] {
  return storedLogTextOf(repositoryDirectory).split('\n').filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LoggedEntry).filter((entry) => entry.kind === kind);
}

function firstBuildJobId(): string {
  return String(loggedEntries('job-launched').find((entry) => entry.fields['kind'] === 'build')?.jobId);
}

function buildJobEnding(): Record<string, unknown> | undefined {
  return loggedEntries('job-ended').find((entry) => entry.jobId === firstBuildJobId())?.fields;
}

function openIncidentKinds(): string[] {
  return (storedProgressOf(repositoryDirectory).incidents ?? []).map((incident) => incident.kind);
}

function ticketText(): string {
  const ticketsFolder = join(requireWorkspace(repositoryDirectory).trackerDirectory, 'tickets');
  const [fileName = ''] = readdirSync(ticketsFolder).filter((name) => name.startsWith('001-'));
  return readFileSync(join(ticketsFolder, fileName), 'utf8');
}

/** Every gate name a spec here adds, claimed on HEAD by default: a claim for a gate the board lacks is ignored. */
const CLAIMED_GATE_NAMES = ['checks', 'types', 'tests', 'lint'];

function builderReport(fields: Record<string, unknown> = {}): string {
  return fakeResultLine({
    role:              'builder',
    outcome:           'built',
    headCommit:        FAKE_HEAD_PLACEHOLDER,
    acceptance:        [{ item: 'A1', state: 'met', evidence: 'Example spec proves it' }, { item: 'A2', state: 'met', evidence: 'Example probe' }],
    alsoFixed:         [],
    gates:             CLAIMED_GATE_NAMES.map((name) => ({ name, commit: FAKE_HEAD_PLACEHOLDER })),
    handoff:           'Example handoff by Alex Example: the example holds.',
    blockedReason:     null,
    cannotBuildReason: null,
    ...fields,
  });
}

/** In the ticket worktree only; the commit retries while a runner `git status` holds the worktree's index lock, as a live session would. */
function commitInTicketWorktree(changeCommand: string, stagedPath: string, commitMessage: string): string {
  const commitOnce = `git add ${stagedPath} && ${COMMIT} -m '${commitMessage}'`;
  return `case "$PWD" in */ticket-*) ${changeCommand} && for attempt in $(seq 50); do ${commitOnce} && break; sleep 0.1; done;; esac`;
}

/**
 * Commits a file, reports, then waits for its input to close, as a builder whose session the runner ends after the report. Only in a
 * ticket's worktree: the orchestrator session plays the same steps in the main checkout, where a commit would move the target, which V14
 * fails as a foreign ref.
 */
function buildingSession(commitMessage = 'Build the example', report = builderReport()): FakeAgentStep[] {
  return [
    { kind: 'print', line: fakeStartedLine('fake-session') },
    { kind: 'shell', command: commitInTicketWorktree('echo built > built.txt', 'built.txt', commitMessage) },
    { kind: 'print', line: report },
    { kind: 'await-line' },
  ];
}

function hostLaunchIn(hostFolder: string): HostLaunch {
  return JSON.parse(readFileSync(hostFilesOf(hostFolder, 1).launchPath, 'utf8')) as HostLaunch;
}

/** Every host and host child a spec spawned is ended, so no fake session or gate outlives the spec. */
function endEveryHost(): void {
  const jobsFolder = join(requireWorkspace(repositoryDirectory).trackerDirectory, 'jobs');
  if (!existsSync(jobsFolder)) return;
  const hostFolders = readdirSync(jobsFolder).flatMap((jobId) => {
    const jobFolder = join(jobsFolder, jobId);
    return [jobFolder, ...readdirSync(jobFolder).map((name) => join(jobFolder, name)).filter((path) => statSync(path).isDirectory())];
  });
  for (const hostFolder of hostFolders.filter((folder) => existsSync(folder))) {
    for (const fileName of readdirSync(hostFolder).filter((name) => /^host-\d+\.json$/.test(name))) {
      const record = JSON.parse(readFileSync(join(hostFolder, fileName), 'utf8')) as HostRecord;
      for (const target of [record.childProcessGroupId === undefined ? null : -record.childProcessGroupId, record.host?.processId ?? null]) {
        try {
          if (target !== null) process.kill(target, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
    }
  }
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('build-job', ['--project', 'Example Agency'], SPEC_CLOCK);
  monitorFolder = createScratchDirectory('h');
  runnerLog = [];
  buildStates = [];
  launchRequests = [];
  jobsNotingStateAssignments = new WeakSet<object>();
  mainTipAtStart = (await Bun.$`git -C ${repositoryDirectory} rev-parse HEAD`.quiet().text()).trim();
  await run(['run', 'resume']);
  await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Export the example roles']);
});

afterEach(() => {
  endEveryHost();
  removeScratchDirectory(monitorFolder);
  removeScratchDirectory(repositoryDirectory);
});

describe('a build job end to end', () => {
  test('with no review phase a gated build goes straight to the merge queue, and no reviewer or review bar is ever made', async () => {
    await run(['gate', 'none']);
    const drivePass = await drivePassPlaying(buildingSession());
    await passUntil(drivePass, () => loggedEntries('merge-queued').length > 0, 'the merge queuing');
    await passUntil(drivePass, () => loggedEntries('job-ended').some((entry) => entry.fields['outcome'] === 'landed'), 'the landing');

    expect(buildJobEnding()).toMatchObject({ outcome: 'built' });
    expect(loggedEntries('job-launched').map((entry) => entry.fields['kind'])).not.toContain('review');
    expect(loggedEntries('review-bar-started')).toEqual([]);
    expect(storedProgressOf(repositoryDirectory).tasks.some((task) => task.reviewOf !== undefined)).toBe(false);
    expect(loggedEntries('decision-opened')).toEqual([]);
    expect(existsSync(join(jobFolderOf(firstBuildJobId()), 'gate-1'))).toBe(false);
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);

  test('prepares, installs, launches, verifies, gates, writes the Handoff, finishes the ticket and gets a review job launched', async () => {
    await run(['gate', 'add', 'checks', '--', 'true']);
    await run(['gate', 'prepare', 'install', '--', 'true']);
    setReviewPhase({ name: 'Security pass', model: 'sonnet', effort: 'high' });
    const drivePass = await drivePassPlaying(buildingSession());
    await passUntil(drivePass, () => storedProgressOf(repositoryDirectory).jobs?.some((job) => job.kind === 'review') === true, 'the review launch');
    const launchedKindOf = (request: AgentLaunchRequest): unknown => loggedEntries('job-launched')
      .find((entry) => entry.jobId === request.environment[JOB_ID_VARIABLE])?.fields['kind'];
    await passUntil(drivePass, () => launchRequests.some((request) => launchedKindOf(request) === 'review'), 'the reviewer launch');
    const settingsOfKind = (kind: string): unknown[] => launchRequests.filter((request) => launchedKindOf(request) === kind).map((request) => [request.model, request.effort]);
    expect(settingsOfKind('build')).toEqual([['opus', 'medium']]);
    expect(settingsOfKind('review')).toEqual([['sonnet', 'high']]);
    expect(loggedEntries('review-bar-started').map((entry) => entry.fields['name'])).toEqual(['Review 1 #001 — Export the example roles (Security pass)']);

    expect(buildStates).toEqual(['launching', 'preparing', 'running', 'verifying', 'gating', 'ended']);
    expect(buildJobEnding()).toMatchObject({ outcome: 'built' });
    expect(storedProgressOf(repositoryDirectory).jobs?.find((job) => job.kind === 'review')).toMatchObject({ role: 'reviewer', attempt: 1, ticketIds: ['001'] });
    expect(ticketText()).toMatch(/^status: "in-review"$/m);
    expect(ticketText()).toContain('## Handoff\n\nExample handoff by Alex Example: the example holds.\n\n- A1 — Example spec proves it\n- A2 — Example probe\n\n## Brief\n');
    expect(ticketText().match(/^## Handoff$/gm)).toHaveLength(1);
    expect(ticketText()).not.toContain('Filled in by the agent');

    const worktree = join(repositoryDirectory, WORKTREES_FOLDER, 'ticket-001');
    expect((await Bun.$`git -C ${worktree} rev-parse HEAD~1`.quiet().text()).trim()).toBe(mainTipAtStart);
    const jobFolder = jobFolderOf(firstBuildJobId());
    const sandboxApplies = createProcessHostSandbox().isUsable();
    for (const [folder, networkDenied] of [['install', false], ['gate-prepare', false], ['gate-1', true]] as const) {
      const launch = hostLaunchIn(join(jobFolder, folder));
      expect(launch.kind).toBe('process');
      expect(launch.argv[0] === SANDBOX_EXEC_PATH).toBe(sandboxApplies);
      expect(readFileSync(join(jobFolder, folder, 'process-sandbox.sb'), 'utf8').includes('(deny network-outbound')).toBe(networkDenied);
    }
    expect(HostFleet.livenessOf(jobFolder, 1)).toMatchObject({ verdict: 'ended', end: { reason: 'exited', exitCode: 0 } });
    const endedHostProcessIds = [jobFolder, ...['install', 'gate-prepare', 'gate-1'].map((folder) => join(jobFolder, folder))]
      .map((hostFolder) => HostFleet.hostRecordOf(hostFolder, 1)?.host?.processId ?? null);
    expect(endedHostProcessIds).not.toContain(null);
    await passUntil(drivePass, () => endedHostProcessIds.every((processId) => processId === null || processIsGone(processId)), 'the ended hosts reaped');
    expect(loggedEntries('gate-ran').map((entry) => entry.fields)).toEqual([expect.objectContaining({ outcome: 'passed', cached: false })]);
    expect(existsSync(join(requireWorkspace(repositoryDirectory).trackerDirectory, 'gates'))).toBe(false);
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);

  test('runs the gates in order, the first red one stopping the rest, each in its in folder with its own network and writes', async () => {
    await run(['gate', 'add', 'types', '--network', 'registry.example.com', '--writes', '~/.cache/example-types', '--', 'true']);
    await run(['gate', 'add', 'tests', '--', 'echo expected 2, received 3; exit 1']);
    await run(['gate', 'add', 'lint', '--', 'true']);
    const drivePass = await drivePassPlaying(buildingSession());
    await passUntil(drivePass, () => buildJobEnding() !== undefined, 'the build job ending');

    expect(buildJobEnding()).toMatchObject({ outcome: 'failed', cause: 'red-resumes-spent' });
    const jobFolder = jobFolderOf(firstBuildJobId());
    expect(readFileSync(join(jobFolder, 'gate.log'), 'utf8')).toBe('tests\nexpected 2, received 3\n');
    expect(readFileSync(join(jobFolder, 'gate-failure.md'), 'utf8')).toContain('expected 2, received 3');
    expect(existsSync(join(jobFolder, 'gate-3'))).toBe(false);
    const typesProfile = readFileSync(join(jobFolder, 'gate-1', 'process-sandbox.sb'), 'utf8');
    expect(typesProfile.includes('(deny network-outbound')).toBe(false);
    expect(typesProfile).toContain('.cache/example-types');
    expect(readFileSync(join(jobFolder, 'gate-2', 'process-sandbox.sb'), 'utf8').includes('(deny network-outbound')).toBe(true);
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);

  test('a report claiming one gate on HEAD and another on an older commit fails Customs naming the stale one, and no gate runs', async () => {
    await run(['gate', 'add', 'checks', '--', 'true']);
    await run(['gate', 'add', 'types', '--', 'true']);
    const staleClaims = [{ name: 'checks', commit: FAKE_HEAD_PLACEHOLDER }, { name: 'types', commit: mainTipAtStart }];
    const drivePass = await drivePassPlaying(buildingSession('Build the example', builderReport({ gates: staleClaims })));
    await passUntil(drivePass, () => buildJobEnding() !== undefined, 'the build job ending');

    expect(buildJobEnding()).toMatchObject({ outcome: 'failed', cause: 'red-resumes-spent' });
    expect(readFileSync(join(jobFolderOf(firstBuildJobId()), 'gate-failure.md'), 'utf8')).toContain('V15');
    expect(buildStates).not.toContain('gating');
    expect(loggedEntries('gate-ran')).toEqual([]);
    expect(existsSync(join(jobFolderOf(firstBuildJobId()), 'gate-1'))).toBe(false);
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);

  test('a red gate resumes the builder\'s own session by its id twice, told of the handover, and the third red parks the ticket for User', async () => {
    await run(['gate', 'add', 'tests', '--', 'echo expected 2, received 3; exit 1']);
    const drivePass = await drivePassPlaying(buildingSession());
    await passUntil(drivePass, () => buildJobEnding() !== undefined, 'the build job ending');

    const jobId = firstBuildJobId();
    const jobFolder = jobFolderOf(jobId);
    // The same job's next host instances are its resumes: the adapter resumes a job's own session id (ClaudeCodeAdapter.spec.ts).
    expect([1, 2, 3, 4].map((instance) => existsSync(hostFilesOf(jobFolder, instance).launchPath))).toEqual([true, true, true, false]);
    expect(loggedEntries('job-launched').filter((entry) => entry.fields['kind'] === 'build')).toHaveLength(1);
    expect(loggedEntries('job-resumed').map((entry) => entry.fields['cause'])).toEqual(['handoff-red', 'handoff-red']);
    expect(buildJobEnding()).toMatchObject({ outcome: 'failed', cause: 'red-resumes-spent' });
    expect(ticketText()).toContain('parked:red-resumes-spent');
    expect(readFileSync(join(jobFolder, 'red-handoff.json'), 'utf8')).toContain('"resume": 3');
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);

  test('a changed pipeline is gated without a restart, and the row records the hash of the pipeline it was judged by', async () => {
    await run(['gate', 'add', 'checks', '--', 'true']);
    await run(['gate', 'add', 'types', '--', 'true']);
    const drivePass = await drivePassPlaying(buildingSession());
    await passUntil(drivePass, () => buildJobEnding() !== undefined, 'the build job ending');

    expect(buildJobEnding()).toMatchObject({ outcome: 'built' });
    const listed = JSON.parse((await run(['gate', 'list', '--json'])).outputText()) as { pipelineHash: string };
    const progress = JSON.parse(readFileSync(requireWorkspace(repositoryDirectory).progressFilePath, 'utf8')) as { tasks: { ticket: string | null; pipelineHash?: string }[] };
    expect(progress.tasks.find((task) => task.ticket === '001')?.pipelineHash).toBe(listed.pipelineHash);
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);
});

describe('unforced wakes', () => {
  // Steps a pass makes possible by itself change nothing a later observation sees, so only the pass itself can carry them on.
  test('with no install line and the orchestrator quiet, unforced wakes carry a readied ticket\'s job from launching to running', async () => {
    await run(['gate', 'add', 'checks', '--', 'true']);
    await run(['ticket', 'hold', '001']);
    const drivePass = await drivePassPlaying([{ kind: 'print', line: fakeStartedLine('fake-session') }, { kind: 'await-line' }]);
    const orchestratorIsQuiet = (): boolean => storedProgressOf(repositoryDirectory).jobs?.some((job) => job.kind === 'orchestrator' && job.eventCursor.sequence > 0) === true;
    await passUntil(drivePass, orchestratorIsQuiet, 'the orchestrator session starting');
    await run(['ticket', 'unhold', '001']);
    for (let attempt = 0; attempt < PASS_TRIES && !buildStates.includes('running'); attempt += 1) {
      drivePass.wake();
      await drivePass.idle();
      await Bun.sleep(PASS_INTERVAL_MILLISECONDS);
    }
    expect(buildStates.slice(0, 3)).toEqual(['launching', 'preparing', 'running']);
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);
});

describe('operational failures', () => {
  test('an install line that fails opens setup-failed, and the ticket launches nothing while it is open', async () => {
    await run(['gate', 'add', 'checks', '--', 'true']);
    await run(['gate', 'prepare', 'install', '--', 'false']);
    const drivePass = await drivePassPlaying(buildingSession());
    await passUntil(drivePass, () => openIncidentKinds().includes('setup-failed'), 'the setup-failed incident');
    expect(buildJobEnding()).toMatchObject({ outcome: 'stopped', cause: 'setup-failed' });
    await passUntil(drivePass, () => true, 'one more pass');
    expect(storedProgressOf(repositoryDirectory).jobs?.some((job) => job.kind === 'build')).toBe(false);
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);

  test('a worktree that cannot be created opens setup-failed', async () => {
    await run(['gate', 'add', 'checks', '--', 'true']);
    // The branch is checked out elsewhere already, so `git worktree add` refuses it.
    await Bun.$`git -C ${repositoryDirectory} branch ticket-001`.quiet();
    await Bun.$`git -C ${repositoryDirectory} worktree add -q ${join(repositoryDirectory, 'elsewhere')} ticket-001`.quiet();
    const drivePass = await drivePassPlaying(buildingSession());
    await passUntil(drivePass, () => openIncidentKinds().includes('setup-failed'), 'the setup-failed incident');
    expect((storedProgressOf(repositoryDirectory).incidents ?? [])[0]).toMatchObject({ facts: { step: 'worktree' } });
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);

  // Each line passes where `checks` tries it, in the main checkout, and cannot run only on the built tree.
  const cannotRunLines = [['exits 127', 'exit 127'], ['exits 126', 'exit 126'], ['is killed by a signal', 'kill -9 $$']];
  test.each(cannotRunLines)('a checks process that %s opens gate-cannot-run, never a failed pass', async (_name, cannotRun) => {
    await run(['gate', 'add', 'checks', '--', `test ! -f built.txt || ${cannotRun}`]);
    const drivePass = await drivePassPlaying(buildingSession());
    await passUntil(drivePass, () => openIncidentKinds().includes('gate-cannot-run'), 'the gate-cannot-run incident');
    expect(buildJobEnding()).toMatchObject({ outcome: 'stopped', cause: 'gate-cannot-run' });
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);

  test('a report saying blocked opens blocked', async () => {
    await run(['gate', 'add', 'checks', '--', 'true']);
    const drivePass = await drivePassPlaying(buildingSession('Build the example', builderReport({ outcome: 'blocked', blockedReason: 'The example service is down' })));
    await passUntil(drivePass, () => openIncidentKinds().includes('blocked'), 'the blocked incident');
    expect(buildJobEnding()).toMatchObject({ outcome: 'blocked' });
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);

  test('no checks line opens checks-not-set and launches nothing', async () => {
    const drivePass = await drivePassPlaying(buildingSession());
    await passUntil(drivePass, () => (storedProgressOf(repositoryDirectory).decisions ?? []).some((decision) => decision.kind === 'checks-not-set'), 'the checks-not-set decision');
    await passUntil(drivePass, () => true, 'one more pass');
    expect(loggedEntries('job-launched').filter((entry) => entry.fields['kind'] === 'build')).toEqual([]);
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);
});

describe('failed passes', () => {
  test('an attribution trailer fails the pass with cause attribution and shows the attribution-found notice', async () => {
    await run(['gate', 'add', 'checks', '--', 'true']);
    const drivePass = await drivePassPlaying(buildingSession('Build the example\n\nCo-Authored-By: Claude <noreply@example.com>'));
    await passUntil(drivePass, () => buildJobEnding() !== undefined, 'the build job ending');
    expect(buildJobEnding()).toMatchObject({ outcome: 'failed', cause: 'attribution' });
    expect(drivePass.state().notices).toContainEqual({ kind: 'attribution-found', ticketId: '001' });
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);

  test('a commit changing .claude/ fails the pass on V13, opens branch-touches-agent-config and launches no review while it is open', async () => {
    await run(['gate', 'add', 'checks', '--', 'true']);
    const drivePass = await drivePassPlaying([
      { kind: 'print', line: fakeStartedLine('fake-session') },
      {
        kind:    'shell',
        command: commitInTicketWorktree('mkdir -p .claude && echo \'{}\' > .claude/settings.json', '.claude', 'Build the example')
      },
      { kind: 'print', line: builderReport() },
      { kind: 'await-line' },
    ]);
    const agentConfigDecisionIsOpen = (): boolean => (storedProgressOf(repositoryDirectory).decisions ?? [])
      .some((decision) => decision.kind === 'branch-touches-agent-config' && decision.ticketIds.includes('001'));
    // The worktree observation can open the decision a pass before the session's report ends the job.
    await passUntil(drivePass, () => agentConfigDecisionIsOpen() && buildJobEnding() !== undefined, 'the branch-touches-agent-config decision and the ending');
    expect(buildJobEnding()).toMatchObject({ outcome: 'failed', cause: 'branch-touches-agent-config' });
    await passUntil(drivePass, () => true, 'one more pass');
    expect(loggedEntries('job-launched').filter((entry) => entry.fields['kind'] !== 'build' && entry.fields['kind'] !== 'orchestrator')).toEqual([]);
    expect(agentConfigDecisionIsOpen()).toBe(true);
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);

  test('a session ending without a report ends failed with cause no-report', async () => {
    await run(['gate', 'add', 'checks', '--', 'true']);
    const drivePass = await drivePassPlaying([{ kind: 'print', line: fakeStartedLine('fake-session') }, { kind: 'exit', code: 0 }]);
    await passUntil(drivePass, () => buildJobEnding() !== undefined, 'the build job ending');
    expect(buildJobEnding()).toMatchObject({ outcome: 'failed', cause: 'no-report' });
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);

  test('at the call budget the wind-down message is sent, and past the grace calls the job stops and out-of-calls opens', async () => {
    await run(['gate', 'add', 'checks', '--', 'true']);
    const turnLine = (index: number): FakeAgentStep => ({ kind: 'print', line: fakeAssistantTurnLine(`message-${index}`) });
    const turns = (from: number, count: number): FakeAgentStep[] => Array.from({ length: count }, (_unused, i) => turnLine(from + i));
    const budget = DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET;
    const drivePass = await drivePassPlaying([
      { kind: 'print', line: fakeStartedLine('fake-session') },
      { kind: 'await-line' },
      ...turns(0, budget),
      { kind: 'await-line' },
      ...turns(budget, WIND_DOWN_GRACE_CALLS),
      { kind: 'await-line' },
    ]);
    await passUntil(drivePass, () => openIncidentKinds().includes('out-of-calls'), 'the out-of-calls incident');
    const events = readFileSync(hostFilesOf(jobFolderOf(firstBuildJobId()), 1).eventLogPath, 'utf8');
    expect(events).toContain('Example wind-down message');
    await passUntil(drivePass, () => buildJobEnding() !== undefined, 'the stopped job ending');
    expect(buildJobEnding()).toMatchObject({ outcome: 'stopped', cause: 'out-of-calls' });
  }, BUILD_TEST_TIMEOUT_MILLISECONDS);
});
