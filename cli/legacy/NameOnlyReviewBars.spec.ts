/**
 * Review rows filed without `--review-of`, by their `Review <N> #<id>` name alone: `task add` and `task update --name` store the link the
 * name gives, a release closes such a row among a bundle's bars, and the SubagentStop hook credits the later round. A row stored name-only
 * by a tracker `update` has not yet rewritten is still linked when read, so a release closes it and stores its link and the hook credits
 * it. It covers the older
 * habit `cli/legacy/`'s filing mapper answers and the older input `src/adapters/legacy/` links, and is deleted with them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join }                        from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                       from 'bun:test';
import type { Task }            from '../../src/lib/tracker-model/@types/Task.ts';
import type { TrackerProgress } from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import { TimeUtil }             from '../../src/lib/utils/TimeUtil.ts';
import { LIMITS }               from '../../src/shared/constants/Limits.ts';
import {
  addWorktree,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
}                                       from '../../src/testing/ScratchWorkspace.ts';
import { runCommandLine }               from '../Main.ts';
import { createCapturedCommandContext } from '../testing/CapturedCommandContext.ts';

interface CommandOutcome {
  exitCode: number;
  output:   string;
  error:    string;
}

const COMMIT_IDENTITY = ['-c', 'user.name=Alex Example', '-c', 'user.email=alex.example@example.com', '-c', 'commit.gpgsign=false'];

const FROZEN_NOW = new Date('2026-09-23T10:00:00Z');

const REVIEWED_TICKET_NUMBER = 7;

const TRANSCRIPT_FILE_NAME = 'agent-example.jsonl';

let repositoryDirectory = '';

function gitIn(directory: string, gitArguments: readonly string[]): string {
  const finished = Bun.spawnSync(['git', ...COMMIT_IDENTITY, ...gitArguments], { cwd: directory, stdout: 'pipe', stderr: 'pipe' });
  if (finished.exitCode !== 0) throw new Error(`git ${gitArguments.join(' ')} failed in ${directory}: ${finished.stderr.toString()}`);
  return finished.stdout.toString().trim();
}

function commitFile(directory: string, fileName: string, content: string): string {
  writeFileSync(join(directory, fileName), content);
  gitIn(directory, ['add', fileName]);
  gitIn(directory, ['commit', '-q', '-m', `Add ${fileName}`]);
  return gitIn(directory, ['rev-parse', 'HEAD']);
}

async function agentProgress(commandLineArguments: readonly string[], standardInputText = ''): Promise<CommandOutcome> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW, standardInputText });
  const exitCode = await runCommandLine(commandLineArguments, context);
  return { exitCode, output: context.outputText(), error: context.errorText() };
}

async function agentProgressOrFail(commandLineArguments: readonly string[]): Promise<string> {
  const { exitCode, output, error } = await agentProgress(commandLineArguments);
  if (exitCode !== 0) throw new Error(`agent-progress ${commandLineArguments.join(' ')} exited ${exitCode}: ${error}`);
  return output;
}

function storedProgress(): TrackerProgress {
  return JSON.parse(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')) as TrackerProgress;
}

function storedRow(rowIdentifier: number): Task | undefined {
  return storedProgress().tasks.find((task) => task.id === rowIdentifier);
}

/** Stores the row as an agent-progress older than filing-time linking left it: known only by its name. */
function storeWithoutItsLink(rowIdentifier: number): void {
  const progressFilePath = join(repositoryDirectory, '.agent-progress', 'progress.json');
  const progress         = storedProgress();
  const tasks            = progress.tasks.map((task) => {
    if (task.id !== rowIdentifier) return task;
    const { reviewOf: droppedReviewOf, reviewBarRound: droppedReviewBarRound, ...unlinkedTask } = task;
    return unlinkedTask;
  });
  writeFileSync(progressFilePath, `${JSON.stringify({ ...progress, tasks }, null, LIMITS.JSON_INDENT_SPACES)}\n`);
}

beforeEach(async () => {
  if (!gitIsAvailable()) return;
  repositoryDirectory = createScratchGitRepository('name-only-review-bars');
  gitIn(repositoryDirectory, ['checkout', '-q', '-B', 'main']);
  await agentProgressOrFail(['init', '--project', 'Example Agency', '--no-claude-md', '--no-hooks']);
  gitIn(repositoryDirectory, ['add', '--all']);
  gitIn(repositoryDirectory, ['commit', '-q', '-m', 'Ignore the tracker']);
});

