import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import type { LogRecord }      from '../../lib/tracker-model/@types/LogRecord.ts';

/** Always the whole file, one record per line, through `src/lib/atomic-file/AtomicFile.ts`: a reader never sees a half-written log. */
export function createLogFileWriter(logFilePath: string): { write(records: readonly LogRecord[]): void; contentsOf(records: readonly LogRecord[]): string } {
  function contentsOf(records: readonly LogRecord[]): string {
    return records.map((record) => `${JSON.stringify(record)}\n`).join('');
  }

  function write(records: readonly LogRecord[]): void {
    writeFileAtomically(logFilePath, contentsOf(records));
  }

  return { write, contentsOf };
}
