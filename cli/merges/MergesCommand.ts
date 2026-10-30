/** The merge queue as `status` reads the tracker: each target's held slot, then its queued tickets in priority and readiness order. */
import type { LogRecord }      from '../../src/lib/tracker-model/@types/LogRecord.ts';
import { MERGE_PRIORITY_RANK } from '../../src/lib/tracker-model/AirlockClaims.ts';
import type { Board }          from '../../src/lib/tracker-model/Board.ts';
import { readingBoardOf }      from '../../src/lib/tracker-model/ReadingBoard.ts';
import { requireTracker }      from '../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }    from '../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }       from '../../src/shared/constants/ProductNames.ts';
import type { CommandHandler } from '../CommandHandler.ts';
import { OutputUtil }          from '../utils/OutputUtil.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} merges [--json]`;

interface QueuedMerge {
  ticketId: string;
  target:   string;
  priority: keyof typeof MERGE_PRIORITY_RANK;
  /** The ticket's place in the log's `merge-queued` order: lower lands first within a priority. */
  queuedAt: number;
}

interface HeldSlot {
  target:    string;
  jobId:     string;
  ticketIds: readonly string[];
  phase:     string;
  targetTip: string;
  branchTip: string;
}

interface MergesReport {
  slots: HeldSlot[];
  queue: QueuedMerge[];
}

function mergesReportOf(board: Board, storedLog: readonly LogRecord[]): MergesReport {
  const queuedById = new Map<string, { target: string; position: number }>();
  storedLog.forEach((record, position) => {
    if (record.kind === 'merge-queued') queuedById.set(record.ticketId, { target: record.fields.target, position });
  });
  const queue = board.tickets()
    .filter(({ frontmatter }) => frontmatter.status === 'in-review' && board.ticketIsMergeQueued(frontmatter.id))
    .filter(({ frontmatter }) => !board.jobs().some((job) => job.slot !== undefined && job.ticketIds.includes(frontmatter.id)))
    .map(({ frontmatter }): QueuedMerge => ({
      ticketId: frontmatter.id,
      target:   queuedById.get(frontmatter.id)?.target ?? '',
      priority: frontmatter.priority ?? 'normal',
      queuedAt: queuedById.get(frontmatter.id)?.position ?? -1,
    }))
    .sort((a, b) => a.target.localeCompare(b.target) || MERGE_PRIORITY_RANK[a.priority] - MERGE_PRIORITY_RANK[b.priority] || a.queuedAt - b.queuedAt);
  const slots = board.jobs().flatMap((job): HeldSlot[] => (job.slot === undefined ? [] : [{
    target: job.slot.target, jobId: job.id, ticketIds: [...job.ticketIds], phase: job.slot.phase, targetTip: job.slot.targetTip, branchTip: job.slot.branchTip,
  }]));
  return { slots, queue };
}

function mergesTextOf(report: MergesReport): string {
  if (report.slots.length === 0 && report.queue.length === 0) return 'No Airlock is held and nothing is queued to merge.';
  const slotLines  = report.slots.map((slot) => `${slot.target}: job ${slot.jobId} merging #${slot.ticketIds.join(', #')} (${slot.phase})`);
  const queueLines = report.queue.map((queued, index) => `${index + 1}. #${queued.ticketId} into ${queued.target}, ${queued.priority} priority`);
  return [...slotLines, ...(queueLines.length === 0 ? ['Nothing is queued to merge.'] : ['Queued:', ...queueLines])].join('\n');
}

export const mergesCommand: CommandHandler = (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['json'], USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);
  const workspace = requireWorkspace(context.currentDirectory);
  const {
    progress, storedLog, listing, epicListing, draftListing
  } = requireTracker(workspace);
  OutputUtil.reportIgnoredTicketFiles(context, listing.malformed);
  const board  = readingBoardOf(progress, listing.tickets, epicListing.epics, draftListing.drafts, storedLog.records);
  const report = mergesReportOf(board, storedLog.records);
  OutputUtil.printEntity(commandArguments, context, report, mergesTextOf(report));
  return Promise.resolve();
};