afterEach(() => {
  removeScratchDirectory(`${repositoryDirectory}-worktrees`);
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('a release', () => {
  const releaseStamp = TimeUtil.formatLocalIso(FROZEN_NOW);

  /** A review bar as the orchestrate skill adds one, started an hour before the release; linked by `--review-of` unless the name alone is to link it. */
  async function inProgressReviewRow(identifier: string, linkArguments: readonly string[] = ['--review-of', identifier]): Promise<number> {
    const addArguments = ['task', 'add', `Review 1 #${identifier} — the work`, ...linkArguments, '--owner', 'opus', '--start', '--at', '-1h', '--json'];
    return (JSON.parse(await agentProgressOrFail(addArguments)) as Task).id;
  }

  /** A ticket in review whose work is one commit on a fresh linked worktree off the current main. */
  async function reviewedTicketOnAWorktree(title: string, worktreeName: string): Promise<{ identifier: string; worktree: string; branch: string }> {
    const added      = JSON.parse(await agentProgressOrFail(['ticket', 'add', title, '--json'])) as { id: string };
    const identifier = added.id;
    await agentProgressOrFail(['ticket', 'start', identifier]);
    await agentProgressOrFail(['ticket', 'finish', identifier]);
    const worktree = addWorktree(repositoryDirectory, worktreeName);
    commitFile(worktree, `${worktreeName}.ts`, `export const ${worktreeName.replaceAll('-', '')} = true;\n`);
    return { identifier, worktree, branch: `worktree/${worktreeName}` };
  }

  // An earlier round's bar is already on the record; a row filed by its name alone is linked at filing, so it closes too.
  test('a bundle closes the running review row of each ticket, one filed without --review-of among them, and leaves an earlier delivered round', async () => {
    const {
      identifier,
      worktree,
      branch,
    } = await reviewedTicketOnAWorktree('Show the role history', 'role-history');
    const bundled = JSON.parse(await agentProgressOrFail(['ticket', 'add', 'Sort the role history', '--json'])) as { id: string };
    await agentProgressOrFail(['ticket', 'start', bundled.id]);
    const earlierRoundId = await inProgressReviewRow(identifier);
    await agentProgressOrFail(['task', 'finish', String(earlierRoundId), '--at', '-30m']);
    await agentProgressOrFail(['task', 'deliver', String(earlierRoundId), '--at', '-30m']);
    const earlierRoundBefore = storedRow(earlierRoundId);
    const firstReviewId      = await inProgressReviewRow(identifier);
    const bundledReviewId    = await inProgressReviewRow(bundled.id);
    const nameOnlyReviewId   = await inProgressReviewRow(identifier, []);

    const outcome = await agentProgress(['release', identifier, bundled.id, '--branch', branch, '--worktree', worktree, '--json']);

    expect(outcome.exitCode, outcome.error).toBe(0);
    expect(JSON.parse(outcome.output)).toMatchObject({ closedReviewRows: [firstReviewId, bundledReviewId, nameOnlyReviewId] });
    for (const closedId of [firstReviewId, bundledReviewId]) expect(storedRow(closedId)).toMatchObject({ status: 'delivered', end: releaseStamp });
    expect(storedRow(nameOnlyReviewId)).toMatchObject({
      status:         'delivered',
      end:            releaseStamp,
      reviewOf:       identifier,
      reviewBarRound: 1,
    });
    expect(storedRow(earlierRoundId)).toEqual(earlierRoundBefore);
  });

  // A tracker `update` has not yet rewritten may hold a row stored with no link; the read links it by its name, so the release closes it.
  test('closes a free-standing review row stored by its name alone, and stores its link', async () => {
    const {
      identifier,
      worktree,
      branch,
    } = await reviewedTicketOnAWorktree('Show the role history', 'role-history');
    const nameOnlyReviewId = await inProgressReviewRow(identifier);
    storeWithoutItsLink(nameOnlyReviewId);
    expect(storedRow(nameOnlyReviewId)).not.toHaveProperty('reviewOf');

    const outcome = await agentProgress(['release', identifier, '--branch', branch, '--worktree', worktree, '--json']);

    expect(outcome.exitCode, outcome.error).toBe(0);
    expect(JSON.parse(outcome.output)).toMatchObject({ closedReviewRows: [nameOnlyReviewId] });
    expect(storedRow(nameOnlyReviewId)).toMatchObject({
      status:         'delivered',
      end:            releaseStamp,
      reviewOf:       identifier,
      reviewBarRound: 1,
    });
  });
});

describe.skipIf(!gitIsAvailable())('the SubagentStop hook for a reviewer', () => {
  /** The fixture's two calls: 10 + 90,000 and 20 + 140,000. */
  const FIXTURE_INPUT_TOKENS = 230_030;

  function assistantLine(messageIdentifier: string, inputTokens: number, cacheReadTokens: number, outputTokens: number): string {
    return JSON.stringify({
      type:    'assistant',
      message: {
        id:    messageIdentifier,
        usage: {
          input_tokens:            inputTokens,
          cache_read_input_tokens: cacheReadTokens,
          output_tokens:           outputTokens,
        },
      },
    });
  }

  function userLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
  }

  function writeTranscript(lines: readonly string[]): string {
    const path = join(repositoryDirectory, TRANSCRIPT_FILE_NAME);
    writeFileSync(path, `${lines.join('\n')}\n`);
    return path;
  }

  function hookInput(transcriptPath: string): string {
    return JSON.stringify({
      agent_id:              'agent_42',
      agent_type:            'general-purpose',
      agent_transcript_path: transcriptPath,
      cwd:                   repositoryDirectory,
    });
  }

  async function reviewRowFiled(commandArguments: readonly string[]): Promise<number> {
    const rowIdentifier = (JSON.parse(await agentProgressOrFail(['task', 'add', ...commandArguments, '--json'])) as Task).id;
    return rowIdentifier;
  }

  beforeEach(async () => {
    for (let i = 1; i <= REVIEWED_TICKET_NUMBER; i++) await agentProgressOrFail(['ticket', 'add', `Example work ${i}`]);
  });

  // A second round files a second row; the reviewer that stops is the one whose row was filed last, even one filed by its name alone.
  test('with two review rows for the ticket, the later one filed without --review-of gets it and the earlier is left as it was', async () => {
    const firstRound     = await reviewRowFiled(['Review 1 #007 — Example work 7', '--review-of', '7']);
    const transcriptPath = writeTranscript([
      userLine('agent-progress review: #007'),
      assistantLine('msg_one', 10, 90_000, 400),
      assistantLine('msg_one', 10, 90_000, 1200),
      assistantLine('msg_two', 20, 140_000, 800),
    ]);
    const secondRound = await reviewRowFiled(['Review 2 #7 — Example work 7']);

    expect((await agentProgress(['hook', 'subagent-stop'], hookInput(transcriptPath))).exitCode).toBe(0);

    expect(storedRow(secondRound)?.tokens).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedRow(firstRound)?.tokens).toBeNull();
  });

  // A tracker `update` has not yet rewritten may hold the later round with no link; the read links it by its name, so the hook credits it.
  test('with the later round stored by its name alone, that row gets it and the earlier is left as it was', async () => {
    const firstRound     = await reviewRowFiled(['Review 1 #007 — Example work 7', '--review-of', '7']);
    const transcriptPath = writeTranscript([
      userLine('agent-progress review: #007'),
      assistantLine('msg_one', 10, 90_000, 400),
      assistantLine('msg_one', 10, 90_000, 1200),
      assistantLine('msg_two', 20, 140_000, 800),
    ]);
    const secondRound = await reviewRowFiled(['Review 2 #7 — Example work 7']);
    storeWithoutItsLink(secondRound);
    expect(storedRow(secondRound)).not.toHaveProperty('reviewOf');

    expect((await agentProgress(['hook', 'subagent-stop'], hookInput(transcriptPath))).exitCode).toBe(0);

    expect(storedRow(secondRound)?.tokens).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedRow(firstRound)?.tokens).toBeNull();
  });
});

