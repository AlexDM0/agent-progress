/**
 * The cutover smoke the owner runs before unholding the release ticket, never a spec: this checkout's binary under the side-by-side names
 * drives two planted tickets to delivered with real `claude` sessions in a scratch repository, and the log under the main checkout's
 * `.claude/.evidence/cutover-smoke/` holds one pass line per item. `docs/development/cutover-smoke.md` says how to run and read it.
 */
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import {
  environmentCopy,
  FAKE_AGENT_VARIABLE,
  JOB_ID_VARIABLE,
  RELAY_DIRECTORY_VARIABLE,
  ROOT_OVERRIDE_VARIABLE
} from '../../src/shared/Environment.ts';
import { PRODUCT_NAMES }                                                                   from '../../src/shared/constants/ProductNames.ts';
import { createCanonicalScratchDirectory, gitOutputIn, SCRATCH_COMMIT_IDENTITY_ARGUMENTS } from '../../src/testing/ScratchWorkspace.ts';
import {
  CutoverSmokeUtil,
  type RegroupingObservation,
  type SmokeItemVerdict,
  type SmokeLogRecord,
  type SmokeStreamedEvent
} from './CutoverSmokeUtil.ts';

interface CutoverSmokeOptions {
  withRealClaude: boolean;
  mainCheckout:   string;
  model:          string | null;
  effort:         string | null;
  timeoutMinutes: number;
}

interface ProgramResult {
  exitCode:       number;
  standardOutput: string;
  standardError:  string;
}

interface LiveJob {
  id:           string;
  kind:         string;
  role:         string | null;
  state:        string;
  ticketIds:    string[];
  hostInstance: number;
}

const CHECKOUT_ROOT = join(import.meta.dir, '..', '..');
const ENTRY_POINT = join(CHECKOUT_ROOT, 'agent-progress.ts');
const DEFAULT_TIMEOUT_MINUTES = 120;
const POLL_INTERVAL_MILLISECONDS = 10_000;
const SETTLE_AFTER_REGROUPING_MILLISECONDS = 30_000;
const SETTLE_AFTER_RESTART_MILLISECONDS = 20_000;
const LOGGED_OUTPUT_CHARACTERS = 1_500;
const MILLISECONDS_PER_MINUTE = 60_000;

const AGENT_QUESTION_TICKET = {
  title: 'Choose the palette colour',
  body:  [
    '## Report',
    'The example palette in `palette.txt` names no colour yet.',
    '',
    '## Acceptance',
    'A1. The first line of `palette.txt` reads `colour: <the colour User chose>`; nothing else in the file changes.',
    '',
    '## Brief',
    'Work belongs in: `palette.txt`.',
    'Before changing anything, ask User which colour to use with the AskUserQuestion tool: one question, header `colour`, options `Red`',
    'and `Blue`. Wait for the answer, then set the first line of `palette.txt` to `colour: <answer>` and commit.',
    '',
  ].join('\n'),
};

const MALFORMED_TICKET_TICKET = {
  title: 'Name the palette shade',
  body:  [
    '## Report',
    'The example palette in `palette.txt` should name a shade.',
    '',
    '## Acceptance',
    'A1. The first line of `palette.txt` reads `colour: <shade>`, the shade the board settles; nothing else in the file changes.',
    '',
    '## Brief',
    'Work belongs in: `palette.txt`.',
    'This ticket does not say which shade to use. Before changing anything, report that gap with the AskUserQuestion tool: one question',
    'with header `ticket`, asking which shade the first line of `palette.txt` should name, options `Teal` and `Amber`. Use the answer you',
    'get, set the first line of `palette.txt` to `colour: <answer>` and commit.',
    '',
  ].join('\n'),
};

const GATES: readonly (readonly string[])[] = [
  ['readme', '--', 'test', '-s', 'README.md'],
  ['palette', '--', 'grep', '-q', '^colour: ', 'palette.txt'],
  ['palette-file', '--', 'test', '-f', 'palette.txt'],
];

