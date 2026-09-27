/** One row of the tracker's progress.json as stored, for a command spec to check what a command wrote to it. */
import type { Task }        from '../../src/lib/tracker-model/@types/Task.ts';
import { storedProgressOf } from './StoredProgress.ts';

export function storedRowOf(repositoryDirectory: string, rowIdentifier: number): Task | undefined {
  return storedProgressOf(repositoryDirectory).tasks.find((task) => task.id === rowIdentifier);
}
