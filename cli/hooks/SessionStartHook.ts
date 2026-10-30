/**
 * `hook session-start`: prints the installed session instructions, which Claude Code adds to the session it starts. A session the Overseer
 * launched for a job prints nothing, since its role prompt is its whole brief. Never checks the install version.
 */
import { readFileSync } from 'node:fs';

import { findWorkspace }        from '../../src/services/tracker/Workspace.ts';
import type { CommandContext }  from '../CommandContext.ts';
import { installedFilePathsIn } from '../InstalledFiles.ts';

/** Prints nothing on any failure and never throws: a failing SessionStart hook would reach every session in the repository. */
export function printTheSessionInstructions(context: CommandContext): void {
  if (context.job !== undefined) return;
  try {
    const workspace = findWorkspace(context.currentDirectory);
    if (workspace === null) return;
    context.standardOutput(readFileSync(installedFilePathsIn(workspace.rootDirectory).sessionInstructions, 'utf8').replace(/\n+$/, ''));
  } catch {
    // Deliberately silent: the hook's one job is to add text, and a session without it still works.
  }
}
