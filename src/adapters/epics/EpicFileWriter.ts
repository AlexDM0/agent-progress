import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname }                         from 'node:path';
import { writeFileAtomically }             from '../../lib/atomic-file/AtomicFile.ts';
import type { Epic }                       from '../../lib/tracker-model/@types/Epic.ts';
import { EpicDocumentUtil }                from './utils/EpicDocumentUtil.ts';

/** Writes through `src/lib/atomic-file/AtomicFile.ts`; an epic whose frontmatter would read back unchanged keeps the stored frontmatter text. */
export function createEpicFileWriter(): { write(epic: Readonly<Epic>): void; remove(epic: Readonly<Epic>): void } {
  function write(epic: Readonly<Epic>): void {
    mkdirSync(dirname(epic.filePath), { recursive: true });
    const storedFrontmatterText = unchangedStoredFrontmatterTextOf(epic);
    writeFileAtomically(
      epic.filePath,
      storedFrontmatterText === null
        ? EpicDocumentUtil.epicDocumentTextOf(epic.frontmatter, epic.body, epic.lineEnding)
        : `${storedFrontmatterText}${epic.body}`,
    );
  }

  function remove(epic: Readonly<Epic>): void {
    rmSync(epic.filePath, { force: true });
  }

  return { write, remove };
}

function unchangedStoredFrontmatterTextOf(epic: Readonly<Epic>): string | null {
  let storedText: string;
  try {
    storedText = readFileSync(epic.filePath, 'utf8');
  } catch {
    return null;
  }
  const stored = EpicDocumentUtil.parsedEpicDocumentOf(storedText);
  if (stored.verdict !== 'parsed') return null;

  const frontmatterTextOf = (frontmatter: Epic['frontmatter']): string => EpicDocumentUtil.epicDocumentTextOf(frontmatter, '', stored.lineEnding);
  if (frontmatterTextOf(stored.frontmatter) !== frontmatterTextOf(epic.frontmatter)) return null;
  return storedText.slice(0, storedText.length - stored.body.length);
}
