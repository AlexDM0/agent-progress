/**
 * A scratch repository with the main line checked out, one worktree per ticket branch, and a fixture Board whose holds run in place, around
 * `createMergeSlots`: the gate, the merge agent's reading and its host's liveness are the spec's to set. Test-only.
 */
import { writeFileSync } from 'node:fs';
import { join }          from 'node:path';

import type { GateOutcome, Job }                   from '../../../lib/tracker-model/@types/Job.ts';
import type { TicketPriority }                     from '../../../lib/tracker-model/@types/Ticket.ts';
import type { Board }                              from '../../../lib/tracker-model/Board.ts';
import { MERGE_SLOT_LIMITS, type MergeSlotLimits } from '../../../shared/constants/MergeSlotLimits.ts';
import { boardFixture, ticketFixture }             from '../../../testing/BoardFixtures.ts';
import {
  commitFile,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
}                                            from '../../../testing/ScratchWorkspace.ts';
import { createMergeSlots, type MergeAgentReading, type MergeSlots } from '../MergeSlots.ts';

export const HARNESS_AT = '2026-10-28T10:00:00+01:00';

/** Every Acceptance item accounted for, so a landing's ticket checks pass unless a spec says otherwise. */
export const ACCOUNTED_BODY = '## Acceptance\n\nA1. Example cart totals add up.\n\n## Review\n\n- A1 holds — Example probe.\n';

export interface HarnessTicket {
  id:        string;
  priority?: TicketPriority;
  /** Committed on the ticket branch: `[file, content]`. */
  change:    [string, string];
  body?:     string;
}

export interface MergeSlotsHarness {
  repository: string;
  board:      Board;
  slots:      MergeSlots;
  /** The slot phase each hold left on the main line's merge job, in hold order. */
  phases:     string[];
  gatedTrees: string[];
  stopped:    string[];
  settings:    {
    gateOutcome:   GateOutcome;
    reading:       MergeAgentReading;
    hostIsLive:    boolean;
    refDeniesHold: boolean;
    /** Runs before each gate returns: a spec moves the main line here. */
    beforeGate:    () => void;
  };
  worktreeOf: (ticketId: string) => string;
  tipOf:      (branch: string) => string;
  mergeJob:   () => Readonly<Job> | undefined;
  mergeAgent: () => Readonly<Job> | undefined;
  remove:     () => void;
}

export function createMergeSlotsHarness(tickets: readonly HarnessTicket[], limits: Partial<MergeSlotLimits> = {}): MergeSlotsHarness {
  const repository = createScratchGitRepository('merge-slots');
  gitOutputIn(repository, ['checkout', '-q', '-B', 'main']);
  commitFile(repository, 'base.ts', 'export const base = 1;\n');
  const worktreeOf = (ticketId: string): string => join(`${repository}-worktrees`, `ticket-${ticketId}`);
  for (const ticket of tickets) {
    gitOutputIn(repository, ['worktree', 'add', '-q', '-b', `ticket-${ticket.id}`, worktreeOf(ticket.id), 'main']);
    commitFile(worktreeOf(ticket.id), ...ticket.change);
  }
  const { board } = boardFixture({
    tickets: tickets.map((ticket) => ({
      ...ticketFixture({ id: ticket.id, status: 'in-review', ...(ticket.priority === undefined ? {} : { priority: ticket.priority }) }),
      body: ticket.body ?? ACCOUNTED_BODY,
    })),
  });
  for (const ticket of tickets) board.queueTicketForMerge(ticket.id, 'main', HARNESS_AT);

  const phases: string[] = [];
  const gatedTrees: string[] = [];
  const stopped: string[] = [];
  const settings: MergeSlotsHarness['settings'] = {
    gateOutcome: 'passed', reading: { calls: 0, report: undefined }, hostIsLive: false, refDeniesHold: true, beforeGate: () => undefined,
  };
  const mergeJob = (): Readonly<Job> | undefined => board.mergeSlotHolderOf('main');
  const slots = createMergeSlots({
    repositoryRoot:    repository,
    mainLine:          'main',
    groupTargetPrefix: 'group-',
    worktreeOf,
    limits:            { ...MERGE_SLOT_LIMITS, ...limits },
    get refDeniesHold() {
      return settings.refDeniesHold;
    },
    hold: (mutate) => {
      const result = mutate({ board, at: HARNESS_AT });
      const phase = mergeJob()?.slot?.phase;
      if (phase !== undefined && phases.at(-1) !== phase) phases.push(phase);
      return Promise.resolve(result);
    },
    gateMergedTree: (_worktreePath, treeId) => {
      gatedTrees.push(treeId);
      settings.beforeGate();
      return Promise.resolve(settings.gateOutcome);
    },
    mergeAgentReadingOf: () => settings.reading,
    hostIsLive:          () => settings.hostIsLive,
    stopMergeAgent:      (job) => {
      stopped.push(job.id);
      return Promise.resolve();
    },
    decisionWordingOf: () => ({
      questions: [{
        question: 'Example?', header: 'Example', multiSelect: false, options: []
      }],
      context: ''
    }),
    dispatchIsStopped: () => false,
  });
  return {
    repository,
    board,
    slots,
    phases,
    gatedTrees,
    stopped,
    settings,
    worktreeOf,
    tipOf:      (branch) => gitOutputIn(repository, ['rev-parse', `refs/heads/${branch}`]),
    mergeJob,
    mergeAgent: () => board.jobs().find((job) => job.kind === 'merge-agent'),
    remove:     () => {
      removeScratchDirectory(`${repository}-worktrees`);
      removeScratchDirectory(repository);
    },
  };
}

/** What a resolver does in its session: the conflict settled to `content`, the merge committed, the report handed back verifying. */
export function resolveAs(harness: MergeSlotsHarness, ticketId: string, file: string, content: string, report: Record<string, unknown> = {}): void {
  const worktree = harness.worktreeOf(ticketId);
  commitResolution(worktree, file, content);
  finishMergeAgent(harness, {
    outcome: 'resolved', resolvedFiles: [file], notes: '', reportKind: null, ...report
  });
}

export function commitResolution(worktree: string, file: string, content: string): void {
  writeFileSync(join(worktree, file), content);
  gitOutputIn(worktree, ['add', '--', file]);
  gitOutputIn(worktree, ['-c', 'user.name=Alex Example', '-c', 'user.email=alex@example.com', 'commit', '-q', '--no-edit']);
}

export function finishMergeAgent(harness: MergeSlotsHarness, report: Record<string, unknown>): void {
  const agent = harness.mergeAgent();
  if (agent === undefined) throw new Error('No merge agent is live.');
  if (agent.state === 'launching') harness.board.moveJob(agent.id, 'running', HARNESS_AT);
  harness.board.moveJob(agent.id, 'verifying', HARNESS_AT);
  harness.settings.reading = { calls: 3, report };
}
