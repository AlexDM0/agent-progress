/**
 * A tracker written before log.jsonl existed, read and written by today's CLI. The cases that matter: a read writes nothing, not even a
 * log.jsonl; the first write moves the embedded log into log.jsonl as notes and stores progress.json as version 2 with the migrated
 * words and review-bar fields; a log.jsonl that begins with the embedded log is a migration cut short and is rewritten; any other
 * log.jsonl beside a version 1 file is refused, and neither file is touched.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import {
  afterEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import { TimeUtil }                                                           from '../src/lib/utils/TimeUtil';
import type { WordedLogEntry }                                                from '../src/shared/@types/WordedLogEntry';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../src/testing/ScratchWorkspace';
import { runCommandLine }                                                     from './Main';
import { createCapturedCommandContext }                                       from './testing/CapturedCommandContext';

/**
 * Written by main at 5c6b0ad. To retake them, unpack that commit with `git archive 5c6b0ad | tar -x -C <folder>`, then in a scratch git
 * repository run `bun run <folder>/agent-progress.ts` with, in order:
 *   init --project "Example Agency" --no-claude-md --no-hooks --no-workflow --no-agent-definition
 *   ticket add "Rewrite the example importer" --at 2026-09-18T09:00:00+02:00
 *   task add "Draft the example page" --start --at 2026-09-18T09:30:00+02:00
 *   task add "Review 1 #001 — Rewrite the example importer" --at 2026-09-18T10:00:00+02:00
 *   log "Example session started" --at 2026-09-18T10:15:00+02:00
 *   log "Halfway through the example page" --at 2026-09-18T10:30:00+02:00
 * and copy `.agent-progress/progress.json` and the ticket file. Only `trackerId` and `startedAt` differ from one retake to the next.
 */
const VERSION_ONE_PROGRESS_FILE = `{
  "version": 1,
  "trackerId": "b6088998-3231-4bbc-9dee-a9cd13b24a7d",
  "project": "Example Agency",
  "startedAt": "2026-09-26T14:11:57+02:00",
  "view": {
    "kind": "auto"
  },
  "nextTaskId": 4,
  "concurrencyLimit": 2,
  "tasks": [
    {
      "id": 1,
      "name": "#001 Rewrite the example importer",
      "status": "pending",
      "start": null,
      "end": null,
      "owner": "",
      "note": "",
      "ticket": "001",
      "tokens": null,
      "history": [
        {
          "status": "pending",
          "at": "2026-09-18T09:00:00+02:00"
        }
      ]
    },
    {
      "id": 2,
      "name": "Draft the example page",
      "status": "running",
      "start": "2026-09-18T09:30:00+02:00",
      "end": null,
      "owner": "",
      "note": "",
      "ticket": null,
      "tokens": null,
      "history": [
        {
          "status": "pending",
          "at": "2026-09-18T09:30:00+02:00"
        },
        {
          "status": "running",
          "at": "2026-09-18T09:30:00+02:00"
        }
      ]
    },
    {
      "id": 3,
      "name": "Review 1 #001 — Rewrite the example importer",
      "status": "pending",
      "start": null,
      "end": null,
      "owner": "",
      "note": "",
      "ticket": null,
      "tokens": null,
      "history": [
        {
          "status": "pending",
          "at": "2026-09-18T10:00:00+02:00"
        }
      ]
    }
  ],
  "log": [
    {
      "at": "2026-09-18T09:00:00+02:00",
      "text": "Ticket #001 filed: Rewrite the example importer"
    },
    {
      "at": "2026-09-18T10:15:00+02:00",
      "text": "Example session started"
    },
    {
      "at": "2026-09-18T10:30:00+02:00",
      "text": "Halfway through the example page"
    }
  ]
}
`;

const TICKET_FILE_NAME = '001-rewrite-the-example-importer.md';

