/** The tracker's progress.json as stored, parsed, for a command spec to check what a command wrote. */
import { readFileSync } from 'node:fs';

import type { TrackerProgress } from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import { workspacePathsFor }    from '../../src/services/tracker/Workspace.ts';

export function storedProgressOf(repositoryDirectory: string): TrackerProgress {
  return JSON.parse(readFileSync(workspacePathsFor(repositoryDirectory).progressFilePath, 'utf8')) as TrackerProgress;
}
