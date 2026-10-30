/**
 * A job's tokens reach its tickets' rows when it ends. What matters: they add to what the row held, a review job's land on the newest
 * review bar, a turn repeated across log lines counts once, a job still on the board is not credited, and a hold that sees the same ended
 * job again credits nothing twice, since the `agent-stopped` record keyed by the job id already holds its total. A job a CLI control ended in
 * a hold of its own is rebuilt from the log on the next pass, every Watcher instance read, and credited once, whichever path sees it first.
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
import type { Job, JobLaunch }                            from '../../lib/tracker-model/@types/Job.ts';
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

/** A scratch tracker whose job logged each event as one agent line, the first list in its first Watcher instance, the next in the next. */
function trackerWithLoggedEvents(jobId: string, ...eventsPerInstance: (readonly AgentSessionEvent[])[]): string {
  const trackerDirectory = createScratchDirectory('ended-job-tokens');
  scratchDirectories.push(trackerDirectory);
  const jobFolder = WatcherFleet.jobFolderOf(trackerDirectory, jobId);
  mkdirSync(jobFolder, { recursive: true });
  eventsPerInstance.forEach((events, i) => {
    const writer = createEventLogWriter(watcherFilesOf(jobFolder, i + 1).eventLogPath, () => '2026-10-30T13:00:00Z');
    for (const event of events) writer.append('agent', JSON.stringify(event));
    writer.syncAndClose();
  });
  return trackerDirectory;
}

const BUILD_LAUNCH: JobLaunch = {
  kind: 'build', role: 'builder', ticketIds: ['002'], parentJobId: null, attempt: 1, target: 'main',
};

/** A build job that ran two Watcher instances, interrupted after each, then ended by `job stop` in a hold of its own. */
function boardWithAJobStoppedWhileInterrupted(): ReturnType<typeof boardFixture> {
  const fixture = boardFixture({
    tasks:   [taskFixture({ id: 7, ticket: '002', tokens: 500 })],
    tickets: [ticketFixture({ id: '002', task: 7, status: 'in-progress' })],
  });
  const { job } = fixture.board.launchJob(BUILD_LAUNCH, ENDED_AT);
  fixture.board.moveJob(job.id, 'running', ENDED_AT);
  fixture.board.interruptJob(job.id, 'watcher-lost', ENDED_AT);
  fixture.board.moveJob(job.id, 'running', ENDED_AT);
  fixture.board.interruptJob(job.id, 'watcher-lost', ENDED_AT);
  fixture.board.requestJobStop(job.id, 'stop', ENDED_AT);
  expect(fixture.board.jobById(job.id)).toBeUndefined();
  return fixture;
}

const SECOND_INSTANCE_EVENTS = [assistantTurn('message-3', null, 200, 0)];

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

  test('a job `job stop` ended while interrupted is credited every Watcher instance\'s tokens on the next pass, rebuilt from the log', () => {
    const { board, progress } = boardWithAJobStoppedWhileInterrupted();
    const context = { trackerDirectory: trackerWithLoggedEvents('J1', BUILD_EVENTS, SECOND_INSTANCE_EVENTS), agentAdapter: LINE_AS_EVENT_ADAPTER };

    const examined = EndedJobTokens.creditJobsEndedOutsideTheHold(board, context, new Set(), ENDED_AT);

    expect(examined).toEqual(['J1']);
    expect(progress.tasks[0]?.tokens).toBe(1_750);
  });

  test('a job ended outside the hold is credited once, however many passes see it', () => {
    const { board, progress } = boardWithAJobStoppedWhileInterrupted();
    const context = { trackerDirectory: trackerWithLoggedEvents('J1', BUILD_EVENTS, SECOND_INSTANCE_EVENTS), agentAdapter: LINE_AS_EVENT_ADAPTER };

    EndedJobTokens.creditJobsEndedOutsideTheHold(board, context, new Set(), ENDED_AT);
    const examinedAgain = EndedJobTokens.creditJobsEndedOutsideTheHold(board, context, new Set(), ENDED_AT);

    expect(examinedAgain).toEqual([]);
    expect(progress.tasks[0]?.tokens).toBe(1_750);
    expect(board.logRecordsSoFar().filter((record) => record.kind === 'agent-stopped')).toHaveLength(1);
  });

  test('a job the hold credited as it ended is not credited again from the log', () => {
    const { board, progress } = boardFixture({
      tasks:   [taskFixture({ id: 7, ticket: '002', tokens: 500 })],
      tickets: [ticketFixture({ id: '002', task: 7, status: 'in-progress' })],
    });
    const context = { trackerDirectory: trackerWithLoggedEvents('J1', BUILD_EVENTS), agentAdapter: LINE_AS_EVENT_ADAPTER };
    const { job } = board.launchJob(BUILD_LAUNCH, ENDED_AT);
    const jobsAtTheHoldStart = [...board.jobs()];
    board.endJob(job.id, { outcome: 'failed' }, ENDED_AT);

    EndedJobTokens.creditJobsEndedInTheHold(board, context, jobsAtTheHoldStart, ENDED_AT);
    const examined = EndedJobTokens.creditJobsEndedOutsideTheHold(board, context, new Set(), ENDED_AT);

    expect(examined).toEqual([]);
    expect(progress.tasks[0]?.tokens).toBe(1_550);
  });

  test('a job an earlier pass examined is skipped, so one with no turns is not read again every pass', () => {
    const { board } = boardWithAJobStoppedWhileInterrupted();
    const context = { trackerDirectory: trackerWithLoggedEvents('J1'), agentAdapter: LINE_AS_EVENT_ADAPTER };

    const firstExamined = EndedJobTokens.creditJobsEndedOutsideTheHold(board, context, new Set(), ENDED_AT);
    const laterExamined = EndedJobTokens.creditJobsEndedOutsideTheHold(board, context, new Set(firstExamined), ENDED_AT);

    expect(firstExamined).toEqual(['J1']);
    expect(laterExamined).toEqual([]);
  });

  test('a bundle splits its tokens evenly over its tickets, the remainder to the first', () => {
    expect(EndedJobTokens.creditsOf(jobOf('J3', 'build', ['002', '003']), 1_001)).toEqual([
      { target: 'ticket', ticketId: '002', tokens: 501 },
      { target: 'ticket', ticketId: '003', tokens: 500 },
    ]);
  });
});
