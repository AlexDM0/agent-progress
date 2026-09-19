/**
 * The Gantt rows `agent-progress task` files and moves: a lifecycle stamps the row once and never again, and `--at` backfills.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                       from 'bun:test';
import type { ProgressFile }                                                  from '../../lib/constants/Types';
import { createCapturedCommandContext }                                       from '../../lib/tooling/dev/CapturedCommandContext';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine }                                                     from '../Main';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

let repositoryDirectory = '';

function contextHere(): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
}

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = contextHere();
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

function storedProgress(): ProgressFile {
  return JSON.parse(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')) as ProgressFile;
}

function storedTicketText(fileName: string): string {
  return readFileSync(join(repositoryDirectory, '.agent-progress', 'tickets', fileName), 'utf8');
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('task-command');
  await run(['init', '--project', 'Example Agency']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('the lifecycle of a row', () => {
  test('add, start, finish, review and deliver each move the row and say so', async () => {
    const added = await run(['task', 'add', 'Review pass', '--owner', 'Alex Example', '--note', 'the whole surface']);
    expect(added.outputText()).toContain('Task #1 added: Review pass');
    expect(storedProgress().tasks[0]).toMatchObject({
      id: 1, name: 'Review pass', owner: 'Alex Example', status: 'pending' 
    });

    await run(['task', 'start', '1']);
    expect(storedProgress().tasks[0]?.status).toBe('running');
    expect(storedProgress().tasks[0]?.start).not.toBeNull();

    await run(['task', 'finish', '1']);
    expect(storedProgress().tasks[0]?.status).toBe('finished');
    expect(storedProgress().tasks[0]?.end).not.toBeNull();

    await run(['task', 'review', '1']);
    expect(storedProgress().tasks[0]?.status).toBe('reviewed');

    const delivered = await run(['task', 'deliver', '1']);
    expect(storedProgress().tasks[0]?.status).toBe('delivered');
    expect(delivered.outputText()).toContain('Task #1 delivered: Review pass');
  });

  test('a second finish leaves the recorded end exactly where it was', async () => {
    await run(['task', 'add', 'Review pass', '--start', '--at', '-30m']);
    await run(['task', 'finish', '1', '--at', '-10m']);
    const endAfterTheFirstFinish = storedProgress().tasks[0]?.end;

    await run(['task', 'finish', '1']);

    expect(storedProgress().tasks[0]?.end).toBe(endAfterTheFirstFinish ?? null);
  });

  test('--start files the row already running, with its start at --at', async () => {
    await run(['task', 'add', 'Review pass', '--start', '--at', '-2h']);

    const [task] = storedProgress().tasks;
    expect(task?.status).toBe('running');
    expect(Date.parse(task?.start ?? '')).toBe(FROZEN_NOW.getTime() - 2 * 60 * 60 * 1000);
  });

  test('--json prints the row itself, which is the form an orchestrator reads', async () => {
    const context = await run(['task', 'add', 'Review pass', '--owner', 'Alex Example', '--json']);

    const printed = JSON.parse(context.outputText()) as { id: number; name: string; owner: string };
    expect(printed).toMatchObject({ id: 1, name: 'Review pass', owner: 'Alex Example' });
  });

  test('update changes the fields it is given and leaves the row\'s clock alone', async () => {
    await run(['task', 'add', 'Review pass', '--start']);
    const startBefore = storedProgress().tasks[0]?.start;

    await run(['task', 'update', '1', '--name', 'Review pass, second round', '--status', 'finished', '--owner', 'Alex Example']);

    const [task] = storedProgress().tasks;
    expect(task?.name).toBe('Review pass, second round');
    expect(task?.status).toBe('finished');
    expect(task?.owner).toBe('Alex Example');
    expect(task?.start).toBe(startBefore ?? null);
    expect(task?.end).toBeNull();
  });
});

describe.skipIf(!gitIsAvailable())('refusals a caller can act on', () => {
  test('a task id that does not exist is refused with exit 1 rather than silently doing nothing', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['task', 'start', '42'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('There is no task #42');
  });

  test('a subcommand that is not one prints the usage and exits 1', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['task', 'begin', '1'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('is not an agent-progress task subcommand');
    expect(context.errorText()).toContain('Usage: agent-progress task add');
  });

  test('an --at nobody can read is refused instead of being backfilled to now', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['task', 'add', 'Review pass', '--at', '5m'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('is not a time');
    expect(storedProgress().tasks).toEqual([]);
  });
});

describe.skipIf(!gitIsAvailable())('linking a row to a ticket', () => {
  test('--ticket links both sides when the ticket has no row of its own', async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);
    await run(['task', 'remove', '1']);

    await run(['task', 'add', 'Role editor rewrite', '--ticket', '001']);

    const [task] = storedProgress().tasks;
    expect(task?.ticket).toBe('001');
    expect(storedTicketText('001-double-click-a-role-to-edit-it.md')).toContain(`task: ${task?.id ?? 0}`);
  });

  test('--ticket is refused when the ticket already has a row, and --force moves the link', async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);

    const refused = contextHere();
    expect(await runCommandLine(['task', 'add', 'A second row', '--ticket', '001'], refused)).toBe(1);
    expect(refused.errorText()).toContain('already has task #1');
    expect(storedProgress().tasks).toHaveLength(1);

    await run(['task', 'add', 'A second row', '--ticket', '001', '--force']);

    const progress = storedProgress();
    expect(progress.tasks).toHaveLength(2);
    expect(progress.tasks[0]?.ticket).toBeNull();
    expect(progress.tasks[1]?.ticket).toBe('001');
    expect(storedTicketText('001-double-click-a-role-to-edit-it.md')).toContain('task: 2');
  });

  test('remove clears the linked ticket\'s task, so the ticket never names a row that is gone', async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);

    await run(['task', 'remove', '1']);

    expect(storedProgress().tasks).toEqual([]);
    expect(storedTicketText('001-double-click-a-role-to-edit-it.md')).toContain('task: null');
  });
});

describe.skipIf(!gitIsAvailable())('pausing and resuming', () => {
  test('pause keeps the start and clears nothing else; start resumes the same bar', async () => {
    await run(['task', 'add', 'Waiting on the user', '--start']);
    const startedAt = storedProgress().tasks[0]?.start;

    await run(['task', 'pause', '1']);
    const paused = storedProgress().tasks[0];
    expect(paused?.status).toBe('paused');
    // The whole point: a pause does not close the bar, so resuming does not draw a second one.
    expect(paused?.start).toBe(startedAt);
    expect(paused?.end).toBeNull();

    await run(['task', 'start', '1']);
    const resumed = storedProgress().tasks[0];
    expect(resumed?.status).toBe('running');
    expect(resumed?.start).toBe(startedAt);
    expect(resumed?.end).toBeNull();
  });
});

describe.skipIf(!gitIsAvailable())('token counts', () => {
  test('every spelling the parser accepts reaches the row as a whole number', async () => {
    await run(['task', 'add', 'Rewrite the importer']);

    await run(['task', 'finish', '1', '--tokens', '12k']);
    expect(storedProgress().tasks[0]?.tokens).toBe(12_000);

    await run(['task', 'update', '1', '--tokens', '1.2m']);
    expect(storedProgress().tasks[0]?.tokens).toBe(1_200_000);
  });

  test('a row nobody reported on carries null, which is not zero', async () => {
    await run(['task', 'add', 'Rewrite the importer']);
    expect(storedProgress().tasks[0]?.tokens).toBeNull();

    await run(['task', 'update', '1', '--tokens', '0']);
    expect(storedProgress().tasks[0]?.tokens).toBe(0);
  });

  test('a count that will not parse is refused with exit 1 rather than dropped', async () => {
    await run(['task', 'add', 'Rewrite the importer']);

    for (const written of ['12,000', '-5', 'lots', '12.5']) {
      const context  = contextHere();
      const exitCode = await runCommandLine(['task', 'finish', '1', '--tokens', written], context);
      expect(exitCode, written).toBe(1);
      expect(context.errorText(), written).toContain('is not a token count');
    }
    expect(storedProgress().tasks[0]?.tokens).toBeNull();
  });
});

describe.skipIf(!gitIsAvailable())('a row a ticket owns', () => {
  beforeEach(async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);
  });

  test('is refused by the task verbs, naming the ticket verb that moves both', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['task', 'finish', '1'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('belongs to ticket #001');
    expect(context.errorText()).toContain('agent-progress ticket review 001');
    expect(storedProgress().tasks[0]?.status).toBe('pending');
  });

  test('is refused by task update --status too, and --force moves only the row', async () => {
    const refused  = contextHere();
    expect(await runCommandLine(['task', 'update', '1', '--status', 'finished'], refused)).toBe(1);

    await run(['task', 'update', '1', '--status', 'finished', '--force']);
    expect(storedProgress().tasks[0]?.status).toBe('finished');
    expect(storedTicketText('001-double-click-a-role-to-edit-it.md')).toContain('status: "open"');
  });

  test('may still be paused and resumed, because no ticket status can say either', async () => {
    await run(['task', 'pause', '1']);
    expect(storedProgress().tasks[0]?.status).toBe('paused');

    await run(['task', 'start', '1']);
    expect(storedProgress().tasks[0]?.status).toBe('running');
  });
});

describe.skipIf(!gitIsAvailable())('the refusals that stop a row being filed wrong', () => {
  test('a name that is nothing but whitespace is refused, like an absent one', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['task', 'add', '   '], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('needs a name');
  });

  test('task update with no field to change is refused rather than reported as done', async () => {
    await run(['task', 'add', 'Rewrite the importer']);

    const context  = contextHere();
    const exitCode = await runCommandLine(['task', 'update', '1'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('at least one of --name');
  });
});
