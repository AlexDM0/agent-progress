/**
 * A tracker on disk as the store's own writers leave it, and the readings the tracker service specs take of one. Test-only: nothing that ships
 * may import `src/testing/`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join }                                from 'node:path';

import { createLogFileWriter }      from '../adapters/log/LogFileWriter.ts';
import { createProgressFileWriter } from '../adapters/progress/ProgressFileWriter.ts';
import { createTicketFileWriter }   from '../adapters/tickets/TicketFileWriter.ts';
import type { LogRecord }           from '../lib/tracker-model/@types/LogRecord.ts';
import type { Workspace }           from '../services/tracker/Workspace.ts';
import { ticketFixture }            from './BoardFixtures.ts';
import { emptyProgress }            from './ProgressFixtures.ts';

/** A log.jsonl line that parses as JSON but fails validation, so the log reads unreadable while the progress file stays readable. */
export const BROKEN_LOG_TEXT = '{"at":"2026-09-18T20:05:00+02:00","kind":"note","fields":{"text":5}}\n';

export const EXAMPLE_TICKET_FILE_NAME = '001-example-checkout-page.md';

export const EXAMPLE_SESSION_NOTE: LogRecord = { at: '2026-09-18T10:15:00+02:00', kind: 'note', fields: { text: 'Example session started' } };

/** An empty progress file, one note in log.jsonl and one ticket. */
export function writeReadableTracker(workspace: Workspace): void {
  createProgressFileWriter(workspace.progressFilePath).write(emptyProgress());
  createLogFileWriter(workspace.logFilePath).write([EXAMPLE_SESSION_NOTE]);
  createTicketFileWriter().write({ ...ticketFixture({ title: 'Example checkout page' }), filePath: join(workspace.ticketsDirectory, EXAMPLE_TICKET_FILE_NAME) });
}

/** Every stored file but the lock's records, which every lock hold writes. */
export function storedFileContentsOf(workspace: Workspace): Record<string, string> {
  const contents: Record<string, string> = {};
  for (const fileName of readdirSync(workspace.trackerDirectory, { recursive: true, encoding: 'utf8' })) {
    const filePath = join(workspace.trackerDirectory, fileName);
    if (filePath.startsWith(workspace.lockDirectoryPath) || statSync(filePath).isDirectory()) continue;
    contents[fileName] = readFileSync(filePath, 'utf8');
  }
  return contents;
}
