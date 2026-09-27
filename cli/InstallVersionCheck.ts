/** The install version check: every command but `init`, `update`, `help` and `status` refuses while the installed files are of another version. */
import { lstatSync } from 'node:fs';

import { InstallManifestIngestion }    from '../src/adapters/install/InstallManifestIngestion.ts';
import { findWorkspace }               from '../src/services/tracker/Workspace.ts';
import type { InstallVersionMismatch } from '../src/shared/@types/InstallVersionMismatch.ts';
import { OperationRefusal }            from '../src/shared/OperationRefusal.ts';
import { installedFilePathsIn }        from './InstalledFiles.ts';
import { INSTALL_VERSION }             from './constants/InstallVersion.ts';
import type { InstallVersionVerdict }  from './utils/InstallVersionVerdictUtil.ts';
import { InstallVersionVerdictUtil }   from './utils/InstallVersionVerdictUtil.ts';

/**
 * The brief has no opt-out, every `init` and `update` writes it and a fresh `init` writes it first, so it stands for the installed set.
 * Fails closed: only ENOENT is absence.
 */
function installedFilesArePresentIn(rootDirectory: string): boolean {
  try {
    lstatSync(installedFilePathsIn(rootDirectory).agentBrief);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ENOENT');
  }
}

function installVersionVerdictIn(rootDirectory: string): InstallVersionVerdict {
  const reading = new InstallManifestIngestion(installedFilePathsIn(rootDirectory).installManifest).read();
  return InstallVersionVerdictUtil.verdictOf(reading, installedFilesArePresentIn(rootDirectory), INSTALL_VERSION);
}

function installVersionMismatchRefusal(rootDirectory: string, mismatch: InstallVersionMismatch): OperationRefusal {
  return new OperationRefusal('refused', {
    kind:             'install-version-mismatch',
    rootDirectory,
    manifestFilePath: installedFilePathsIn(rootDirectory).installManifest,
    installVersion:   INSTALL_VERSION,
    mismatch,
  });
}

/** Returns when no tracker governs the directory, so the command's own no-tracker refusal stays as it was; nothing is locked or written. */
export function requireCurrentInstall(startDirectory: string): void {
  const workspace = findWorkspace(startDirectory);
  if (workspace === null) return;
  const verdict = installVersionVerdictIn(workspace.rootDirectory);
  if (verdict.verdict === 'mismatch') throw installVersionMismatchRefusal(workspace.rootDirectory, verdict.mismatch);
}

/**
 * `init` and `update` repair every other mismatch, but never write an older install over a newer agent-progress's, and refuse before
 * writing a directory at the manifest's path, which they cannot replace, so a run never stops halfway.
 */
export function requireNoNewerInstall(rootDirectory: string): void {
  const verdict = installVersionVerdictIn(rootDirectory);
  const refusesToInstall = verdict.verdict === 'mismatch' && (verdict.mismatch.reason === 'newer' || verdict.mismatch.reason === 'manifest-is-a-directory');
  if (refusesToInstall) throw installVersionMismatchRefusal(rootDirectory, verdict.mismatch);
}
