/** Reads one tracker's stored files without the lock, the progress file, its stored log and the ticket listing, as a verdict or a refusal. */
import { LogFileIngestion }                                from '../../adapters/log/LogFileIngestion.ts';
import { TrackerLogUtil, type StoredLog }                  from '../../adapters/log/utils/TrackerLogUtil.ts';
import { ProgressFileIngestion, type ProgressFileReading } from '../../adapters/progress/ProgressFileIngestion.ts';
import type { ProgressFile }                               from '../../lib/tracker-model/@types/ProgressFile.ts';
import type { UnreadableTracker }                          from '../../shared/@types/UnreadableTracker.ts';
import { OperationRefusal }                                from '../../shared/OperationRefusal.ts';
import { listTickets, type TicketListing }                 from './TicketStore.ts';
import type { Workspace }                                  from './Workspace.ts';

export interface TrackerContents {
  progress:  ProgressFile;
  /** The records, and whether log.jsonl must be rewritten on the next write. */
  storedLog: StoredLog;
  listing:   TicketListing;
}

export type TrackerReading = { verdict: 'readable'; contents: TrackerContents } | UnreadableTracker;

function progressFileReadingOf(workspace: Workspace): Extract<ProgressFileReading, { verdict: 'readable' }> | UnreadableTracker {
  const progressReading = new ProgressFileIngestion(workspace.progressFilePath).read();
  if (progressReading.verdict === 'absent') return { verdict: 'absent', filePath: workspace.progressFilePath };
  if (progressReading.verdict === 'unreadable') {
    return {
      verdict:        'unreadable',
      unreadableFile: 'progress-file',
      filePath:       workspace.progressFilePath,
      reason:         progressReading.reason,
    };
  }
  return progressReading;
}

/**
 * The log is read first, so a version 1 progress file only sits beside an absent log or its own copied notes; an absent log beside a
 * version 2 file may have been written between the two reads, so it is read again. A broken progress file is the verdict even beside a broken log.
 */
export function readTracker(workspace: Workspace): TrackerReading {
  const logFileReadingBeforeProgress = new LogFileIngestion(workspace.logFilePath).read();
  const progressReading              = progressFileReadingOf(workspace);
  if (progressReading.verdict !== 'readable') return progressReading;

  const logFileReading = progressReading.embeddedLog === null && logFileReadingBeforeProgress.verdict === 'absent'
    ? new LogFileIngestion(workspace.logFilePath).read()
    : logFileReadingBeforeProgress;
  const storedLog = TrackerLogUtil.storedLogOf(
    progressReading.embeddedLog,
    logFileReading,
    { logFilePath: workspace.logFilePath, progressFilePath: workspace.progressFilePath },
  );
  if (storedLog.verdict === 'unreadable') {
    return {
      verdict:        'unreadable',
      unreadableFile: 'log-file',
      filePath:       workspace.logFilePath,
      reason:         storedLog.reason,
    };
  }

  return {
    verdict:  'readable',
    contents: {
      progress:  progressReading.progress,
      storedLog: { records: storedLog.records, logFileMustBeRewritten: storedLog.logFileMustBeRewritten },
      listing:   listTickets(workspace),
    },
  };
}

/** Unrepaired: no command repairs a tracker it cannot read, and under the lock the files were there a moment ago. */
export function requireTracker(workspace: Workspace): TrackerContents {
  const reading = readTracker(workspace);
  if (reading.verdict !== 'readable') throw new OperationRefusal('unrepaired', { kind: 'unreadable-tracker', reading });
  return reading.contents;
}

/** For the progress-only reads (`concurrency`, `dispatcher`): log.jsonl is not read, so a broken log does not stop them. */
export function requireProgressFile(workspace: Workspace): ProgressFile {
  const reading = progressFileReadingOf(workspace);
  if (reading.verdict !== 'readable') throw new OperationRefusal('unrepaired', { kind: 'unreadable-tracker', reading });
  return reading.progress;
}
