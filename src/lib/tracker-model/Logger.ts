/**
 * How the Board tells the log what happened: one call per event with a record of the `LogRecordContent` union, ids and values only. The
 * union is the vocabulary; `createLogger` stamps the record, hands it to the sink and returns it, and what the sink stores is its decision.
 */
import type { LogRecord, LogRecordContent } from './@types/LogRecord.ts';

export interface Logger {
  log(content: LogRecordContent, at: string): LogRecord;
}

export function createLogger(sink: (record: LogRecord) => void): Logger {
  function log(content: LogRecordContent, at: string): LogRecord {
    const record: LogRecord = { at, ...content };
    sink(record);
    return record;
  }

  return { log };
}
