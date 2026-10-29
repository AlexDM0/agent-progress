/** The install version check: every command but `init`, `update`, `help` and `status` refuses while the installed files are of another version. */
import { lstatSync } from 'node:fs';

import { InstallManifestIngestion }    from '../src/adapters/install/InstallManifestIngestion.ts';
import { findWorkspace }               from '../src/services/tracker/Workspace.ts';
import type { InstallVersionMismatch } from '../src/shared/@types/InstallVersionMismatch.ts';
import { OperationRefusal }            from '../src/shared/OperationRefusal.ts';
import type { InstallVersionVerdict }  from './InstallVersionVerdict.ts';
import { installVersionVerdictOf }     from './InstallVersionVerdict.ts';
import { installedFilePathsIn }        from './InstalledFiles.ts';
import { retiredInstalledFilePathsIn } from './adoption/constants/RetiredClaudeInstall.ts';
import { INSTALL_VERSION }             from './constants/InstallVersion.ts';

/** Fails closed: only ENOENT is absence. */
function fileIsPresent(filePath: string): boolean {
  try {
    lstatSync(filePath);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ENOENT');
  }
}

/**
 * The session instructions have no opt-out, every `init` and `update` writes them and a fresh `init` writes them first, so they stand
 * for the installed set; a board installed before version 17 has `agent-brief.md` instead.
 */
function installedFilesArePresentIn(rootDirectory: string): boolean {
  return fileIsPresent(installedFilePathsIn(rootDirectory).sessionInstructions) || fileIsPresent(retiredInstalledFilePathsIn(rootDirectory).agentBrief);
}

function installVersionVerdictIn(rootDirectory: string): InstallVersionVerdict {
  const reading = new InstallManifestIngestion(installedFilePathsIn(rootDirectory).installManifest).read();
  return installVersionVerdictOf(reading, installedFilesArePresentIn(rootDirectory), INSTALL_VERSION);
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
export function requireInstallManifestThisVersionCanReplace(rootDirectory: string): void {
  const verdict = installVersionVerdictIn(rootDirectory);
  const refusesToInstall = verdict.verdict === 'mismatch' && (verdict.mismatch.reason === 'newer' || verdict.mismatch.reason === 'manifest-is-a-directory');
  if (refusesToInstall) throw installVersionMismatchRefusal(rootDirectory, verdict.mismatch);
}
