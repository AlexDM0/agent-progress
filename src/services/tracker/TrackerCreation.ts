/** Creates a new tracker's files under the lock and renders its first page; an existing progress file is never replaced. */
import { mkdirSync } from 'node:fs';

import { createLogFileWriter }                          from '../../adapters/log/LogFileWriter.ts';
import { createProgressFileWriter }                     from '../../adapters/progress/ProgressFileWriter.ts';
import { EmptyProgressUtil }                            from '../../lib/tracker-model/utils/EmptyProgressUtil.ts';
import type { RenderState }                             from '../render/RenderState.ts';
import { renderDashboard, type DashboardRenderOutcome } from './DashboardRendering.ts';
import { withLock }                                     from './TrackerLock.ts';
import type { Workspace }                               from './Workspace.ts';

export interface NewTracker {
  project:   string;
  startedAt: string;
  /** The page's localStorage namespace; the caller supplies it, so this module has no randomness to fake in a spec. */
  trackerId: string;
}

export type TrackerCreation =
  | { verdict: 'created'; renderOutcome: DashboardRenderOutcome }
  | { verdict: 'already-exists' };

export async function createTracker(workspace: Workspace, newTracker: NewTracker, now: () => Date, renderState: RenderState): Promise<TrackerCreation> {
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
  const progress = EmptyProgressUtil.emptyProgressFor(newTracker);

  return withLock(workspace, async (): Promise<TrackerCreation> => {
    if (createProgressFileWriter(workspace.progressFilePath).create(progress) === 'already-exists') return { verdict: 'already-exists' };

    // A new tracker's log starts empty, so a log.jsonl left from a removed tracker is emptied, never adopted.
    // A crash between the two writes leaves that old log.jsonl beside the new progress file.
    createLogFileWriter(workspace.logFilePath).write([]);
    return { verdict: 'created', renderOutcome: await renderDashboard(workspace, now(), renderState) };
  }, now);
}
