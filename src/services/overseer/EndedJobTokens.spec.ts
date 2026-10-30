/**
 * A job's tokens reach its tickets' rows when it ends. What matters: they add to what the row held, a review job's land on the newest
 * review bar, a turn repeated across log lines counts once, a job still on the board is not credited, and a hold that sees the same ended
 * job again credits nothing twice, since the `agent-stopped` record keyed by the job id already holds its total.
 */
import { mkdirSync } from 'node:fs';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { AgentAdapter }                              from '../../lib/agent-launch/AgentAdapter.ts';
import type { AgentSessionEvent }                         from '../../lib/agent-launch/AgentSessionEvent.ts';
import type { Job }                                       from '../../lib/tracker-model/@types/Job.ts';
import { createEventLogWriter }                           from '../../lib/watcher/EventLog.ts';
import { watcherFilesOf }                                 from '../../lib/watcher/WatcherFiles.ts';
import { boardFixture, taskFixture, ticketFixture }       from '../../testing/BoardFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { EndedJobTokens }                                 from './EndedJobTokens.ts';
import { WatcherFleet }                                   from './WatcherFleet.ts';

const ENDED_AT = '2026-10-30T14:00:00+01:00';

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

const LINE_AS_EVENT_ADAPTER = { eventsOf: (line: string) => [JSON.parse(line) as AgentSessionEvent] } as unknown as AgentAdapter;

function assistantTurn(messageId: string, parentToolUseId: string | null, inputTokens: number, cacheReadInputTokens: number): AgentSessionEvent {
  return {
    kind:  'assistant-turn',
    messageId,
    parentToolUseId,
    model: 'example-model',
    usage: {
      inputTokens, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens
    },
    text: '',
  };
}

function jobOf(id: string, kind: string, ticketIds: string[]): Readonly<Job> {
  return {
    id, kind, ticketIds, watcherInstance: 1
  } as unknown as Readonly<Job>;
}

/** A scratch tracker whose job logged each event as one agent line of its first Watcher instance. */
function trackerWithLoggedEvents(jobId: string, events: readonly AgentSessionEvent[]): string {
  const trackerDirectory = createScratchDirectory('ended-job-tokens');
  scratchDirectories.push(trackerDirectory);
  const jobFolder = WatcherFleet.jobFolderOf(trackerDirectory, jobId);
  mkdirSync(jobFolder, { recursive: true });
  const writer = createEventLogWriter(watcherFilesOf(jobFolder, 1).eventLogPath, () => '2026-10-30T13:00:00Z');
  for (const event of events) writer.append('agent', JSON.stringify(event));
  writer.syncAndClose();
  return trackerDirectory;
}

const BUILD_EVENTS = [
  assistantTurn('message-1', null, 100, 900),
  assistantTurn('message-1', null, 100, 900),
  assistantTurn('message-2', 'call-1', 50, 0),
];

describe('EndedJobTokens', () => {
  test('a build job ending credits its input and cache tokens to its ticket\'s row, added to what the row held, and logs its usage', () => {
    const { board, progress } = boardFixture({
      tasks:   [taskFixture({ id: 7, ticket: '002', tokens: 500 })],
      tickets: [ticketFixture({ id: '002', task: 7 })],
    });
    const trackerDirectory = trackerWithLoggedEvents('J1', BUILD_EVENTS);

    EndedJobTokens.creditJobsEndedInTheHold(board, { trackerDirectory, agentAdapter: LINE_AS_EVENT_ADAPTER }, [jobOf('J1', 'build', ['002'])], ENDED_AT);

    expect(progress.tasks[0]?.tokens).toBe(1_550);
    const stopped = board.logRecordsSoFar().filter((record) => record.kind === 'agent-stopped');
    expect(stopped.map((record) => record.fields)).toEqual([{
      agentId: 'J1', agentType: 'build', apiCallCount: 1, endContextTokens: 1_000, totalInputTokens: 1_050, cacheReadInputTokens: 900, outputTokens: 10,
    }]);
  });

  test('the same ended job seen by a second hold credits nothing twice', () => {
    const { board, progress } = boardFixture({
      tasks:   [taskFixture({ id: 7, ticket: '002', tokens: 500 })],
      tickets: [ticketFixture({ id: '002', task: 7 })],
    });
    const context = { trackerDirectory: trackerWithLoggedEvents('J1', BUILD_EVENTS), agentAdapter: LINE_AS_EVENT_ADAPTER };

    EndedJobTokens.creditJobsEndedInTheHold(board, context, [jobOf('J1', 'build', ['002'])], ENDED_AT);
    EndedJobTokens.creditJobsEndedInTheHold(board, context, [jobOf('J1', 'build', ['002'])], ENDED_AT);

    expect(progress.tasks[0]?.tokens).toBe(1_550);
  });

  test('a review job\'s tokens land on its ticket\'s newest review bar, not the ticket\'s own row', () => {
    const { board, progress } = boardFixture({
      tasks: [
        taskFixture({ id: 7, ticket: '002', tokens: 500 }),
        taskFixture({ id: 8, reviewOf: '002', tokens: 10 }),
      ],
      tickets: [ticketFixture({ id: '002', task: 7 })],
    });
    const trackerDirectory = trackerWithLoggedEvents('J2', [assistantTurn('message-1', null, 40, 60)]);

    EndedJobTokens.creditJobsEndedInTheHold(board, { trackerDirectory, agentAdapter: LINE_AS_EVENT_ADAPTER }, [jobOf('J2', 'review', ['002'])], ENDED_AT);

    expect(progress.tasks.map((task) => task.tokens)).toEqual([500, 110]);
  });

  test('a job still on the board is not credited', () => {
    const { board, progress } = boardFixture({
      tasks:   [taskFixture({ id: 7, ticket: '002', tokens: 500 })],
      tickets: [ticketFixture({ id: '002', task: 7 })],
    });
    const trackerDirectory = trackerWithLoggedEvents('J1', BUILD_EVENTS);
    const stillRunning = jobOf('J1', 'build', ['002']);
    const boardWithTheJob = Object.assign(Object.create(board) as typeof board, { jobs: () => [stillRunning] });

    EndedJobTokens.creditJobsEndedInTheHold(boardWithTheJob, { trackerDirectory, agentAdapter: LINE_AS_EVENT_ADAPTER }, [stillRunning], ENDED_AT);

    expect(progress.tasks[0]?.tokens).toBe(500);
  });

  test('a bundle splits its tokens evenly over its tickets, the remainder to the first', () => {
    expect(EndedJobTokens.creditsOf(jobOf('J3', 'build', ['002', '003']), 1_001)).toEqual([
      { target: 'ticket', ticketId: '002', tokens: 501 },
      { target: 'ticket', ticketId: '003', tokens: 500 },
    ]);
  });
});
