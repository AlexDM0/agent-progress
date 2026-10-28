/**
 * Leaves a filed ticket with no row, as an older board stored a pending low ticket: no command makes one now that a ready ticket keeps its
 * row at every priority, so the scratch board's stored files are edited the way that board wrote them.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import type { TrackerProgress } from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import { workspacePathsFor }    from '../../src/services/tracker/Workspace.ts';
import type { FiledTicketFile } from './ReadyTicketFiling.ts';

const TASK_LINE_PATTERN = /^task: \d+$/m;

export function dropTicketRow(repositoryDirectory: string, ticket: FiledTicketFile): void {
  const { progressFilePath } = workspacePathsFor(repositoryDirectory);
  const progress             = JSON.parse(readFileSync(progressFilePath, 'utf8')) as TrackerProgress;
  progress.tasks             = progress.tasks.filter((task) => task.ticket !== ticket.id);
  writeFileSync(progressFilePath, `${JSON.stringify(progress, null, 2)}\n`);
  writeFileSync(ticket.filePath, readFileSync(ticket.filePath, 'utf8').replace(TASK_LINE_PATTERN, 'task: null'));
}
