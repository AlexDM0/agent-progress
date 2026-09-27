/**
 * What each command prints, byte for byte, when the tracker's progress.json or log.jsonl cannot be read, and what a Board refusal prints.
 * The words are pinned whole because they are the contract with main; the cases that matter are the refusal Main prints, the render's two
 * reasons, the `detail` of `release --json`, the hook's one sentence at exit 0, and `concurrency` and `dispatcher` reading progress.json
 * alone, so a broken log does not stop them.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join }                                      from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                                             from 'bun:test';
import { createScratchGitRepository, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                           from '../src/testing/ToolGuard.ts';
import { runCommandLine }                                     from './Main.ts';
import { createCapturedCommandContext }                       from './testing/CapturedCommandContext.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

/** Parses as JSON and fails validation on a field every tracker has, so the reason is fixed whatever else the file holds. */
const BROKEN_PROGRESS_REASON = 'project is not a string';

const BROKEN_LOG_TEXT = '{"at":"2026-09-18T20:05:00+02:00","kind":"note","fields":{"text":5}}\n';

let repositoryDirectory = '';
let progressFilePath    = '';
let logFilePath         = '';

interface CommandRun {
  exitCode:   number;
  outputText: string;
  errorText:  string;
}

async function runWith(commandLineArguments: readonly string[], standardInputText?: string): Promise<CommandRun> {
  const context = createCapturedCommandContext({
    currentDirectory: repositoryDirectory,
    now:              () => FROZEN_NOW,
    ...(standardInputText === undefined ? {} : { standardInputText }),
  });
  const exitCode = await runCommandLine(commandLineArguments, context);
  return { exitCode, outputText: context.outputText(), errorText: context.errorText() };
}

