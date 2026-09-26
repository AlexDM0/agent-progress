/** progress.json read into the model: read, migrate an older shape to the current one, validate, map. */
import { existsSync, readFileSync }   from 'node:fs';
import type { LogRecord }             from '../../lib/tracker-model/@types/LogRecord.ts';
import type { ProgressFile }          from '../../lib/tracker-model/@types/ProgressFile.ts';
import { ProgressFileUpgradeUtil }    from '../legacy/utils/ProgressFileUpgradeUtil.ts';
import type { ProgressFileMigration } from './@types/ProgressFileMigration.ts';
import type { StoredProgressFile }    from './@types/StoredProgressFile.ts';
import { ProgressFileMappingUtil }    from './utils/ProgressFileMappingUtil.ts';
import { ProgressFileValidationUtil } from './utils/ProgressFileValidationUtil.ts';

export type ProgressFileReading =
  /** `carriedOverLog` is the log records an older progress file carried, which the next write moves to log.jsonl; null when it carried none. */
  | { verdict: 'readable'; progress: ProgressFile; carriedOverLog: LogRecord[] | null }
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

    // The seam: dropping src/adapters/legacy/ makes the right-hand side `{ verdict: 'current' } as ProgressFileMigration`.
    const migration: ProgressFileMigration = ProgressFileUpgradeUtil.migrationOf(parsed);
    if (migration.verdict === 'unreadable') return migration;
    const document = migration.verdict === 'migrated' ? migration.document : parsed;

    const problem = ProgressFileValidationUtil.documentProblemOf(document);
    if (problem !== null) return { verdict: 'unreadable', reason: problem };
    const progress       = ProgressFileMappingUtil.progressOf(document as StoredProgressFile);
    const carriedOverLog = migration.verdict === 'migrated' ? migration.carriedOverLog : null;
    return { verdict: 'readable', progress, carriedOverLog };
  }
}
