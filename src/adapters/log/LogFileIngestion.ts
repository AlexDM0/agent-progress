/** log.jsonl read into the model's records: read, split into lines, parse, validate and map. The format's first version has nothing to migrate. */
import { existsSync, readFileSync } from 'node:fs';
import type { LogRecord }           from '../../lib/tracker-model/@types/LogRecord.ts';
import { LogRecordMappingUtil }     from './utils/LogRecordMappingUtil.ts';
import { LogRecordValidationUtil }  from './utils/LogRecordValidationUtil.ts';

export type LogFileReading =
  | { verdict: 'readable'; records: LogRecord[] }
  | { verdict: 'absent' }
  | { verdict: 'unreadable'; reason: string };

export class LogFileIngestion {
  constructor(private readonly logFilePath: string) {}

  /**
   * Never throws. Strict like progress.json: one malformed line makes the whole log unreadable rather than silently shorter. The reason
   * names this file, because the tracker's log may come from progress.json instead and a reader must see which file is at fault.
   */
  read(): LogFileReading {
    let rawText: string;
    try {
      rawText = readFileSync(this.logFilePath, 'utf8');
    } catch (error) {
      if (!existsSync(this.logFilePath)) return { verdict: 'absent' };
      return { verdict: 'unreadable', reason: `${this.logFilePath}: it could not be read (${error instanceof Error ? error.message : 'unknown error'})` };
    }

    const records: LogRecord[] = [];
    const lines = rawText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (line.trim() === '') continue;
      const lineNumber = i + 1;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        return { verdict: 'unreadable', reason: `${this.logFilePath}, line ${lineNumber}: it is not valid JSON (${error instanceof Error ? error.message : 'unparseable'})` };
      }

      const problem = LogRecordValidationUtil.recordProblemOf(parsed);
      if (problem !== null) return { verdict: 'unreadable', reason: `${this.logFilePath}, line ${lineNumber}: ${problem}` };
      records.push(LogRecordMappingUtil.recordOf(parsed));
    }
    return { verdict: 'readable', records };
  }
}
