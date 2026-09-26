import type { LogRecord } from '../../../lib/tracker-model/@types/LogRecord.ts';

export interface StoredLog {
  records:                LogRecord[];
  logFileMustBeRewritten: boolean;
}

export type StoredLogReading = ({ verdict: 'readable' } & StoredLog) | { verdict: 'unreadable'; reason: string };
