/** Every file of a scratch repository outside `.git/`, keyed by its path relative to the repository, for a spec to show a command wrote nothing. */
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep }                 from 'node:path';

const GIT_DIRECTORY_NAME = '.git';

export function repositoryFileContentsOf(repositoryDirectory: string): Map<string, string> {
  const fileContents = new Map<string, string>();
  const entries      = readdirSync(repositoryDirectory, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const relativePath = join(entry.parentPath, entry.name).slice(repositoryDirectory.length + 1);
    if (relativePath === GIT_DIRECTORY_NAME || relativePath.startsWith(`${GIT_DIRECTORY_NAME}${sep}`)) continue;
    fileContents.set(relativePath, readFileSync(join(entry.parentPath, entry.name), 'utf8'));
  }
  return fileContents;
}
