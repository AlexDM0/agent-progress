/**
 * The markdown tickets and the Gantt rows they drive: every transition moves the row and stamps the frontmatter, which is what `clear` re-seeds from.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test
}                                                                             from 'bun:test';
import { LOCK_RETRY_INTERVAL_MILLISECONDS }                                   from '../../lib/constants/Limits';
import type { ProgressFile }                                                  from '../../lib/constants/Types';
import * as AtomicFile                                                        from '../../lib/platform/AtomicFile';
import { withLock }                                                           from '../../lib/platform/Lock';
import { workspacePathsFor }                                                  from '../../lib/platform/Workspace';
import { createCapturedCommandContext }                                       from '../../lib/tooling/dev/CapturedCommandContext';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine }                                                     from '../Main';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const LOCK_HELD_WHILE_ADDS_QUEUE_MILLISECONDS = LOCK_RETRY_INTERVAL_MILLISECONDS * 4;

const FIRST_TICKET_FILE_NAME = '001-double-click-a-role-to-edit-it.md';

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

function storedTicketText(fileName = FIRST_TICKET_FILE_NAME): string {
  return readFileSync(join(repositoryDirectory, '.agent-progress', 'tickets', fileName), 'utf8');
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('ticket-command');
  await run(['init', '--project', 'Example Agency']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('filing a ticket', () => {
  test('writes the file, files a pending row and logs the line, and prints the path', async () => {
    const context = await run(['ticket', 'add', 'Double-click a role to edit it', '--type', 'change', '--group', 'role-editor']);

    const ticketText = storedTicketText();
    expect(ticketText).toContain('id: "001"');
    expect(ticketText).toContain('status: "open"');
    expect(ticketText).toContain('group: "role-editor"');
    expect(ticketText).toContain('# 001 — Double-click a role to edit it');
    expect(ticketText).toContain('## Acceptance');
    expect(ticketText).not.toContain('{{');

    const progress = storedProgress();
    expect(progress.tasks[0]).toMatchObject({ id: 1, status: 'pending', ticket: '001' });
    expect(progress.log.at(-1)?.text).toBe('Ticket #001 filed: Double-click a role to edit it');

    expect(context.outputText()).toContain('Ticket #001 filed: Double-click a role to edit it');
    expect(context.outputText()).toContain(FIRST_TICKET_FILE_NAME);
  });

  test('--body replaces the template and is stored byte for byte', async () => {
    await run(['ticket', 'add', 'Fix the axis', '--type', 'bug', '--body', '## Report\n\nThe axis is an hour out.\n']);

    const ticketText = storedTicketText('001-fix-the-axis.md');
    expect(ticketText).toContain('type: "bug"');
    expect(ticketText.endsWith('## Report\n\nThe axis is an hour out.\n')).toBe(true);
  });

  test('a type that is not one of the three is refused rather than filed as a change', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['ticket', 'add', 'Fix the axis', '--type', 'defect'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('is not a ticket type');
  });

  // Two adds queued behind one lock hold is how two agents filing at once meet; a heading with another ticket's number misleads its reader.
  test('two adds queued behind a held lock each carry their own id in their heading', async () => {
    let queuedAdds: Promise<number>[] = [];

    await withLock(workspacePathsFor(repositoryDirectory), async () => {
      queuedAdds = [
        runCommandLine(['ticket', 'add', 'Held A'], contextHere()),
        runCommandLine(['ticket', 'add', 'Held B'], contextHere()),
      ];
      await Bun.sleep(LOCK_HELD_WHILE_ADDS_QUEUE_MILLISECONDS);
    }, () => new Date());

    expect(await Promise.all(queuedAdds)).toEqual([0, 0]);
    const ticketFileNames = readdirSync(join(repositoryDirectory, '.agent-progress', 'tickets')).sort();
    expect(ticketFileNames).toHaveLength(2);
    for (const fileName of ticketFileNames) {
      const ticketId = fileName.slice(0, fileName.indexOf('-'));
      expect(storedTicketText(fileName)).toContain(`\n# ${ticketId} — Held `);
    }
  });

  // The progress file is never behind a ticket file, and a first write without `dependsOn` is a ticket a concurrent reader sees as ready.
  test('the new ticket file is written once, after the progress file, with its dependencies on that one write', async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);
    // The command writes through the resolved root, and the scratch directory's own path may pass through a symlink such as `/var`.
    const trackerDirectory = join(realpathSync(repositoryDirectory), '.agent-progress');
    const progressFilePath = join(trackerDirectory, 'progress.json');
    const ticketsDirectory = join(trackerDirectory, 'tickets');
    const atomicWrites     = spyOn(AtomicFile, 'writeFileAtomically');
    let recordedWrites: Array<[string, string]> = [];

    try {
      await run(['ticket', 'add', 'Show the role history', '--depends-on', '1']);
      recordedWrites = [...atomicWrites.mock.calls];
    } finally {
      atomicWrites.mockRestore();
    }

    const trackerWrites = recordedWrites
      .filter(([targetPath]) => targetPath === progressFilePath || targetPath.startsWith(ticketsDirectory))
      .map(([targetPath, contents]) => ({ targetPath, contents }));
    expect(trackerWrites.map((write) => write.targetPath)).toEqual([progressFilePath, join(ticketsDirectory, '002-show-the-role-history.md')]);
    expect(trackerWrites[1]?.contents).toContain('dependsOn: "001"');
  });
});

describe.skipIf(!gitIsAvailable())('moving a ticket', () => {
  beforeEach(async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);
  });

  test('every transition moves the row and stamps the frontmatter it belongs to', async () => {
    await run(['ticket', 'start', '1', '--branch', 'ticket/role-editor']);
    expect(storedProgress().tasks[0]?.status).toBe('running');
    expect(storedTicketText()).toContain('status: "in-progress"');
    expect(storedTicketText()).toContain('branch: "ticket/role-editor"');
    expect(storedTicketText()).not.toContain('started: null');

    await run(['ticket', 'review', '1']);
    expect(storedProgress().tasks[0]?.status).toBe('finished');
    expect(storedTicketText()).toContain('status: "in-review"');
    expect(storedTicketText()).not.toContain('finished: null');

    await run(['ticket', 'done', '1', '--commit', 'abc1234']);
    expect(storedProgress().tasks[0]?.status).toBe('reviewed');
    expect(storedTicketText()).toContain('commit: "abc1234"');

    await run(['ticket', 'deliver', '1']);
    expect(storedProgress().tasks[0]?.status).toBe('delivered');
    expect(storedTicketText()).toContain('status: "delivered"');
    expect(storedTicketText()).not.toContain('delivered: null');
  });

  // The row a ticket files starts in the queue, and how long it waited there is only measurable if the filing is a phase.
  test('the row a ticket files records its filing, and every later move adds one', async () => {
    expect(storedProgress().tasks[0]?.history?.map((phase) => phase.status)).toEqual(['pending']);

    await run(['ticket', 'start', '1']);
    await run(['ticket', 'review', '1']);
    await run(['ticket', 'rereview', '1']);
    await run(['ticket', 'done', '1']);

    expect(storedProgress().tasks[0]?.history?.map((phase) => phase.status)).toEqual(['pending', 'running', 'finished', 're-review', 'reviewed']);
  });

  // Reopening is something that happened to the row, and it is what restarts the review rounds the panel counts.
  test('reopen files a pending phase of its own after the phases that led to it', async () => {
    await run(['ticket', 'start', '1']);
    await run(['ticket', 'done', '1']);

    await run(['ticket', 'reopen', '1']);

    expect(storedProgress().tasks[0]?.history?.map((phase) => phase.status)).toEqual(['pending', 'running', 'reviewed', 'pending']);
  });

  test('reopen clears the stamps and returns the row to pending', async () => {
    await run(['ticket', 'start', '1']);
    await run(['ticket', 'done', '1']);

    await run(['ticket', 'reopen', '1']);

    expect(storedProgress().tasks[0]?.status).toBe('pending');
    const ticketText = storedTicketText();
    expect(ticketText).toContain('status: "open"');
    expect(ticketText).toContain('started: null');
    expect(ticketText).toContain('finished: null');
  });

  test('abandon needs a reason, and refuses without one rather than inventing a blank', async () => {
    const refused  = contextHere();
    const exitCode = await runCommandLine(['ticket', 'abandon', '1'], refused);

    expect(exitCode).toBe(1);
    expect(refused.errorText()).toContain('--reason');
    expect(storedTicketText()).toContain('status: "open"');

    await run(['ticket', 'abandon', '1', '--reason', 'superseded by ticket #007']);

    expect(storedProgress().tasks[0]?.status).toBe('abandoned');
    expect(storedTicketText()).toContain('reason: "superseded by ticket #007"');
    expect(storedProgress().log.at(-1)?.text).toBe('Ticket #001 abandoned: superseded by ticket #007');
  });

  test('`ticket status` reaches the same states as the verbs do', async () => {
    await run(['ticket', 'status', '1', 'in-review']);

    expect(storedTicketText()).toContain('status: "in-review"');
    expect(storedProgress().tasks[0]?.status).toBe('finished');
  });

  test('a status that is not one is refused, listing the ones that are', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['ticket', 'status', '1', 'finished'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('is not a ticket status');
    expect(context.errorText()).toContain('in-review');
  });

  test('a ticket that does not exist is refused with exit 1', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['ticket', 'start', '42'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('There is no readable ticket 42');
  });
});

describe.skipIf(!gitIsAvailable())('a second review pass', () => {
  beforeEach(async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);
    await run(['ticket', 'start', '1']);
    await run(['ticket', 'review', '1']);
  });

  test('rereview leaves the ticket in review, moves the row into the next round and logs which round that is', async () => {
    const context = await run(['ticket', 'rereview', '1']);

    expect(storedTicketText()).toContain('status: "in-review"');
    expect(storedProgress().tasks[0]?.status).toBe('re-review');
    expect(storedProgress().tasks[0]?.reviewRound).toBe(2);
    expect(storedProgress().log.at(-1)?.text).toBe('Ticket #001 in review, round 2');
    expect(context.outputText()).toContain('Ticket #001 in review, round 2');

    await run(['ticket', 'rereview', '1']);
    expect(storedProgress().tasks[0]?.reviewRound).toBe(3);
    expect(storedProgress().log.at(-1)?.text).toBe('Ticket #001 in review, round 3');
  });

  test('done still moves a ticket whose row is in a repeat review', async () => {
    await run(['ticket', 'rereview', '1']);

    await run(['ticket', 'done', '1']);

    expect(storedTicketText()).toContain('status: "done"');
    expect(storedProgress().tasks[0]?.status).toBe('reviewed');
    expect(storedProgress().tasks[0]?.reviewRound, 'the round stays on the row as history').toBe(2);
  });

  test('start and abandon still move a ticket whose row is in a repeat review', async () => {
    await run(['ticket', 'rereview', '1']);
    await run(['ticket', 'start', '1']);
    expect(storedTicketText()).toContain('status: "in-progress"');

    await run(['ticket', 'abandon', '1', '--reason', 'two passes were enough to see it was wrong']);
    expect(storedTicketText()).toContain('status: "abandoned"');
  });

  test('rereview is refused for a ticket that is not in review, and the reason says what it needs', async () => {
    await run(['ticket', 'add', 'Fix the axis', '--type', 'bug']);

    const context  = contextHere();
    const exitCode = await runCommandLine(['ticket', 'rereview', '2'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('Ticket #002 is open');
    expect(context.errorText()).toContain('needs a ticket that is in-review');
    expect(context.errorText()).not.toContain('ticket review 002');
    expect(storedProgress().tasks[1]?.status).toBe('pending');
  });

  test('a refused rereview names ticket review only where that verb would be accepted', async () => {
    await run(['ticket', 'add', 'Fix the axis', '--type', 'bug']);
    await run(['ticket', 'start', '2']);

    const context = contextHere();
    await runCommandLine(['ticket', 'rereview', '2'], context);

    expect(context.errorText()).toContain('agent-progress ticket review 002');
  });

  test('rereview takes no --tokens, so the figure on the row stays the builder\'s', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['ticket', 'rereview', '1', '--tokens', '48k'], context);

    expect(exitCode).not.toBe(0);
    expect(storedProgress().tasks[0]?.status).not.toBe('re-review');
  });
});

describe.skipIf(!gitIsAvailable())('reading tickets back', () => {
  beforeEach(async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);
    await run(['ticket', 'add', 'Fix the axis', '--type', 'bug']);
    await run(['ticket', 'start', '2']);
    await run(['ticket', 'done', '2']);
  });

  test('show prints the frontmatter summary, the file path and the body', async () => {
    const context = await run(['ticket', 'show', '1']);

    expect(context.outputText()).toContain('Ticket #001: Double-click a role to edit it');
    expect(context.outputText()).toContain('status:   open');
    expect(context.outputText()).toContain(FIRST_TICKET_FILE_NAME);
    expect(context.outputText()).toContain('## Acceptance');
  });

  test('show --json carries the path and the body alongside the frontmatter', async () => {
    const context = await run(['ticket', 'show', '1', '--json']);

    const printed = JSON.parse(context.outputText()) as { id: string; filePath: string; body: string };
    expect(printed.id).toBe('001');
    expect(printed.filePath).toContain(FIRST_TICKET_FILE_NAME);
    expect(printed.body).toContain('## Report');
  });

  test('list shows every ticket, and --status narrows it to one', async () => {
    const everything = await run(['ticket', 'list']);
    expect(everything.outputText()).toContain('#001');
    expect(everything.outputText()).toContain('#002');

    const narrowed = await run(['ticket', 'list', '--status', 'done']);
    expect(narrowed.outputText()).toContain('#002');
    expect(narrowed.outputText()).not.toContain('#001');
  });

  test('a malformed ticket file is reported on standard error and the rest still list', async () => {
    writeFileSync(join(repositoryDirectory, '.agent-progress', 'tickets', '003-broken.md'), 'no frontmatter at all\n');

    const context = await run(['ticket', 'list']);

    expect(context.errorText()).toContain('003-broken.md');
    expect(context.outputText()).toContain('#001');
    expect(context.outputText()).toContain('#002');
  });
});

describe.skipIf(!gitIsAvailable())('linking a ticket to a row', () => {
  test('link points the ticket at another row and clears the row it left', async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);
    await run(['task', 'add', 'Role editor rewrite']);

    await run(['ticket', 'link', '1', '2']);

    const progress = storedProgress();
    expect(progress.tasks[0]?.ticket).toBeNull();
    expect(progress.tasks[1]?.ticket).toBe('001');
    expect(storedTicketText()).toContain('task: 2');
  });

  test('link is refused when the row belongs to another ticket, unless --force', async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);
    await run(['ticket', 'add', 'Fix the axis', '--type', 'bug']);

    const refused = contextHere();
    expect(await runCommandLine(['ticket', 'link', '1', '2'], refused)).toBe(1);
    expect(refused.errorText()).toContain('already belongs to ticket #002');

    await run(['ticket', 'link', '1', '2', '--force']);

    expect(storedProgress().tasks[1]?.ticket).toBe('001');
    expect(storedTicketText('002-fix-the-axis.md')).toContain('task: null');
  });
});

describe.skipIf(!gitIsAvailable())('the transition matrix', () => {
  beforeEach(async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);
  });

  test('a verb refuses a ticket that is not in a status it moves from, naming the override', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['ticket', 'deliver', '1'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('Ticket #001 is open');
    expect(context.errorText()).toContain('moves a ticket that is done');
    expect(context.errorText()).toContain('agent-progress ticket status 001 delivered');
  });

  test('a refused move writes no log line and leaves the ticket where it was', async () => {
    const logBefore = storedProgress().log.length;

    expect(await runCommandLine(['ticket', 'deliver', '1'], contextHere())).toBe(1);

    expect(storedProgress().log).toHaveLength(logBefore);
    expect(storedTicketText()).toContain('status: "open"');
  });

  test('moving a ticket to the status it already has is refused, under both spellings', async () => {
    await run(['ticket', 'start', '1']);
    const logBefore = storedProgress().log.length;

    const byVerb = contextHere();
    expect(await runCommandLine(['ticket', 'start', '1'], byVerb)).toBe(1);
    expect(byVerb.errorText()).toContain('is already in-progress');

    const byStatus = contextHere();
    expect(await runCommandLine(['ticket', 'status', '1', 'in-progress'], byStatus)).toBe(1);
    expect(byStatus.errorText()).toContain('is already in-progress');

    expect(storedProgress().log).toHaveLength(logBefore);
  });

  test('ticket status makes the move the verbs refuse, and stamps the row it left unstarted', async () => {
    await run(['ticket', 'status', '1', 'done']);

    expect(storedTicketText()).toContain('status: "done"');
    const row = storedProgress().tasks[0];
    expect(row?.status).toBe('reviewed');
    expect(row?.start).not.toBeNull();
    expect(row?.end).toBe(row?.start ?? '');
  });

  test('the whole legal pipeline still runs end to end', async () => {
    await run(['ticket', 'start', '1']);
    await run(['ticket', 'review', '1']);
    await run(['ticket', 'done', '1']);
    await run(['ticket', 'deliver', '1']);
    expect(storedTicketText()).toContain('status: "delivered"');
  });

  test('abandon reaches anything but the two end states, and reopen anything but open', async () => {
    await run(['ticket', 'status', '1', 'delivered']);

    const refused = contextHere();
    expect(await runCommandLine(['ticket', 'abandon', '1', '--reason', 'superseded'], refused)).toBe(1);
    expect(refused.errorText()).toContain('moves a ticket that is open');

    await run(['ticket', 'reopen', '1']);
    await run(['ticket', 'abandon', '1', '--reason', 'superseded by #7']);
    expect(storedTicketText()).toContain('status: "abandoned"');
  });

  test('an inherited property of the subcommand table is not a subcommand', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['ticket', 'constructor', '1'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('is not an agent-progress ticket subcommand');
  });
});

describe.skipIf(!gitIsAvailable())('token counts on a ticket move', () => {
  test('--tokens lands on the row the ticket owns', async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);
    await run(['ticket', 'start', '1']);

    await run(['ticket', 'review', '1', '--tokens', '48k']);

    expect(storedProgress().tasks[0]?.tokens).toBe(48_000);
  });

  // A low ticket that was never started has no row, so the figure would otherwise vanish at exit 0.
  test('--tokens on a ticket with no row is refused with nothing written', async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it', '--priority', 'low']);
    const progressBefore = readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8');
    const ticketBefore   = storedTicketText();

    const context  = contextHere();
    const exitCode = await runCommandLine(['ticket', 'abandon', '1', '--reason', 'superseded', '--tokens', '12k'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('has no row');
    expect(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')).toBe(progressBefore);
    expect(storedTicketText()).toBe(ticketBefore);
  });
});

describe.skipIf(!gitIsAvailable())('where --body-file reads from', () => {
  test('`-` reads what the context pipes in, not the process\'s own standard input', async () => {
    const context = createCapturedCommandContext({
      currentDirectory:  repositoryDirectory,
      now:               () => FROZEN_NOW,
      standardInputText: '## Report\nPiped by Alex Example.\n',
    });
    expect(await runCommandLine(['ticket', 'add', 'Double-click a role to edit it', '--body-file', '-'], context)).toBe(0);

    expect(storedTicketText()).toContain('Piped by Alex Example.');
  });

  test('a relative path resolves against the command\'s directory, not the process\'s', async () => {
    mkdirSync(join(repositoryDirectory, 'notes'));
    writeFileSync(join(repositoryDirectory, 'notes', 'body.md'), '## Report\nWritten by Alex Example.\n');

    await run(['ticket', 'add', 'Double-click a role to edit it', '--body-file', 'notes/body.md']);

    expect(storedTicketText()).toContain('Written by Alex Example.');
  });
});

describe.skipIf(!gitIsAvailable())('what ticket add refuses and what it falls back to', () => {
  test('a title that is nothing but whitespace is refused', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['ticket', 'add', '  '], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('needs a title');
  });

  test('an empty --body falls back to the template rather than filing a ticket that says nothing', async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it', '--body', '   ']);

    expect(storedTicketText()).toContain('## Report');
  });

  test('ticket list --json carries no bodies, since a listing is about statuses', async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);

    const listed = JSON.parse((await run(['ticket', 'list', '--json'])).outputText()) as Array<Record<string, unknown>>;
    expect(listed[0]).not.toHaveProperty('body');
    expect(listed[0]?.['filePath']).toContain('001-double-click-a-role-to-edit-it.md');

    const shown = JSON.parse((await run(['ticket', 'show', '1', '--json'])).outputText()) as Record<string, unknown>;
    expect(shown['body']).toContain('## Report');
  });
});

describe.skipIf(!gitIsAvailable())('ticket dependencies', () => {
  beforeEach(async () => {
    await run(['ticket', 'add', 'Split the importer']);
    await run(['ticket', 'add', 'Validate the rows']);
  });

  async function refusalOf(commandLineArguments: readonly string[]): Promise<string> {
    const context  = contextHere();
    const exitCode = await runCommandLine(commandLineArguments, context);
    expect(exitCode).toBe(1);
    return context.errorText();
  }

  test('--depends-on files the ticket already waiting, and list and show say on what', async () => {
    await run(['ticket', 'add', 'Report the import', '--depends-on', '1,#2']);

    expect(storedTicketText('003-report-the-import.md')).toContain('dependsOn: "001, 002"');
    expect((await run(['ticket', 'list'])).outputText()).toContain('Report the import  (waiting on #001, #002)');
    expect((await run(['ticket', 'show', '3'])).outputText()).toContain('waits on: #001 (open), #002 (open)');
  });

  test('depends replaces the list and logs it, and with no ids clears it', async () => {
    await run(['ticket', 'depends', '2', '1']);
    expect(storedTicketText('002-validate-the-rows.md')).toContain('dependsOn: "001"');
    expect(storedProgress().log.at(-1)?.text).toBe('Ticket #002 waits on #001');

    await run(['ticket', 'depends', '2']);
    expect(storedTicketText('002-validate-the-rows.md')).not.toContain('dependsOn');
    expect(storedProgress().log.at(-1)?.text).toBe('Ticket #002 waits on no other ticket');
  });

  test('a finished dependency no longer holds the ticket back in the listing', async () => {
    await run(['ticket', 'depends', '2', '1']);
    await run(['ticket', 'start', '1']);
    await run(['ticket', 'done', '1']);

    expect((await run(['ticket', 'list'])).outputText()).not.toContain('waiting on');
  });

  // The order is advice: the move happens, and the agent is told what it skipped ahead of.
  test('starting a ticket that still waits moves it anyway and warns on standard error', async () => {
    await run(['ticket', 'depends', '2', '1']);
    const context = await run(['ticket', 'start', '2']);

    expect(storedTicketText('002-validate-the-rows.md')).toContain('status: "in-progress"');
    expect(context.errorText()).toContain('Ticket #002 is waiting on #001');
  });

  test('a dependency on a ticket that does not exist is refused', async () => {
    expect(await refusalOf(['ticket', 'depends', '2', '9'])).toContain('There is no ticket #009');
    expect(await refusalOf(['ticket', 'add', 'Report the import', '--depends-on', '9'])).toContain('There is no ticket #009');
  });

  test('a ticket waiting on itself, or on a ticket that waits on it, is refused and the file is unchanged', async () => {
    await run(['ticket', 'depends', '2', '1']);

    expect(await refusalOf(['ticket', 'depends', '1', '1'])).toContain('#001 → #001');
    expect(await refusalOf(['ticket', 'depends', '1', '2'])).toContain('#001 → #002 → #001');
    expect(storedTicketText('001-split-the-importer.md')).not.toContain('dependsOn');
  });

  test('something that is not a ticket id is refused before the tracker is touched', async () => {
    expect(await refusalOf(['ticket', 'depends', '2', 'importer'])).toContain('"importer" is not a ticket id');
  });
});
