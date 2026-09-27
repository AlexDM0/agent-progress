/**
 * The install version check on real directories. What matters: no tracker and a tracker with nothing installed pass, so the commands' own
 * refusals and hand-made fixtures are unchanged; a brief without a manifest is a tracker from before versioning; an equal manifest passes,
 * a newer or unreadable one refuses with the mismatch as its detail; and the check `init` and `update` run refuses only a newer manifest and
 * a directory at the manifest's path, which they could not replace.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join }                                   from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                         from 'bun:test';
import { OperationRefusal }                               from '../src/shared/OperationRefusal.ts';
import { createScratchDirectory, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { requireCurrentInstall, requireNoNewerInstall }   from './InstallVersionCheck.ts';
import { installedFilePathsIn }                           from './InstalledFiles.ts';
import { INSTALL_VERSION }                                from './constants/InstallVersion.ts';

let rootDirectory = '';

// The walk resolves symbolic links, and the machine's temporary directory may sit behind one.
beforeEach(() => {
  rootDirectory = realpathSync(createScratchDirectory('install-version-check'));
});

afterEach(() => {
  removeScratchDirectory(rootDirectory);
});

function makeTracker(): void {
  mkdirSync(join(rootDirectory, '.agent-progress'));
  writeFileSync(join(rootDirectory, '.agent-progress', 'progress.json'), '{}\n');
}

function installBrief(): void {
  writeFileSync(installedFilePathsIn(rootDirectory).agentBrief, '# Example brief\n');
}

function writeManifest(text: string): void {
  writeFileSync(installedFilePathsIn(rootDirectory).installManifest, text);
}

function makeManifestADirectory(): void {
  mkdirSync(installedFilePathsIn(rootDirectory).installManifest);
}

function refusalOf(check: () => void): OperationRefusal | null {
  try {
    check();
  } catch (error) {
    if (error instanceof OperationRefusal) return error;
    throw error;
  }
  return null;
}

describe('requireCurrentInstall', () => {
  test('a directory no tracker governs passes, leaving the command its own no-tracker refusal', () => {
    expect(refusalOf(() => requireCurrentInstall(rootDirectory))).toBeNull();
  });

  test('a tracker with neither a brief nor a manifest passes, because nothing installed can disagree', () => {
    makeTracker();
    expect(refusalOf(() => requireCurrentInstall(rootDirectory))).toBeNull();
  });

  test('a brief without a manifest refuses as unversioned, naming the root and the manifest path', () => {
    makeTracker();
    installBrief();
    const refusal = refusalOf(() => requireCurrentInstall(rootDirectory));
    expect(refusal?.status).toBe('refused');
    expect(refusal?.detail).toEqual({
      kind:             'install-version-mismatch',
      rootDirectory,
      manifestFilePath: installedFilePathsIn(rootDirectory).installManifest,
      installVersion:   INSTALL_VERSION,
      mismatch:         { reason: 'unversioned' },
    });
  });

  test('a manifest recording this install version passes', () => {
    makeTracker();
    installBrief();
    writeManifest(`{ "installVersion": ${INSTALL_VERSION} }\n`);
    expect(refusalOf(() => requireCurrentInstall(rootDirectory))).toBeNull();
  });

  test('a manifest one version ahead refuses as newer, carrying the recorded version', () => {
    makeTracker();
    installBrief();
    writeManifest(`{ "installVersion": ${INSTALL_VERSION + 1} }\n`);
    const refusal = refusalOf(() => requireCurrentInstall(rootDirectory));
    expect(refusal?.detail).toMatchObject({ kind: 'install-version-mismatch', mismatch: { reason: 'newer', installedVersion: INSTALL_VERSION + 1 } });
  });

  test('a garbled manifest refuses as unreadable, carrying the ingestion\'s reason', () => {
    makeTracker();
    installBrief();
    writeManifest('not json at all');
    const refusal = refusalOf(() => requireCurrentInstall(rootDirectory));
    expect(refusal?.detail).toMatchObject({ kind: 'install-version-mismatch', mismatch: { reason: 'unreadable' } });
  });

  test('a directory at the manifest\'s path refuses as manifest-is-a-directory', () => {
    makeTracker();
    installBrief();
    makeManifestADirectory();
    const refusal = refusalOf(() => requireCurrentInstall(rootDirectory));
    expect(refusal?.status).toBe('refused');
    expect(refusal?.detail).toMatchObject({ kind: 'install-version-mismatch', mismatch: { reason: 'manifest-is-a-directory' } });
  });

  test('the tracker is found from a directory below its root, and the refusal names the root', () => {
    makeTracker();
    installBrief();
    const subdirectory = join(rootDirectory, 'example-subdirectory');
    mkdirSync(subdirectory);
    const refusal = refusalOf(() => requireCurrentInstall(subdirectory));
    expect(refusal?.detail).toMatchObject({ kind: 'install-version-mismatch', mismatch: { reason: 'unversioned' } });
  });
});

describe('requireNoNewerInstall', () => {
  test('passes a missing manifest, even with a brief installed, since update is what repairs it', () => {
    makeTracker();
    installBrief();
    expect(refusalOf(() => requireNoNewerInstall(rootDirectory))).toBeNull();
  });

  test('passes an unreadable manifest, since update rewrites it', () => {
    makeTracker();
    installBrief();
    writeManifest('not json at all');
    expect(refusalOf(() => requireNoNewerInstall(rootDirectory))).toBeNull();
  });

  test('passes a manifest recording this install version', () => {
    makeTracker();
    writeManifest(`{ "installVersion": ${INSTALL_VERSION} }\n`);
    expect(refusalOf(() => requireNoNewerInstall(rootDirectory))).toBeNull();
  });

  test('refuses a newer manifest with the same detail the other commands carry', () => {
    makeTracker();
    writeManifest(`{ "installVersion": ${INSTALL_VERSION + 1} }\n`);
    const refusal = refusalOf(() => requireNoNewerInstall(rootDirectory));
    expect(refusal?.status).toBe('refused');
    expect(refusal?.detail).toEqual({
      kind:             'install-version-mismatch',
      rootDirectory,
      manifestFilePath: installedFilePathsIn(rootDirectory).installManifest,
      installVersion:   INSTALL_VERSION,
      mismatch:         { reason: 'newer', installedVersion: INSTALL_VERSION + 1 },
    });
  });

  test('refuses a directory at the manifest\'s path before anything is written, since the final rename could not replace it', () => {
    makeTracker();
    installBrief();
    makeManifestADirectory();
    const refusal = refusalOf(() => requireNoNewerInstall(rootDirectory));
    expect(refusal?.status).toBe('refused');
    expect(refusal?.detail).toMatchObject({ kind: 'install-version-mismatch', mismatch: { reason: 'manifest-is-a-directory' } });
  });
});
