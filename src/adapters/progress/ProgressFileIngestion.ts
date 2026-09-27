/** progress.json read into the model: read, migrate an older shape to the current one, validate, map. */
import type { LogRecord }             from '../../lib/tracker-model/@types/LogRecord.ts';
import type { ProgressFile }          from '../../lib/tracker-model/@types/ProgressFile.ts';
import { storedFileTextOf }           from '../StoredFileText.ts';
import { ProgressFileUpgradeUtil }    from '../legacy/utils/ProgressFileUpgradeUtil.ts';
import { StoredValueUtil }            from '../utils/StoredValueUtil.ts';
import type { ProgressFileMigration } from './@types/ProgressFileMigration.ts';
import type { StoredProgressFile }    from './@types/StoredProgressFile.ts';
import { ProgressFileMappingUtil }    from './utils/ProgressFileMappingUtil.ts';
import { ProgressFileValidationUtil } from './utils/ProgressFileValidationUtil.ts';

export type ProgressFileReading =
  | {
    verdict:               'readable';
    progress:              ProgressFile;
    /** The log records an older progress file carried, which the next write moves to log.jsonl; null when it carried none. */
    carriedOverLog:        LogRecord[] | null;
    /** `update` rewrites such a file in the current format. */
    fileIsInAnOlderFormat: boolean;
  }
  | { verdict: 'absent' }
  | { verdict: 'unreadable'; reason: string };

export class ProgressFileIngestion {
  constructor(private readonly progressFilePath: string) {}

  /**
   * Never throws: an unreadable file comes back as a verdict whose reason names the offending field.
   * A file that exists but cannot be read is `unreadable`, never `absent`, because `absent` is the answer that invites `init` to replace a good file.
   */
  read(): ProgressFileReading {
    const storedText = storedFileTextOf(this.progressFilePath);
    if (storedText.verdict !== 'readable') return storedText;

    const parsedJson = StoredValueUtil.parsedJsonOf(storedText.text);
    if (parsedJson.verdict === 'unparseable') return { verdict: 'unreadable', reason: parsedJson.problem };
    const parsed = parsedJson.value;

    // The seam: dropping src/adapters/legacy/ makes the right-hand side `{ verdict: 'current' } as ProgressFileMigration`.
    const migration: ProgressFileMigration = ProgressFileUpgradeUtil.migrationOf(parsed);
    if (migration.verdict === 'unreadable') return migration;
    const document = migration.verdict === 'migrated' ? migration.document : parsed;

    const problem = ProgressFileValidationUtil.documentProblemOf(document);
    if (problem !== null) return { verdict: 'unreadable', reason: problem };
    const progress       = ProgressFileMappingUtil.progressOf(document as StoredProgressFile);
    const carriedOverLog = migration.verdict === 'migrated' ? migration.carriedOverLog : null;
    return {
      verdict:               'readable',
      progress,
      carriedOverLog,
      fileIsInAnOlderFormat: migration.verdict === 'migrated',
    };
  }
}