function optionsOf(commandLineArguments: readonly string[]): CutoverSmokeOptions {
  const valueAfter = (flag: string): string | null => {
    const index = commandLineArguments.indexOf(flag);
    return index < 0 ? null : commandLineArguments[index + 1] ?? null;
  };
  const timeoutText = valueAfter('--timeout-minutes');
  return {
    withRealClaude: commandLineArguments.includes('--with-real-claude'),
    mainCheckout:   valueAfter('--main-checkout') ?? dirname(gitOutputIn(CHECKOUT_ROOT, ['rev-parse', '--path-format=absolute', '--git-common-dir'])),
    model:          valueAfter('--model'),
    effort:         valueAfter('--effort'),
    timeoutMinutes: timeoutText === null ? DEFAULT_TIMEOUT_MINUTES : Number(timeoutText),
  };
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function createSmoke(options: CutoverSmokeOptions, logPath: string) {
  const scratchRoot = createCanonicalScratchDirectory('cutover-smoke');
  const repository = join(scratchRoot, 'repository');
  const shimFolder = join(scratchRoot, 'bin');
  const trackerDirectory = join(repository, PRODUCT_NAMES.DATA_FOLDER);
  const deadline = Date.now() + options.timeoutMinutes * MILLISECONDS_PER_MINUTE;
  const events: SmokeStreamedEvent[] = [];
  let streamOpenedAt = '';
  let streamController: AbortController | null = null;

  const childEnvironment = (() => {
    const environment = environmentCopy();
    for (const variable of [FAKE_AGENT_VARIABLE, JOB_ID_VARIABLE, RELAY_DIRECTORY_VARIABLE, ROOT_OVERRIDE_VARIABLE]) delete environment[variable];
    return { ...environment, PATH: [shimFolder, environment['PATH'] ?? ''].join(delimiter) };
  })();

  const log = (line: string): void => {
    const stamped = `${new Date().toISOString()} ${line}\n`;
    appendFileSync(logPath, stamped);
    process.stdout.write(stamped);
  };

  const program = async (commandLineArguments: readonly string[]): Promise<ProgramResult> => {
    const spawned = Bun.spawn([process.execPath, ENTRY_POINT, ...commandLineArguments], {
      cwd: repository, env: childEnvironment, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    });
    const [standardOutput, standardError, exitCode] = await Promise.all([new Response(spawned.stdout).text(), new Response(spawned.stderr).text(), spawned.exited]);
    const output = `${standardOutput}${standardError}`.trim().slice(0, LOGGED_OUTPUT_CHARACTERS);
    log(`$ ${PRODUCT_NAMES.PROGRAM} ${commandLineArguments.join(' ')} → exit ${exitCode}${output === '' ? '' : `\n${output}`}`);
    return { exitCode, standardOutput, standardError };
  };

  const programJson = async <Document>(commandLineArguments: readonly string[]): Promise<Document> => {
    const result = await program([...commandLineArguments, '--json']);
    if (result.exitCode !== 0) throw new Error(`${commandLineArguments.join(' ')} exited ${result.exitCode}`);
    return JSON.parse(result.standardOutput) as Document;
  };

  const quietJson = async <Document>(commandLineArguments: readonly string[]): Promise<Document | null> => {
    const spawned = Bun.spawn([process.execPath, ENTRY_POINT, ...commandLineArguments, '--json'], {
      cwd: repository, env: childEnvironment, stdout: 'pipe', stderr: 'ignore'
    });
    const [standardOutput, exitCode] = await Promise.all([new Response(spawned.stdout).text(), spawned.exited]);
    return exitCode === 0 ? JSON.parse(standardOutput) as Document : null;
  };

  const git = (gitArguments: readonly string[]): string => gitOutputIn(repository, gitArguments);

  const openStream = (url: string): void => {
    streamController?.abort();
    const controller = new AbortController();
    streamController = controller;
    if (streamOpenedAt === '') streamOpenedAt = new Date().toISOString();
    log(`SSE client connected to ${url}api/events`);
    void (async () => {
      const response = await fetch(new URL('api/events', url), { signal: controller.signal });
      const reader = response.body?.getReader();
      if (reader === undefined) return;
      const decoder = new TextDecoder();
      let pending = '';
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
        pending += decoder.decode(chunk.value, { stream: true });
        const blocks = pending.split('\n\n');
        pending = blocks.pop() ?? '';
        for (const block of blocks) {
          const kind = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (kind !== undefined && data !== undefined) events.push({ kind, receivedAt: new Date().toISOString(), data: JSON.parse(data) as Record<string, unknown> });
        }
      }
    })().catch(() => undefined);
  };

  const liveUrl = async (): Promise<string | null> => (await quietJson<{ url?: string | null }>(['run', 'status']))?.url ?? null;

  const liveJobs = async (): Promise<LiveJob[]> => (await quietJson<{ jobs: LiveJob[] }>(['jobs']))?.jobs ?? [];

  const storedLogRecords = (): SmokeLogRecord[] => readFileSync(join(trackerDirectory, 'log.jsonl'), 'utf8').split('\n')
    .filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as SmokeLogRecord);

  const newestLease = (): { processId: number } | null => {
    const runnerFolder = join(trackerDirectory, 'runner');
    const leaseFiles = readdirSync(runnerFolder).filter((fileName) => /^lease-\d+\.json$/.test(fileName))
      .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]));
    const newest = leaseFiles.at(-1);
    return newest === undefined ? null : JSON.parse(readFileSync(join(runnerFolder, newest), 'utf8')) as { processId: number };
  };

  const hostProcessIdOf = (jobId: string, instance: number): number | null => {
    const hostRecordPath = join(trackerDirectory, 'jobs', jobId, `host-${instance}.json`);
    if (!existsSync(hostRecordPath)) return null;
    const record = JSON.parse(readFileSync(hostRecordPath, 'utf8')) as { host?: { processId: number } | null };
    return record.host?.processId ?? null;
  };

  const buildLaunchesOf = (ticketId: string): number => storedLogRecords().filter((record) => record.kind === 'job-launched'
    && record.fields['kind'] === 'build' && Array.isArray(record.fields['ticketIds']) && record.fields['ticketIds'].includes(ticketId)).length;

  const sleep = async (milliseconds: number): Promise<void> => {
    await Bun.sleep(milliseconds);
  };

  return {
    scratchRoot,
    repository,
    log,

    async prepare(): Promise<void> {
      mkdirSync(repository, { recursive: true });
      mkdirSync(shimFolder, { recursive: true });
      const shimPath = join(shimFolder, PRODUCT_NAMES.PROGRAM);
      writeFileSync(shimPath, `#!/bin/sh\nexec '${process.execPath}' '${ENTRY_POINT}' "$@"\n`);
      chmodSync(shimPath, 0o755);
      git(['init', '-q', '-b', 'main']);
      git(['config', 'user.name', 'Alex Example']);
      git(['config', 'user.email', 'alex.example@example.com']);
      // A sandboxed session cannot reach gpg, so a signing default in the owner's git configuration would stop every commit.
      git(['config', 'commit.gpgsign', 'false']);
      writeFileSync(join(repository, 'README.md'), '# Cutover smoke\n\nAn example repository for the cutover smoke of Example Agency.\n');
      writeFileSync(join(repository, 'palette.txt'), 'colour: none\nnotes: the example palette of the cutover smoke\n');
      git(['add', '-A']);
      git([...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'commit', '-q', '-m', 'Start the example palette']);
      log(`Scratch repository ${repository}; ${PRODUCT_NAMES.PROGRAM} is ${ENTRY_POINT} through ${shimPath}`);
      if ((await program(['init', '--project', 'Cutover Smoke', '--no-hooks'])).exitCode !== 0) throw new Error('init failed');
      git(['add', '-A']);
      git([...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'commit', '-q', '-m', 'Track the board\'s ignores']);
      for (const gate of GATES) if ((await program(['gate', 'add', ...gate])).exitCode !== 0) throw new Error(`gate add ${gate[0]} failed`);
      await program(['concurrency', '2']);
      await program(['run', 'pause']);
    },

    async startOverseer(): Promise<void> {
      const started = await programJson<{ url: string }>(['run', '--detach', '--port', '0']);
      openStream(started.url);
    },

    async fileAndReadyTickets(): Promise<string[]> {
      const agentArguments = [...(options.model === null ? [] : ['--model', options.model]), ...(options.effort === null ? [] : ['--effort', options.effort])];
      const ticketIds: string[] = [];
      for (const ticket of [AGENT_QUESTION_TICKET, MALFORMED_TICKET_TICKET]) {
        const filed = await programJson<{ id: string }>(['ticket', 'add', ticket.title, '--type', 'ticket', '--size', 'XS', ...agentArguments, '--body', ticket.body]);
        ticketIds.push(filed.id);
      }
      await programJson(['ticket', 'ready', ...ticketIds]);
      await programJson(['run', 'resume']);
      return ticketIds;
    },

    /** Kills the Overseer once a build runs, starts a new one, then hands it over; answers what the agent's host did meanwhile. */
    async regroupAroundRunningBuild(job: LiveJob): Promise<RegroupingObservation> {
      const ticketId = job.ticketIds[0] ?? '';
      let hostProcessId = hostProcessIdOf(job.id, job.hostInstance);
      while (hostProcessId === null && Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MILLISECONDS / 10);
        hostProcessId = hostProcessIdOf(job.id, job.hostInstance);
      }
      const buildLaunchesBefore = buildLaunchesOf(ticketId);
      const lease = newestLease();
      if (lease === null || hostProcessId === null) throw new Error('no lease or host record to regroup around');
      log(`kill -9 of the Overseer (process ${lease.processId}) while job ${job.id} (#${ticketId}) runs on host instance ${job.hostInstance}, process ${hostProcessId}`);
      process.kill(lease.processId, 'SIGKILL');
      while (processIsAlive(lease.processId)) await sleep(POLL_INTERVAL_MILLISECONDS / 10);
      const regrouped = await programJson<{ url: string }>(['run', '--detach', '--port', '0']);
      openStream(regrouped.url);
      await sleep(SETTLE_AFTER_REGROUPING_MILLISECONDS);
      const afterRegrouping = (await liveJobs()).find((liveJob) => liveJob.id === job.id);
      const hostAliveAfterRegrouping = processIsAlive(hostProcessId);
      const restart = await program(['run', 'restart', '--json']);
      await sleep(SETTLE_AFTER_RESTART_MILLISECONDS);
      const restartedUrl = await liveUrl();
      if (restartedUrl !== null) openStream(restartedUrl);
      const afterRestart = (await liveJobs()).find((liveJob) => liveJob.id === job.id);
      return {
        jobId:                           job.id,
        hostInstanceBeforeKill:          job.hostInstance,
        hostInstanceAfterRegrouping:     afterRegrouping?.hostInstance ?? -1,
        hostInstanceAfterRestart:        afterRestart?.hostInstance ?? -1,
        hostProcessAliveAfterRegrouping: hostAliveAfterRegrouping,
        hostProcessAliveAfterRestart:    processIsAlive(hostProcessId),
        restartExitCode:                 restart.exitCode,
        buildJobsOnTheTicketAfterKill:   buildLaunchesOf(ticketId) - buildLaunchesBefore,
      };
    },

    /** Polls until every ticket is delivered or the deadline passes: regroups once around the first running build, answers User's decisions. */
    async driveToDelivery(ticketIds: readonly string[]): Promise<RegroupingObservation | null> {
      let regrouping: RegroupingObservation | null = null;
      let lastJobsText = '';
      let lastIncidentsText = '';
      while (Date.now() < deadline) {
        const statuses = await Promise.all(ticketIds.map(async (ticketId) => (await quietJson<{ status: string }>(['ticket', 'show', ticketId]))?.status ?? '?'));
        if (statuses.every((status) => status === 'delivered')) return regrouping;
        const jobs = await liveJobs();
        const jobLines = jobs.map((liveJob) => `${liveJob.id} ${liveJob.kind}/${liveJob.role ?? '-'} ${liveJob.state} host ${liveJob.hostInstance}`);
        const jobsText = `tickets ${ticketIds.map((ticketId, i) => `#${ticketId} ${statuses[i]}`).join(', ')}; jobs ${jobLines.join(', ')}`;
        if (jobsText !== lastJobsText) log(jobsText);
        lastJobsText = jobsText;
        const decisions = (await quietJson<{ decisions: { id: string; kind: string; questions: unknown[] }[] }>(['decisions']))?.decisions ?? [];
        for (const decision of decisions.filter((open) => open.kind === 'agent-question')) {
          await program(['decide', decision.id, ...decision.questions.map(() => 'a')]);
        }
        if (decisions.some((open) => open.kind === 'parked')) {
          log(`A ticket was parked (${decisions.filter((open) => open.kind === 'parked').map((open) => open.id).join(', ')}); the smoke stops here`);
          return regrouping;
        }
        const incidents = (await quietJson<{ incidents: { id: string; kind: string }[] }>(['incidents']))?.incidents ?? [];
        const incidentsText = incidents.map((incident) => `${incident.id} ${incident.kind}`).join(', ');
        if (incidentsText !== lastIncidentsText && incidentsText !== '') log(`open incidents, left to the Assistant: ${incidentsText}`);
        lastIncidentsText = incidentsText;
        const runningBuild = jobs.find((liveJob) => liveJob.kind === 'build' && liveJob.state === 'running');
        if (regrouping === null && runningBuild !== undefined) regrouping = await this.regroupAroundRunningBuild(runningBuild);
        await sleep(POLL_INTERVAL_MILLISECONDS);
      }
      log(`Timed out after ${options.timeoutMinutes} minutes`);
      return regrouping;
    },

    verdictsOf(ticketIds: readonly string[], regrouping: RegroupingObservation | null): SmokeItemVerdict[] {
      const records = storedLogRecords();
      const [agentQuestionTicketId = '', malformedTicketTicketId = ''] = ticketIds;
      return [
        CutoverSmokeUtil.deliveryVerdictOf(records, ticketIds),
        regrouping === null ? { item: 2, passed: false, detail: 'no build ran to regroup around' } : CutoverSmokeUtil.regroupingVerdictOf(regrouping),
        CutoverSmokeUtil.conflictVerdictOf(records),
        CutoverSmokeUtil.questionVerdictOf(records, { agentQuestionTicketId, malformedTicketTicketId }),
        CutoverSmokeUtil.eventVerdictOf(records, events, streamOpenedAt),
      ];
    },

    async stopEverything(): Promise<void> {
      streamController?.abort();
      await program(['job', 'stop', '--all']);
      await program(['run', 'stop', '--now']);
      const hostPattern = join(trackerDirectory, 'runner', 'host-');
      const leftoverHosts = Bun.spawnSync(['pgrep', '-f', hostPattern]).stdout.toString().trim().split('\n').filter((line) => line !== '');
      log(`${leftoverHosts.length} agent hosts were still running after the stop${leftoverHosts.length === 0 ? '' : '; killed'}`);
      if (leftoverHosts.length > 0) Bun.spawnSync(['pkill', '-f', hostPattern]);
    },

    keepBoardLog(evidenceBase: string): void {
      for (const fileName of ['log.jsonl', 'runner.log']) {
        const source = join(trackerDirectory, fileName);
        if (existsSync(source)) copyFileSync(source, `${evidenceBase}-${fileName}`);
      }
      writeFileSync(`${evidenceBase}-events.ndjson`, events.map((event) => JSON.stringify(event)).join('\n'));
    },
  };
}

