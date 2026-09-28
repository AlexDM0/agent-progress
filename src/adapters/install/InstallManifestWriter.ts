import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import { JSON_INDENT_SPACES }  from '../../shared/constants/JsonIndent.ts';

export function createInstallManifestWriter(manifestFilePath: string): { write(installVersion: number): void } {
  /** Indented and newline-terminated like progress.json, because people read and repair it by hand. */
  function write(installVersion: number): void {
    writeFileAtomically(manifestFilePath, `${JSON.stringify({ installVersion }, null, JSON_INDENT_SPACES)}\n`);
  }

  return { write };
}
