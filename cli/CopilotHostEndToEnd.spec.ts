/**
 * One live Copilot CLI run of the whole chain: `init --host copilot-cli` in a scratch repository, one cheap ticket, one
 * `copilot workflow run agent-progress-dispatch`. What matters is the crediting: the builder's and the reviewer's rows hold exactly the input
 * tokens the session's `agentMetrics` give the agents whose prompts name them, and a reconcile of the same session afterwards adds nothing.
 * It spends real model tokens and takes minutes, so it runs only with `copilot` on the path and `AGENT_PROGRESS_LIVE_COPILOT_RUN` set. The
 * agents run with `COPILOT_ALLOW_ALL`: without it every shell call is denied (`docs/development.md`, the Copilot spike notes, item 8).
 */
import { realpathSync }       from 'node:fs';
import { homedir }            from 'node:os';
import { delimiter, dirname } from 'node:path';

import { afterEach, expect } from 'bun:test';

import { readCopilotSession, sessionEventsPathOf, sessionEventsTextAt } from '../src/lib/copilot-cli/CopilotSessionEvents.ts';
import {
  createScratchDirectory,
  createScratchGitRepository,
  currentBranchOf,
  gitOutputIn,
  removeScratchDirectory,
  SCRATCH_COMMIT_IDENTITY_ARGUMENTS
} from '../src/testing/ScratchWorkspace.ts';
import { testWhenCopilotLiveRunIsPresent }                 from '../src/testing/ToolGuard.ts';
import { runAgentProgress, writeAgentProgressCommandInto } from './testing/CliProcess.ts';

const LIVE_RUN_TIMEOUT_MILLISECONDS = 30 * 60 * 1000;

const SYSTEM_COMMAND_DIRECTORIES = ['/usr/bin', '/bin'];

const RESUME_SESSION_PATTERN = /--resume=([0-9a-f-]+)/;

const BUILDER_MARKER_PATTERN = /^agent-progress ticket: 0*1$/m;

const REVIEWER_MARKER_PATTERN = /^agent-progress review: 0*1$/m;

const TICKET_BODY = '## Wanted\nCreate hello.txt holding the word hello.\n\n## Acceptance\nA1. hello.txt exists and holds hello.\n';

interface StatusRow {
  readonly ticket?:   string | null;
  readonly reviewOf?: string;
  readonly tokens:    number | null;
}

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function directoryOfCommand(commandName: string): string {
  const commandPath = Bun.which(commandName);
  if (commandPath === null) throw new Error(`${commandName} is not on the PATH.`);
  return dirname(commandPath);
}

/** Built rather than inherited: the shim comes first, so the extension's `agent-progress` is this checkout's. */
function liveRunEnvironment(commandDirectory: string): Record<string, string> {
  const searchPath = [commandDirectory, directoryOfCommand('copilot'), dirname(process.execPath), directoryOfCommand('git'), ...SYSTEM_COMMAND_DIRECTORIES];
  return {
    PATH:                                  searchPath.join(delimiter),
    HOME:                                  homedir(),
    COPILOT_ALLOW_ALL:                     'true',
    GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS: 'true',
  };
}

async function requireAgentProgress(commandLineArguments: readonly string[], repositoryDirectory: string, environment: Record<string, string>): Promise<string> {
  const result = await runAgentProgress(commandLineArguments, { currentDirectory: repositoryDirectory, environment });
  if (result.exitCode !== 0) throw new Error(`agent-progress ${commandLineArguments.join(' ')} exited ${result.exitCode}: ${result.standardError}`);
  return result.standardOutput;
}

async function rowsOf(repositoryDirectory: string, environment: Record<string, string>): Promise<StatusRow[]> {
  const status = JSON.parse(await requireAgentProgress(['status', '--full', '--json'], repositoryDirectory, environment)) as { tasks: StatusRow[] };
  return status.tasks;
}

