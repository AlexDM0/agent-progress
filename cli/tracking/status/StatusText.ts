/** What `status` prints for a person: the counts, the rows table and the recent log. */
import { TokenCountUtil }                                        from '../../../src/lib/token-count/TokenCountUtil.ts';
import type { Task, TaskStatus }                                 from '../../../src/lib/tracker-model/@types/Task.ts';
import type { TrackerProgress }                                  from '../../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { Board }                                            from '../../../src/lib/tracker-model/Board.ts';
import { SETTLED_TASK_STATUSES, TASK_STATUSES, TICKET_STATUSES } from '../../../src/lib/tracker-model/constants/Statuses.ts';
import type { WordedLogEntry }                                   from '../../../src/shared/@types/WordedLogEntry.ts';
import { LIMITS }                                                from '../../../src/shared/constants/Limits.ts';
import { OutputUtil }                                            from '../../utils/OutputUtil.ts';

const HUMAN_LOG_ENTRY_COUNT = 5;

const TASK_COLUMN_WIDTHS_CHARACTERS = {
  identifier: 5,
  status:     12,
  owner:      14,
  ticket:     7,
  tokens:     8,
};

function countsByStatus(statuses: readonly TaskStatus[], statusOfEach: readonly TaskStatus[]): string {
  const present = statuses
    .map((status) => ({ count: statusOfEach.filter((occurring) => occurring === status).length, status }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.count} ${entry.status}`);
  return present.length === 0 ? 'none' : present.join(' · ');
}

function logStampOf(entry: WordedLogEntry, showsTheDate: boolean): string {
  const start = showsTheDate ? LIMITS.MONTH_AND_DAY_SLICE_START_CHARACTER_OFFSET : LIMITS.CLOCK_SLICE_START_CHARACTER_OFFSET;
  return entry.at.slice(start, LIMITS.CLOCK_SLICE_END_CHARACTER_OFFSET).replace('T', ' ');
}

/** `null` when no row reported a usage, which is a different answer from `0`. */
function totalTokensOf(tasks: readonly Readonly<Task>[]): number | null {
  const reported = tasks.filter((task) => task.tokens !== null);
  if (reported.length === 0) return null;
  return reported.reduce((running, task) => running + (task.tokens ?? 0), 0);
}

function taskTableLinesOf(listedTasks: readonly Readonly<Task>[]): string[] {
  if (listedTasks.length === 0) return [];
  const header = [
    OutputUtil.padColumn('id', TASK_COLUMN_WIDTHS_CHARACTERS.identifier),
    OutputUtil.padColumn('status', TASK_COLUMN_WIDTHS_CHARACTERS.status),
    OutputUtil.padColumn('owner', TASK_COLUMN_WIDTHS_CHARACTERS.owner),
    OutputUtil.padColumn('ticket', TASK_COLUMN_WIDTHS_CHARACTERS.ticket),
    OutputUtil.padColumn('tokens', TASK_COLUMN_WIDTHS_CHARACTERS.tokens),
    'name',
  ].join('');
  const rows = listedTasks.map((task) => [
    OutputUtil.padColumn(`#${task.id}`, TASK_COLUMN_WIDTHS_CHARACTERS.identifier),
    OutputUtil.padColumn(task.status, TASK_COLUMN_WIDTHS_CHARACTERS.status),
    OutputUtil.padColumn(task.owner === '' ? '-' : task.owner, TASK_COLUMN_WIDTHS_CHARACTERS.owner),
    OutputUtil.padColumn(task.ticket === null ? '-' : `#${task.ticket}`, TASK_COLUMN_WIDTHS_CHARACTERS.ticket),
    OutputUtil.padColumn(task.tokens === null ? '-' : TokenCountUtil.formatTokenCount(task.tokens), TASK_COLUMN_WIDTHS_CHARACTERS.tokens),
    task.name,
  ].join(''));
  return ['', header, ...rows];
}

export function humanStatusTextOf(progress: TrackerProgress, logNewestFirst: readonly WordedLogEntry[], board: Board, showsEverything: boolean): string {
  const tickets = board.tickets();
  const lines = [
    `${progress.project} — started ${progress.startedAt.slice(0, LIMITS.DATE_AND_CLOCK_LENGTH_CHARACTERS).replace('T', ' ')}`,
    `Tasks:   ${countsByStatus(TASK_STATUSES, progress.tasks.map((task) => task.status))}`,
    `Tickets: ${countsByStatus(TICKET_STATUSES, tickets.map((ticket) => ticket.frontmatter.status))}`,
  ];

  const totalTokens = totalTokensOf(progress.tasks);
  if (totalTokens !== null) {
    const reportedCount = progress.tasks.filter((task) => task.tokens !== null).length;
    lines.push(`Tokens:  ${TokenCountUtil.formatTokenCount(totalTokens)} reported across ${reportedCount} of ${progress.tasks.length} rows`);
  }

  const listedTasks = showsEverything ? progress.tasks : progress.tasks.filter((task) => !board.taskIsSettled(task));
  lines.push(...taskTableLinesOf(listedTasks));

  const settledTaskCount = progress.tasks.length - listedTasks.length;
  if (settledTaskCount > 0) lines.push(`(${settledTaskCount} ${SETTLED_TASK_STATUSES.join(' or ')} rows not shown; --full lists them)`);

  const recentLog    = showsEverything ? logNewestFirst : logNewestFirst.slice(0, HUMAN_LOG_ENTRY_COUNT);
  const distinctDays = new Set(logNewestFirst.map((entry) => entry.at.slice(0, LIMITS.CALENDAR_DATE_LENGTH_CHARACTERS)));
  if (recentLog.length > 0) {
    lines.push('');
    lines.push(showsEverything ? `Log (all ${recentLog.length}):` : `Log (last ${recentLog.length}):`);
    for (const entry of recentLog) lines.push(`  ${logStampOf(entry, distinctDays.size > 1)}  ${entry.text}`);
  }

  return lines.join('\n');
}