async function runSucceeding(commandLineArguments: readonly string[]): Promise<CommandRun> {
  const finished = await runWith(commandLineArguments);
  expect(finished.exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${finished.errorText}`).toBe(0);
  return finished;
}

function breakTheProgressFile(): void {
  const stored = JSON.parse(readFileSync(progressFilePath, 'utf8')) as Record<string, unknown>;
  writeFileSync(progressFilePath, `${JSON.stringify({ ...stored, project: 5 }, null, 2)}\n`);
}

function breakTheLogFile(): void {
  writeFileSync(logFilePath, BROKEN_LOG_TEXT);
}

function brokenLogReason(): string {
  return `${logFilePath}, line 1: fields.text is not a string`;
}

function transcriptHoldingOneApiCall(): string {
  const transcriptPath = join(repositoryDirectory, 'agent-example.jsonl');
  const assistantLine  = JSON.stringify({
    type:    'assistant',
    message: {
      id:    'msg_one',
      usage: {
        input_tokens:            10,
        cache_read_input_tokens: 90_000,
        output_tokens:           400,
      },
    },
  });
  writeFileSync(transcriptPath, `${assistantLine}\n`);
  return transcriptPath;
}

beforeEach(async () => {
  repositoryDirectory = realpathSync(createScratchGitRepository('unreadable-tracker-wording'));
  progressFilePath    = join(repositoryDirectory, '.agent-progress', 'progress.json');
  logFilePath         = join(repositoryDirectory, '.agent-progress', 'log.jsonl');
  await runSucceeding(['init', '--project', 'Example Agency']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('a progress file that cannot be read', () => {
  test('status, concurrency, dispatcher and log exit 2 naming the file and its reason, and print nothing on standard output', async () => {
    breakTheProgressFile();

    for (const commandLine of [['status'], ['concurrency'], ['dispatcher'], ['log', 'Example note']]) {
      const finished = await runWith(commandLine);

      expect(finished.exitCode, commandLine.join(' ')).toBe(2);
      expect(finished.errorText, commandLine.join(' ')).toBe(`${progressFilePath} cannot be read: ${BROKEN_PROGRESS_REASON}`);
      expect(finished.outputText, commandLine.join(' ')).toBe('');
    }
  });

  test('render exits 2 saying the dashboard could not be regenerated, with the file and its reason', async () => {
    breakTheProgressFile();

    const finished = await runWith(['render']);

    expect(finished.exitCode).toBe(2);
    expect(finished.errorText).toBe(`The dashboard could not be regenerated: ${progressFilePath} could not be read: ${BROKEN_PROGRESS_REASON}`);
  });

  test('release --json exits 2 with a tracker-failed document whose detail is the words printed on standard error', async () => {
    breakTheProgressFile();

    const finished = await runWith(['release', '1', '--branch', 'example-branch', '--json']);

    expect(finished.exitCode).toBe(2);
    expect(JSON.parse(finished.outputText)).toEqual({
      released: false,
      reason:   'tracker-failed',
      detail:   `${progressFilePath} cannot be read: ${BROKEN_PROGRESS_REASON}`,
      cleanup:  [],
    });
    expect(finished.errorText).toBe(`${progressFilePath} cannot be read: ${BROKEN_PROGRESS_REASON}`);
  });

  test('hook subagent-stop exits 0 and says in one sentence that the line could not be recorded, and why', async () => {
    const hookInput = JSON.stringify({ cwd: repositoryDirectory, agent_transcript_path: transcriptHoldingOneApiCall() });
    breakTheProgressFile();

    const finished = await runWith(['hook', 'subagent-stop'], hookInput);

    expect(finished.exitCode).toBe(0);
    expect(finished.errorText).toBe(
      `agent-progress hook subagent-stop: the line could not be recorded in ${repositoryDirectory}: ${progressFilePath} cannot be read: ${BROKEN_PROGRESS_REASON}`,
    );
  });
});

describeWhenGitIsPresent('a log.jsonl that cannot be read', () => {
  test('status and log exit 2 naming the log and its reason, and neither file is touched', async () => {
    breakTheLogFile();
    const progressTextBefore = readFileSync(progressFilePath, 'utf8');

    for (const commandLine of [['status'], ['log', 'Example note']]) {
      const finished = await runWith(commandLine);

      expect(finished.exitCode, commandLine.join(' ')).toBe(2);
      expect(finished.errorText, commandLine.join(' ')).toBe(`The log cannot be read: ${brokenLogReason()}`);
    }
    expect(readFileSync(progressFilePath, 'utf8')).toBe(progressTextBefore);
    expect(readFileSync(logFilePath, 'utf8')).toBe(BROKEN_LOG_TEXT);
  });

  test('concurrency and dispatcher with no argument read progress.json alone, so they exit 0 with their usual output', async () => {
    const concurrencyBefore = await runSucceeding(['concurrency']);
    const dispatcherBefore  = await runSucceeding(['dispatcher']);
    breakTheLogFile();

    expect(await runWith(['concurrency'])).toEqual(concurrencyBefore);
    expect(await runWith(['dispatcher'])).toEqual(dispatcherBefore);
  });

  test('render exits 2 saying the dashboard could not be regenerated because the log cannot be read', async () => {
    breakTheLogFile();

    const finished = await runWith(['render']);

    expect(finished.exitCode).toBe(2);
    expect(finished.errorText).toBe(`The dashboard could not be regenerated: the log cannot be read: ${brokenLogReason()}`);
  });
});

describeWhenGitIsPresent('a Board refusal', () => {
  test('holding a ticket that is already held exits 1 with the refusal in words and nothing else', async () => {
    await runSucceeding(['ticket', 'add', 'Example ticket']);
    await runSucceeding(['ticket', 'hold', '1', '--reason', 'Example reason']);

    const finished = await runWith(['ticket', 'hold', '1', '--reason', 'Example reason']);

    expect(finished.exitCode).toBe(1);
    expect(finished.errorText).toBe('Ticket #001 is already held. Nothing was written.');
  });
});
