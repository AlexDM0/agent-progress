/** The interim log sink until plan step 5 moves the log to its own file: each record lands in the progress file's `log` as its sentence. */
import type { LogRecord } from '../lib/tracker-model/@types/LogRecord.ts';
import type { LogEntry }  from '../lib/tracker-model/@types/ProgressFile.ts';
import { LogUtil }        from './utils/LogUtil.ts';

export function createProgressLogSink(log: LogEntry[]): (record: LogRecord) => void {
  return (record) => {
    // A cleared tracker's log starts again with the clearing itself; the Board only reports the event, so the sink decides.
    if (record.kind === 'tracker-cleared') log.length = 0;
    log.push({ at: record.at, text: LogUtil.sentenceOf(record) });
  };
}