async function runDispatcherWorkflow(repositoryDirectory: string, environment: Record<string, string>): Promise<string> {
  const workflowArguments = JSON.stringify({ mainCheckout: repositoryDirectory, mainLine: currentBranchOf(repositoryDirectory), checkCommand: 'test -f hello.txt' });
  const spawned = Bun.spawn(['copilot', 'workflow', 'run', 'agent-progress-dispatch', '--args', workflowArguments], {
    cwd:    repositoryDirectory,
    env:    environment,
    stdin:  'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [standardOutput, standardError, exitCode] = await Promise.all([
    new Response(spawned.stdout).text(),
    new Response(spawned.stderr).text(),
    spawned.exited,
  ]);
  const sessionIdentifier = RESUME_SESSION_PATTERN.exec(`${standardOutput}\n${standardError}`)?.[1];
  if (exitCode !== 0 || sessionIdentifier === undefined) throw new Error(`copilot workflow run exited ${exitCode}:\n${standardOutput}\n${standardError}`);
  return sessionIdentifier;
}

function inputTokensOfAgentsMatching(sessionIdentifier: string, markerPattern: RegExp): number {
  const eventsPath = sessionEventsPathOf(homedir(), sessionIdentifier);
  const eventsText = eventsPath === undefined ? undefined : sessionEventsTextAt(eventsPath);
  if (eventsText === undefined) throw new Error(`The events of Copilot session ${sessionIdentifier} cannot be read.`);
  const reading = readCopilotSession(eventsText);
  if (reading.verdict !== 'shut-down') throw new Error(`Copilot session ${sessionIdentifier} reads as ${reading.verdict}.`);
  const matchingAgents = reading.agents.filter((agent) => markerPattern.test(agent.prompt));
  expect(matchingAgents.length).toBeGreaterThan(0);
  return matchingAgents.reduce((sum, agent) => sum + agent.usage.inputTokens, 0);
}

testWhenCopilotLiveRunIsPresent('a live dispatcher run credits each row exactly its agents\' agentMetrics input, and a reconcile adds nothing', async () => {
  const repositoryDirectory = realpathSync(createScratchGitRepository('copilot-host-end-to-end'));
  const commandDirectory    = createScratchDirectory('agent-progress-command');
  scratchDirectories.push(repositoryDirectory, commandDirectory);
  writeAgentProgressCommandInto(commandDirectory);
  const environment = liveRunEnvironment(commandDirectory);

  await requireAgentProgress(['init', '--host', 'copilot-cli'], repositoryDirectory, environment);
  gitOutputIn(repositoryDirectory, ['add', '-A']);
  gitOutputIn(repositoryDirectory, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'commit', '-q', '-m', 'Adopt agent-progress']);
  const ticketAddArguments = ['ticket', 'add', 'Add hello.txt', '--type', 'ticket', '--model', 'haiku', '--effort', 'low', '--body', TICKET_BODY];
  await requireAgentProgress(ticketAddArguments, repositoryDirectory, environment);
  await requireAgentProgress(['dispatcher', 'running'], repositoryDirectory, environment);

  const sessionIdentifier = await runDispatcherWorkflow(repositoryDirectory, environment);

  const rows       = await rowsOf(repositoryDirectory, environment);
  const builderRow = rows.find((row) => row.ticket === '001');
  const reviewRow  = rows.find((row) => row.reviewOf === '001');
  expect(builderRow?.tokens).toBe(inputTokensOfAgentsMatching(sessionIdentifier, BUILDER_MARKER_PATTERN));
  expect(reviewRow?.tokens).toBe(inputTokensOfAgentsMatching(sessionIdentifier, REVIEWER_MARKER_PATTERN));

  const reconcile = await runAgentProgress(['hook', 'copilot-agent-settled', '--session', sessionIdentifier], {
    currentDirectory: repositoryDirectory,
    environment,
    standardInput:    JSON.stringify({ repositoryRoot: repositoryDirectory }),
  });
  expect(reconcile.exitCode).toBe(0);
  expect(await rowsOf(repositoryDirectory, environment)).toEqual(rows);
}, LIVE_RUN_TIMEOUT_MILLISECONDS);