/** Taken with `VERSION_ONE_PROGRESS_FILE`, from the same run. */
const TICKET_FILE_WITH_A_RETIRED_WORD = `---
id: "001"
title: "Rewrite the example importer"
type: "change"
status: "open"
filed: "2026-09-18T09:00:00+02:00"
updated: "2026-09-18T09:00:00+02:00"
started: null
finished: null
delivered: null
abandonedAt: null
task: 1
---
# 001 — Rewrite the example importer

## Report

What was observed, in the words of whoever reported it.

## Wanted

What should happen instead, concretely enough to tell whether it did.

## Acceptance

How this ticket is checked before it moves to done.

## Handoff

Filled in by the agent that implements this ticket, as the last thing it does, in under 15 lines.

- The files it touched.
- Contracts it discovered that this ticket did not state.
- What is verified, and how — naming the screenshot paths.
- What is not.
- The next concrete step, named so the follow-up agent starts working instead of re-orienting.
`;

const EMBEDDED_LOG: readonly WordedLogEntry[] = [
  { at: '2026-09-18T09:00:00+02:00', text: 'Ticket #001 filed: Rewrite the example importer' },
  { at: '2026-09-18T10:15:00+02:00', text: 'Example session started' },
  { at: '2026-09-18T10:30:00+02:00', text: 'Halfway through the example page' },
];

const EMBEDDED_LOG_AS_NOTE_LINES = [
  '{"at":"2026-09-18T09:00:00+02:00","kind":"note","fields":{"text":"Ticket #001 filed: Rewrite the example importer"}}\n',
  '{"at":"2026-09-18T10:15:00+02:00","kind":"note","fields":{"text":"Example session started"}}\n',
  '{"at":"2026-09-18T10:30:00+02:00","kind":"note","fields":{"text":"Halfway through the example page"}}\n',
].join('');

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const NEW_NOTE_TEXT = 'Example note after the upgrade';

const NEW_NOTE_LINE = `${JSON.stringify({ at: TimeUtil.formatLocalIso(FROZEN_NOW), kind: 'note', fields: { text: NEW_NOTE_TEXT } })}\n`;

interface TrackerFiles {
  repositoryDirectory: string;
  progressFilePath:    string;
  logFilePath:         string;
  ticketFilePath:      string;
}

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

/** The real path, because the refusal names the files through the repository root git reports, which resolves the temporary folder's link. */
function trackerWrittenBeforeLogJsonl(): TrackerFiles {
  const repositoryDirectory = realpathSync(createScratchGitRepository('stored-format-migration'));
  scratchDirectories.push(repositoryDirectory);
  const trackerDirectory = join(repositoryDirectory, '.agent-progress');
  mkdirSync(join(trackerDirectory, 'tickets'), { recursive: true });

  const files = {
    repositoryDirectory,
    progressFilePath: join(trackerDirectory, 'progress.json'),
    logFilePath:      join(trackerDirectory, 'log.jsonl'),
    ticketFilePath:   join(trackerDirectory, 'tickets', TICKET_FILE_NAME),
  };
  writeFileSync(files.progressFilePath, VERSION_ONE_PROGRESS_FILE);
  writeFileSync(files.ticketFilePath, TICKET_FILE_WITH_A_RETIRED_WORD);
  return files;
}

