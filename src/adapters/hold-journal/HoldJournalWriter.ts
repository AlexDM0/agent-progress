import { rmSync }   from 'node:fs';
import { relative } from 'node:path';

import { writeFileAtomically }                             from '../../lib/atomic-file/AtomicFile.ts';
import { JsonTextUtil }                                    from '../../shared/utils/JsonTextUtil.ts';
import { HOLD_JOURNAL_FORMAT_VERSION, type JournaledFile } from './HoldJournalIngestion.ts';

type StoredJournalEntry = { path: string; contents: string } | { path: string; removed: true };

/** Through `src/lib/atomic-file/AtomicFile.ts`, so a journal on disk is always whole: it is the hold's commit point. */
export function createHoldJournalWriter(journalFilePath: string, dataDirectory: string): {
  write(files: readonly JournaledFile[]): void;
  remove(): void;
} {
  function storedEntryOf(file: JournaledFile): StoredJournalEntry {
    const path = relative(dataDirectory, file.filePath);
    return file.kind === 'written' ? { path, contents: file.contents } : { path, removed: true };
  }

  function write(files: readonly JournaledFile[]): void {
    writeFileAtomically(journalFilePath, JsonTextUtil.storedFileTextOf({ version: HOLD_JOURNAL_FORMAT_VERSION, files: files.map(storedEntryOf) }));
  }

  function remove(): void {
    rmSync(journalFilePath, { force: true });
  }

  return { write, remove };
}