describe.skipIf(!gitIsAvailable())('task add of a review-shaped name without --review-of', () => {
  test('stores the ticket and round the name gives at filing, and prints them in its JSON', async () => {
    for (let i = 1; i <= REVIEWED_TICKET_NUMBER; i++) await agentProgressOrFail(['ticket', 'add', `Example work ${i}`]);

    const printed = JSON.parse(await agentProgressOrFail(['task', 'add', 'Review 2 #7 — Example work 7', '--json'])) as Task;

    expect(printed).toMatchObject({ reviewOf: '007', reviewBarRound: 2 });
    expect(storedRow(printed.id)).toMatchObject({ reviewOf: '007', reviewBarRound: 2 });
  });
});

describe.skipIf(!gitIsAvailable())('task update renaming a free-standing row to a review-shaped name', () => {
  test('stores the ticket and round the name gives in the same write, and prints them in its JSON', async () => {
    const plain = JSON.parse(await agentProgressOrFail(['task', 'add', 'Plain', '--json'])) as Task;

    const printed = JSON.parse(await agentProgressOrFail(['task', 'update', String(plain.id), '--name', 'Review 3 #001 — Renamed', '--json'])) as Task;

    expect(printed).toMatchObject({ reviewOf: '001', reviewBarRound: 3 });
    expect(storedRow(plain.id)).toMatchObject({ name: 'Review 3 #001 — Renamed', reviewOf: '001', reviewBarRound: 3 });
  });
});
