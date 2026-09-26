import { join } from 'node:path';

/** Resolves from the installed package, never from the working directory, because the `bun link`ed binary runs from any repository. */
export function resourceFilePathOf(...pathInResources: string[]): string {
  return join(import.meta.dir, '..', '..', 'resources', ...pathInResources);
}