async function run(repositoryDirectory: string, commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

describe.skipIf(!gitIsAvailable())('a tracker written before log.jsonl', () => {
  test('status --json prints its log, the current words and version 1, and leaves every file as it was without creating log.jsonl', async () => {
    const files = trackerWrittenBeforeLogJsonl();

    const context  = await run(files.repositoryDirectory, ['status', '--json']);
    const document = JSON.parse(context.outputText()) as {
      version: number;
      tasks:   { id: number; status: string }[];
      tickets: { id: string; status: string }[];
      log:     WordedLogEntry[];
    };

    expect(document.version).toBe(1);
    expect(document.log).toEqual([...EMBEDDED_LOG].reverse());
    expect(document.tasks.map((task) => [task.id, task.status])).toEqual([[1, 'pending'], [2, 'in-progress'], [3, 'pending']]);
    expect(document.tickets.map((ticket) => [ticket.id, ticket.status])).toEqual([['001', 'pending']]);
    expect(readFileSync(files.progressFilePath, 'utf8')).toBe(VERSION_ONE_PROGRESS_FILE);
    expect(readFileSync(files.ticketFilePath, 'utf8')).toBe(TICKET_FILE_WITH_A_RETIRED_WORD);
    expect(existsSync(files.logFilePath), 'a read never writes, so the log stays where it is until a command writes').toBe(false);
  });

  test('the first write moves the log to log.jsonl as notes and stores version 2 with the review bar linked, leaving the ticket alone', async () => {
    const files = trackerWrittenBeforeLogJsonl();

    await run(files.repositoryDirectory, ['log', NEW_NOTE_TEXT]);

    expect(readFileSync(files.logFilePath, 'utf8')).toBe(`${EMBEDDED_LOG_AS_NOTE_LINES}${NEW_NOTE_LINE}`);
    const stored = JSON.parse(readFileSync(files.progressFilePath, 'utf8')) as Record<string, unknown> & {
      tasks: { id: number; status: string; history: { status: string }[]; reviewOf?: string; reviewBarRound?: number }[];
    };
    expect(Object.keys(stored)).toEqual(['version', 'trackerId', 'project', 'startedAt', 'view', 'nextTaskId', 'concurrencyLimit', 'tasks']);
    expect(stored['version']).toBe(2);
    expect(stored.tasks[1]?.status).toBe('in-progress');
    expect(stored.tasks[1]?.history.map((phase) => phase.status)).toEqual(['pending', 'in-progress']);
    expect(stored.tasks[2]?.reviewOf).toBe('001');
    expect(stored.tasks[2]?.reviewBarRound).toBe(1);
    expect(readFileSync(files.ticketFilePath, 'utf8'), 'the Board did not change the ticket, so it is not written').toBe(TICKET_FILE_WITH_A_RETIRED_WORD);
  });

  // A crash between the two writes leaves a log.jsonl holding the notes and the command's lines beside the version 1 file it came from.
  test('a log.jsonl that begins with the embedded log is a migration cut short, and the next write replaces what follows the notes', async () => {
    const files = trackerWrittenBeforeLogJsonl();
    const strayLine = '{"at":"2026-09-18T11:00:00+02:00","kind":"note","fields":{"text":"A line whose progress write never happened"}}\n';
    writeFileSync(files.logFilePath, `${EMBEDDED_LOG_AS_NOTE_LINES}${strayLine}`);

    await run(files.repositoryDirectory, ['log', NEW_NOTE_TEXT]);

    expect(readFileSync(files.logFilePath, 'utf8')).toBe(`${EMBEDDED_LOG_AS_NOTE_LINES}${NEW_NOTE_LINE}`);
    expect(JSON.parse(readFileSync(files.progressFilePath, 'utf8'))).not.toHaveProperty('log');
  });

  test('a log.jsonl that does not begin with the embedded log is refused at exit 2, naming both files, and neither file changes', async () => {
    const files          = trackerWrittenBeforeLogJsonl();
    const unrelatedLog   = '{"at":"2026-09-18T08:00:00+02:00","kind":"note","fields":{"text":"A log from another tracker"}}\n';
    writeFileSync(files.logFilePath, unrelatedLog);

    const context  = createCapturedCommandContext({ currentDirectory: files.repositoryDirectory, now: () => FROZEN_NOW });
    const exitCode = await runCommandLine(['log', NEW_NOTE_TEXT], context);

    expect(exitCode).toBe(2);
    expect(context.errorText()).toContain('The log cannot be read:');
    expect(context.errorText()).toContain(`${files.logFilePath} sits beside a version 1 ${files.progressFilePath} and does not continue its log`);
    expect(readFileSync(files.logFilePath, 'utf8')).toBe(unrelatedLog);
    expect(readFileSync(files.progressFilePath, 'utf8')).toBe(VERSION_ONE_PROGRESS_FILE);
    expect(readFileSync(files.ticketFilePath, 'utf8')).toBe(TICKET_FILE_WITH_A_RETIRED_WORD);
  });
});
