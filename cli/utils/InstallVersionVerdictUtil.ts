import type { InstallManifestReading } from '../../src/adapters/install/InstallManifestIngestion.ts';
import type { InstallVersionMismatch } from '../../src/shared/@types/InstallVersionMismatch.ts';

export type InstallVersionVerdict =
  | { verdict: 'current' }
  | { verdict: 'mismatch'; mismatch: InstallVersionMismatch };

/**
 * A missing manifest is a mismatch only while the tool's files are installed: they are then from before versioning. With nothing installed
 * nothing can disagree with the running CLI. An unreadable manifest fails closed.
 */
function verdictOf(reading: InstallManifestReading, installedFilesArePresent: boolean, installVersion: number): InstallVersionVerdict {
  switch (reading.verdict) {
    case 'absent':
      return installedFilesArePresent ? { verdict: 'mismatch', mismatch: { reason: 'unversioned' } } : { verdict: 'current' };
    case 'unreadable':
      return { verdict: 'mismatch', mismatch: { reason: 'unreadable', manifestProblem: reading.reason } };
    case 'directory':
      return { verdict: 'mismatch', mismatch: { reason: 'manifest-is-a-directory' } };
    case 'readable':
      if (reading.installVersion === installVersion) return { verdict: 'current' };
      return {
        verdict:  'mismatch',
        mismatch: { reason: reading.installVersion < installVersion ? 'older' : 'newer', installedVersion: reading.installVersion },
      };
  }
}

export const InstallVersionVerdictUtil = { verdictOf } as const;
