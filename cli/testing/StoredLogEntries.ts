/** The tracker's log.jsonl as people read it, each record worded through LogUtil, for a command spec to check what a command logged. */
import { LogFileIngestion }    from '../../src/adapters/log/LogFileIngestion.ts';
import { LogUtil }             from '../../src/adapters/utils/LogUtil.ts';
import { workspacePathsFor }   from '../../src/services/tracker/Workspace.ts';
import type { WordedLogEntry } from '../../src/shared/@types/WordedLogEntry.ts';

export function storedLogEntriesOf(repositoryDirectory: string): WordedLogEntry[] {
  const reading = new LogFileIngestion(workspacePathsFor(repositoryDirectory).logFilePath).read();
  if (reading.verdict === 'absent') return [];
  if (reading.verdict === 'unreadable') throw new Error(`the stored log cannot be read: ${reading.reason}`);
  return reading.records.map(LogUtil.wordedEntryOf);
}
