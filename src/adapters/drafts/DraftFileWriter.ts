import { mkdirSync, rmSync }   from 'node:fs';
import { dirname }             from 'node:path';
import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import type { Draft }          from '../../lib/tracker-model/@types/Draft.ts';
import { DraftDocumentUtil }   from './utils/DraftDocumentUtil.ts';

/** Writes through `src/lib/atomic-file/AtomicFile.ts`; the filing cabinet folder is made at the first write, so a tracker without drafts has none. */
export function createDraftFileWriter(filePathOf: (draftId: string) => string): {
  write(draft: Readonly<Draft>): void;
  remove(draft: Readonly<Draft>): void;
  contentsOf(draft: Readonly<Draft>): string;
} {
  function write(draft: Readonly<Draft>): void {
    const filePath = filePathOf(draft.id);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileAtomically(filePath, DraftDocumentUtil.draftDocumentTextOf(draft));
  }

  function remove(draft: Readonly<Draft>): void {
    rmSync(filePathOf(draft.id), { force: true });
  }

  return { write, remove, contentsOf: DraftDocumentUtil.draftDocumentTextOf };
}
