/** log.jsonl read into the model's records: read, split into lines, parse, validate and map. The format's first version has nothing to migrate. */
import type { LogRecord }          from '../../lib/tracker-model/@types/LogRecord.ts';
import { storedFileTextOf }        from '../StoredFileText.ts';
import { StoredValueUtil }         from '../utils/StoredValueUtil.ts';
import type { LogFileReading }     from './@types/StoredLog.ts';
import { LogRecordMappingUtil }    from './utils/LogRecordMappingUtil.ts';
import { LogRecordValidationUtil } from './utils/LogRecordValidationUtil.ts';

export class LogFileIngestion {
  constructor(private readonly logFilePath: string) {}

  /**
   * Never throws. Strict like progress.json: one malformed line makes the whole log unreadable rather than silently shorter. The reason
   * names this file, because the tracker's log may come from progress.json instead and a reader must see which file is at fault.
   */
  read(): LogFileReading {
    const storedText = storedFileTextOf(this.logFilePath);
    if (storedText.verdict === 'absent') return storedText;
    if (storedText.verdict === 'unreadable') return { verdict: 'unreadable', reason: `${this.logFilePath}: ${storedText.reason}` };

    const records: LogRecord[] = [];
    const lines = storedText.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (line.trim() === '') continue;
      const lineNumber = i + 1;

      const parsedJson = StoredValueUtil.parsedJsonOf(line);
      if (parsedJson.verdict === 'unparseable') return { verdict: 'unreadable', reason: `${this.logFilePath}, line ${lineNumber}: ${parsedJson.problem}` };

      const problem = LogRecordValidationUtil.recordProblemOf(parsedJson.value);
      if (problem !== null) return { verdict: 'unreadable', reason: `${this.logFilePath}, line ${lineNumber}: ${problem}` };
      records.push(LogRecordMappingUtil.recordOf(parsedJson.value));
    }
    return { verdict: 'readable', records };
  }
}
