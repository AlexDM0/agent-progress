import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import { JsonTextUtil }        from '../../shared/utils/JsonTextUtil.ts';

export function createInstallManifestWriter(manifestFilePath: string): { write(installVersion: number): void } {
  /** Indented and newline-terminated like progress.json, because people read and repair it by hand. */
  function write(installVersion: number): void {
    writeFileAtomically(manifestFilePath, JsonTextUtil.storedFileTextOf({ installVersion }));
  }

  return { write };
}
