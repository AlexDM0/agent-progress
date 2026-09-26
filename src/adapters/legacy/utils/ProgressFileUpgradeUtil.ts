/**
 * Reads a progress.json in an older shape: version 1 with its own log, rows in the retired task words, review bars known only by name.
 * It serves only trackers `agent-progress update` has not yet rewritten, and can go once update has run in every tracker.
 */
import { RetiredStatusWordUtil }                                             from '../../../shared/legacy/utils/RetiredStatusWordUtil.ts';
import { ReviewBarNameUtil }                                                 from '../../../shared/legacy/utils/ReviewBarNameUtil.ts';
import type { ProgressFileMigration }                                        from '../../progress/@types/ProgressFileMigration.ts';
import type { StoredProgressFile }                                           from '../../progress/@types/StoredProgressFile.ts';
import { CURRENT_PROGRESS_FILE_VERSION, EMBEDDED_LOG_PROGRESS_FILE_VERSION } from '../../progress/constants/ProgressFileVersions.ts';
import { ProgressFileValidationUtil }                                        from '../../progress/utils/ProgressFileValidationUtil.ts';
import type { StoredLogEntry }                                               from '../@types/StoredProgressFileVersionOne.ts';
import { EmbeddedLogUtil }                                                   from './EmbeddedLogUtil.ts';

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function statusIsRetired(record: Record<string, unknown>): boolean {
  const { status } = record;
  return typeof status === 'string' && RetiredStatusWordUtil.currentTaskStatusFor(status) !== null;
}

function taskHoldsARetiredWord(taskRecord: Record<string, unknown>): boolean {
  if (statusIsRetired(taskRecord)) return true;
  const { history } = taskRecord;
  return Array.isArray(history) && history.some((phase) => {
    const phaseRecord = recordOf(phase);
    return phaseRecord !== null && statusIsRetired(phaseRecord);
  });
}

function documentHoldsSomethingOlder(tasks: unknown): boolean {
  if (!Array.isArray(tasks)) return false;
  return tasks.some((task) => {
    const taskRecord = recordOf(task);
    return taskRecord !== null && (taskHoldsARetiredWord(taskRecord) || ReviewBarNameUtil.reviewBarIsUnlinked(taskRecord));
  });
}

/** A copy with a retired status replaced in place, so the keys keep the file's order. */
function withCurrentStatus(record: Record<string, unknown>): Record<string, unknown> {
  const { status } = record;
  const replacement = typeof status === 'string' ? RetiredStatusWordUtil.currentTaskStatusFor(status) : null;
  return replacement === null ? { ...record } : { ...record, status: replacement };
}

/** In memory only: a read never writes, so a file keeps its retired words until `update` or the next command that changes it stores the new ones. */
function taskInCurrentWords(task: unknown): unknown {
  const taskRecord = recordOf(task);
  if (taskRecord === null) return task;
  const taskCopy    = withCurrentStatus(taskRecord);
  const { history } = taskRecord;
  if (Array.isArray(history)) {
    taskCopy['history'] = history.map((phase: unknown) => {
      const phaseRecord = recordOf(phase);
      return phaseRecord === null ? phase : withCurrentStatus(phaseRecord);
    });
  }
  return taskCopy;
}

/** The document at the current version, a version 1 file's log left out and the retired words replaced, every key in the file's order. */
function upgradedCopyOf(candidate: Record<string, unknown>, carriesItsLog: boolean): Record<string, unknown> {
  const entries = Object.entries(candidate)
    .filter(([key]) => !(carriesItsLog && key === 'log'))
    .map(([key, value]): [string, unknown] => {
      if (key === 'version') return [key, CURRENT_PROGRESS_FILE_VERSION];
      if (key === 'tasks' && Array.isArray(value)) return [key, value.map(taskInCurrentWords)];
      return [key, value];
    });
  return Object.fromEntries(entries);
}

/** The reasons come in the order the file was always checked in: the top level, a version 1 file's log array, the rows, then its log entries. */
function upgradedCopyProblemOf(upgradedCopy: Record<string, unknown>, carriedLog: unknown, carriesItsLog: boolean): string | null {
  const headerProblem = ProgressFileValidationUtil.documentHeaderProblemOf(upgradedCopy);
  if (headerProblem !== null) return headerProblem;
  const logArrayProblem = carriesItsLog ? EmbeddedLogUtil.logArrayProblemOf(carriedLog) : null;
  if (logArrayProblem !== null) return logArrayProblem;
  const tasks: unknown[] = Array.isArray(upgradedCopy['tasks']) ? upgradedCopy['tasks'] : [];
  const rowsProblem      = ProgressFileValidationUtil.taskRowsProblemOf(tasks);
  if (rowsProblem !== null) return rowsProblem;
  return carriesItsLog && Array.isArray(carriedLog) ? EmbeddedLogUtil.logEntriesProblemOf(carriedLog) : null;
}

/** Never throws: a document that is not an object, or is already current, is left to the current path, which names what is wrong with it. */
function migrationOf(parsed: unknown): ProgressFileMigration {
  const candidate = recordOf(parsed);
  if (candidate === null) return { verdict: 'current' };
  const { version } = candidate;
  if (version !== EMBEDDED_LOG_PROGRESS_FILE_VERSION && version !== CURRENT_PROGRESS_FILE_VERSION) {
    return {
      verdict: 'unreadable',
      reason:  `version is ${JSON.stringify(version)}, and this build of agent-progress reads versions ${EMBEDDED_LOG_PROGRESS_FILE_VERSION} and ${CURRENT_PROGRESS_FILE_VERSION}`,
    };
  }
  const carriesItsLog = version === EMBEDDED_LOG_PROGRESS_FILE_VERSION;
  if (!carriesItsLog && !documentHoldsSomethingOlder(candidate['tasks'])) return { verdict: 'current' };

  const upgradedCopy = upgradedCopyOf(candidate, carriesItsLog);
  const problem      = upgradedCopyProblemOf(upgradedCopy, candidate['log'], carriesItsLog);
  if (problem !== null) return { verdict: 'unreadable', reason: problem };

  // Validated above, so the copy is a current document; the linking is in memory too, and the next write stores the fields.
  const validatedCopy                = upgradedCopy as unknown as StoredProgressFile;
  const document: StoredProgressFile = { ...validatedCopy, tasks: validatedCopy.tasks.map((task) => ReviewBarNameUtil.linkedReviewBarOf(task)) };
  const carriedOverLog               = carriesItsLog ? EmbeddedLogUtil.notesOf(candidate['log'] as StoredLogEntry[]) : null;
  return { verdict: 'migrated', document, carriedOverLog };
}

export const ProgressFileUpgradeUtil = { migrationOf } as const;
