import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import { JsonTextUtil }        from '../../shared/utils/JsonTextUtil.ts';

export interface InstallManifest {
  installVersion: number;
}

export function createInstallManifestWriter(manifestFilePath: string): { write(manifest: InstallManifest): void } {
  /** Indented and newline-terminated like progress.json, because people read and repair it by hand. */
  function write({ installVersion }: InstallManifest): void {
    writeFileAtomically(manifestFilePath, JsonTextUtil.storedFileTextOf({ installVersion }));
  }
  return { write };
}
