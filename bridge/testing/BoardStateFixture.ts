/** A synthetic `BoardState` for the header, epics, finished-work and merge-queue specs: two epics, five tickets, one queued target. */
import type {
  BoardStateDocument,
  EpicRollupDocument,
  MergeTargetDocument,
  NoticeDocument,
  PageTicketDocument
} from '../@types/BoardStateDocument.ts';

export const FIXTURE_NOW = new Date('2026-10-29T12:00:00');

export const FIXTURE_TICKETS: readonly PageTicketDocument[] = [
  {
    id: '1', title: 'Example delivered long ago', status: 'delivered', updated: '2026-10-20T10:00:00', delivered: '2026-10-20T10:00:00', abandonedAt: null
  },
  {
    id: '2', title: 'Example delivered this morning', status: 'delivered', updated: '2026-10-29T09:00:00', delivered: '2026-10-29T09:00:00', abandonedAt: null
  },
  {
    id: '3', title: 'Example in progress', status: 'in-progress', updated: '2026-10-29T08:00:00', delivered: null, abandonedAt: null
  },
  {
    id: '4', title: 'Example waiting', status: 'pending', updated: '2026-10-28T08:00:00', delivered: null, abandonedAt: null
  },
  {
    id: '5', title: 'Example abandoned yesterday', status: 'abandoned', updated: '2026-10-28T20:00:00', delivered: null, abandonedAt: '2026-10-28T20:00:00'
  },
];

export const OPEN_EPIC: EpicRollupDocument = {
  key:                 'checkout',
  title:               'Example checkout',
  slot:                1,
  ticketIds:           ['2', '3', '4'],
  ticketCountByStatus: { 'delivered': 1, 'in-progress': 1, 'pending': 1 },
  tokens:              12_400,
  span:                { start: '2026-10-28T08:00:00', end: null },
};

export const FINISHED_EPIC: EpicRollupDocument = {
  key:                 'archive',
  title:               'Example archive',
  slot:                2,
  ticketIds:           ['1'],
  ticketCountByStatus: { delivered: 1 },
  tokens:              800,
  span:                { start: '2026-10-19T08:00:00', end: '2026-10-20T10:00:00' },
};

export const PLANTED_DESCRIPTION_HTML = '<p>Example summary</p><img src=x onerror="window.plantedRan = true"><script>window.plantedRan = true</script>'
  + '<a href="javascript:window.plantedRan = true">planted</a>';

export const QUEUED_TARGET: MergeTargetDocument = {
  target: 'main',
  holder: { jobId: 'J12', ticketIds: ['7'], phase: 'gating' },
  order:  [
    {
      ticketId: '8', priority: 'high', againstTarget: 'clean', conflictedFiles: [], conflictsCaused: 1
    },
    {
      ticketId: '9', priority: 'normal', againstTarget: 'conflicting', conflictedFiles: ['src/Example.ts'], conflictsCaused: 0
    },
  ],
  pairwiseConflicts:      [['8', '10']],
  targetMovedDecisionIds: ['E4'],
};

export const DIRTY_CHECKOUT_NOTICE: NoticeDocument = {
  kind: 'dirty-main-checkout', target: 'main', branch: 'main', blockingFiles: ['README.md']
};

export function boardStateFixture(changes: Partial<BoardStateDocument> = {}): BoardStateDocument {
  return {
    project:   'Example Agency',
    jobs:      [{ id: 'J12' }],
    decisions: [{ id: 'E4' }],
    incidents: [],
    overseer:  {
      state: 'serving', paused: false, codeVersion: 'code-1', handoverWarning: null
    },
    usage:       { resetsAt: null, window: null },
    notices:     [],
    concurrency: { limit: 4, agentsInFlight: 2 },
    page:        {
      payload: {
        progress: {
          tasks: [
            { status: 'in-progress', end: null, tokens: 3000 },
            { status: 'delivered', end: '2026-10-29T09:00:00', tokens: 1500 },
            { status: 'delivered', end: '2026-10-20T10:00:00', tokens: 900 },
          ],
        },
        epicDescriptions: [{ key: 'checkout', descriptionHtml: PLANTED_DESCRIPTION_HTML }, { key: 'archive', descriptionHtml: '' }],
        boardFacts:       {
          epics:   [FINISHED_EPIC, OPEN_EPIC],
          tickets: FIXTURE_TICKETS.map((ticket) => ({ ticketId: ticket.id, displayState: ticket.status })),
        },
      },
      tickets: FIXTURE_TICKETS,
    },
    mergeQueue: { targets: [QUEUED_TARGET] },
    ...changes,
  };
}
