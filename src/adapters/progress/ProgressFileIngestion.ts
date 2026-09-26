/**
 * progress.json read into the model: read, validate, migrate the retired words and a version 1 file's log, map, and give legacy review bars
 * their `reviewOf` and round.
 */
import { existsSync, readFileSync }           from 'node:fs';
import type { LogRecord }                     from '../../lib/tracker-model/@types/LogRecord.ts';
import type { ProgressFile }                  from '../../lib/tracker-model/@types/ProgressFile.ts';
import { LegacyReviewBarUtil }                from '../utils/LegacyReviewBarUtil.ts';
import type { StoredProgressFile }            from './@types/StoredProgressFile.ts';
import { EMBEDDED_LOG_PROGRESS_FILE_VERSION } from './constants/ProgressFileVersions.ts';
import { ProgressFileMappingUtil }            from './utils/ProgressFileMappingUtil.ts';
import { ProgressFileMigrationUtil }          from './utils/ProgressFileMigrationUtil.ts';
import { ProgressFileValidationUtil }         from './utils/ProgressFileValidationUtil.ts';

export type ProgressFileReading =
  /** `embeddedLog` is a version 1 file's own log as notes, and null for a version 2 file, whose log is log.jsonl. */
  | { verdict: 'readable'; progress: ProgressFile; embeddedLog: LogRecord[] | null }
  | { verdict: 'absent' }
  | { verdict: 'unreadable'; reason: string };

export class ProgressFileIngestion {
  constructor(private readonly progressFilePath: string) {}

  /**
   * Never throws: an unreadable file comes back as a verdict whose reason names the offending field.
   * A file that exists but cannot be read is `unreadable`, never `absent`, because `absent` is the answer that invites `init` to replace a good file.
   */
  read(): ProgressFileReading {
    let rawText: string;
    try {
      rawText = readFileSync(this.progressFilePath, 'utf8');
    } catch (error) {
      if (!existsSync(this.progressFilePath)) return { verdict: 'absent' };
      return { verdict: 'unreadable', reason: `it could not be read (${error instanceof Error ? error.message : 'unknown error'})` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      return { verdict: 'unreadable', reason: `it is not valid JSON (${error instanceof Error ? error.message : 'unparseable'})` };
    }

    const problem = ProgressFileValidationUtil.documentProblemOf(parsed);
    if (problem !== null) return { verdict: 'unreadable', reason: problem };
    const document = parsed as StoredProgressFile;

    const embeddedLog = document.version === EMBEDDED_LOG_PROGRESS_FILE_VERSION ? ProgressFileMigrationUtil.notesOf(document.log) : null;
    const progress    = ProgressFileMappingUtil.progressOf({ ...document, tasks: ProgressFileMigrationUtil.tasksInCurrentWords(document.tasks) });
    // In memory only, like the status words: the next write stores the fields.
    progress.tasks = progress.tasks.map(LegacyReviewBarUtil.linkedReviewBarOf);
    return { verdict: 'readable', progress, embeddedLog };
  }
}
