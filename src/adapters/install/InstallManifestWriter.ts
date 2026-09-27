import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import { LIMITS }              from '../../shared/constants/Limits.ts';

export function createInstallManifestWriter(manifestFilePath: string): { write(installVersion: number): void } {
  /** Indented and newline-terminated like progress.json, because people read and repair it by hand. */
  function write(installVersion: number): void {
    writeFileAtomically(manifestFilePath, `${JSON.stringify({ installVersion }, null, LIMITS.JSON_INDENT_SPACES)}\n`);
  }

  return { write };
}