export async function runCutoverSmoke(commandLineArguments: readonly string[]): Promise<number> {
  const options = optionsOf(commandLineArguments);
  const refusal = CutoverSmokeUtil.refusalOf(PRODUCT_NAMES, options.withRealClaude);
  if (refusal !== null) {
    process.stderr.write(`${refusal}\n`);
    return 1;
  }
  const evidenceFolder = CutoverSmokeUtil.evidenceFolderOf(options.mainCheckout);
  const evidenceBase = join(evidenceFolder, `cutover-smoke-${new Date().toISOString().replaceAll(':', '-')}`);
  if (Bun.spawnSync(['git', '-C', options.mainCheckout, 'check-ignore', '-q', `${evidenceBase}.log`]).exitCode !== 0) {
    process.stderr.write(`Refused: ${evidenceFolder} is not git-ignored in ${options.mainCheckout}.\n`);
    return 1;
  }
  mkdirSync(evidenceFolder, { recursive: true });
  const logPath = `${evidenceBase}.log`;
  const smoke = createSmoke(options, logPath);
  smoke.log(`Cutover smoke of ${CHECKOUT_ROOT} at ${gitOutputIn(CHECKOUT_ROOT, ['rev-parse', 'HEAD'])} as ${PRODUCT_NAMES.PROGRAM}; log ${logPath}`);
  smoke.log(`item 6: PASS — PROGRAM is ${PRODUCT_NAMES.PROGRAM}, monitor folder ~/${PRODUCT_NAMES.MONITOR_FOLDER}, scratch root ${smoke.scratchRoot}`);
  let verdicts: SmokeItemVerdict[] = [];
  let ticketIds: string[] = [];
  try {
    await smoke.prepare();
    await smoke.startOverseer();
    ticketIds = await smoke.fileAndReadyTickets();
    const regrouping = await smoke.driveToDelivery(ticketIds);
    verdicts = smoke.verdictsOf(ticketIds, regrouping);
  } catch (error) {
    smoke.log(`The smoke stopped: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    if (ticketIds.length > 0) verdicts = smoke.verdictsOf(ticketIds, null);
  } finally {
    await smoke.stopEverything();
    smoke.keepBoardLog(evidenceBase);
  }
  for (const verdict of verdicts) smoke.log(CutoverSmokeUtil.passLineOf(verdict));
  const passed = verdicts.length === 5 && verdicts.every((verdict) => verdict.passed);
  smoke.log(`${passed ? 'PASSED' : 'FAILED'}; scratch repository kept at ${smoke.repository}: remove it once read`);
  return passed ? 0 : 1;
}

if (import.meta.main) process.exitCode = await runCutoverSmoke(process.argv.slice(2));
