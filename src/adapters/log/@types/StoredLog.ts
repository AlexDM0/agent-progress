import type { LogRecord } from '../../../lib/tracker-model/@types/LogRecord.ts';

export interface StoredLog {
  records:                LogRecord[];
  logFileMustBeRewritten: boolean;
}

export type LogFileReading =
  | { verdict: 'readable'; records: LogRecord[] }
  | { verdict: 'absent' }
  | { verdict: 'unreadable'; reason: string };

export type StoredLogReading = ({ verdict: 'readable' } & StoredLog) | { verdict: 'unreadable'; reason: string };
