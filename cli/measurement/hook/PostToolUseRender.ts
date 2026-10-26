/**
 * The `PostToolUse` hook: after any agent's tool call it re-renders `progress.html` once the page has grown older than
 * `PAGE_RENDER_AGE_THRESHOLD_MILLISECONDS`, so the page stays live exactly while agents work. It runs after every tool call, so it never
 * waits on the lock, never writes to a stream and swallows every failure: a hook that failed or stalled would fail or stall the tool call.
 */
import { statSync } from 'node:fs';

import { renderDashboardIfLockIsFree } from '../../../src/services/tracker/DashboardRendering.ts';
import type { Workspace }              from '../../../src/services/tracker/Workspace.ts';
import { findWorkspace }               from '../../../src/services/tracker/Workspace.ts';
import type { CommandContext }         from '../../CommandContext.ts';
import { requireCurrentInstall }       from '../../InstallVersionCheck.ts';

/** Half the page's ten-minute live limit, so a page an agent keeps touching never reads as a snapshot. */
export const PAGE_RENDER_AGE_THRESHOLD_MILLISECONDS = 300_000;

/** A stated exception to "a clock decides nothing": the page's age only decides whether to redraw it, never anything stored. */
function pageIsOlderThanTheThreshold(workspace: Workspace, now: Date): boolean {
  try {
    return now.getTime() - statSync(workspace.htmlFilePath).mtimeMs > PAGE_RENDER_AGE_THRESHOLD_MILLISECONDS;
  } catch {
    return true;
  }
}

export async function renderAStalePage(context: CommandContext): Promise<void> {
  try {
    const workspace = findWorkspace(context.currentDirectory);
    if (workspace === null || !pageIsOlderThanTheThreshold(workspace, context.now())) return;
    requireCurrentInstall(workspace.rootDirectory);
    await renderDashboardIfLockIsFree(workspace, context.now, context.renderState);
  } catch {
    // Every failure is forgiven silently: the next tool call tries again, and `render` reports what is wrong.
  }
}
