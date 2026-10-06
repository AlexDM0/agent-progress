import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

export interface RepositorySource {
  /** Repository-rooted, with forward slashes. */
  readonly path: string;
  readonly text: string;
}

const SKIPPED_FOLDERS = ['node_modules/', '.claude/', '.agent-progress/', '.readme-graphics/build/'];

/** Every TypeScript file in the checkout, its dependencies and the git-ignored folders left out, in path order. */
export function repositoryTypeScriptSources(repositoryRoot: string): RepositorySource[] {
  return [...new Bun.Glob('**/*.ts').scanSync({ cwd: repositoryRoot, dot: true })]
    .filter((path) => !SKIPPED_FOLDERS.some((folder) => path.startsWith(folder) || path.includes(`/${folder}`)))
    .sort()
    .map((path) => ({ path, text: readFileSync(join(repositoryRoot, path), 'utf8') }));
}
