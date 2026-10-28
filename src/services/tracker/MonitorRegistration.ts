/**
 * Records a tracker whose page this call wrote in the machine-wide registry `~/.agent-progress-monitor/projects.json`, which a monitor
 * reads to find every project's page and data. It never fails the command: every way it does not register comes back as a verdict.
 */
import { mkdirSync, realpathSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve
} from 'node:path';

import { storedFileTextOf }                                              from '../../adapters/StoredFileText.ts';
import { ProgressFileIngestion }                                         from '../../adapters/progress/ProgressFileIngestion.ts';
import { writeFileAtomically }                                           from '../../lib/atomic-file/AtomicFile.ts';
import { GitProcess }                                                    from '../../lib/git/GitProcess.ts';
import { LocalTimeUtil }                                                 from '../../lib/local-time/LocalTimeUtil.ts';
import { VersionedRegistryUtil, type RegistryEntry, type RegistryShape } from '../../lib/versioned-registry/VersionedRegistryUtil.ts';
import { refusalIsOperationRefusal }                                     from '../../shared/OperationRefusal.ts';
import { withLockAt }                                                    from './TrackerLock.ts';
import type { Workspace }                                                from './Workspace.ts';
import { MONITOR_REGISTRY_FILES }                                        from './constants/MonitorRegistryFiles.ts';

export interface MonitorRegistrationRequest {
  workspace:            Workspace;
  homeDirectory:        string;
  /** Every temp folder of the machine: a tracker under any of them is a scratch one nobody monitors. */
  temporaryDirectories: readonly string[];
  /** The verb that wrote the page, such as `ticket finish`. */
  command:              string;
  now:                  () => Date;
  /** The live runner, written at its start; `removed` at its stop; absent, a stored runner key is kept as it was. */
  runner?:              RunnerRegistration | 'removed';
}

export interface RunnerRegistration {
  url:       string;
  processId: number;
  startedAt: string;
}

export type MonitorRegistrationOutcome =
  | { verdict: 'registered'; registryFilePath: string }
  | { verdict: 'registered-over-malformed'; registryFilePath: string; problems: string[] }
  | { verdict: 'not-registered-temporary-tracker' }
  | { verdict: 'not-registered-unreadable-tracker'; reason: string }
  | { verdict: 'not-registered-newer-version'; registryFilePath: string; version: number }
  | { verdict: 'not-registered-unwritable'; registryFilePath: string; reason: string };

const REGISTRY_SHAPE: RegistryShape = { supportedVersion: MONITOR_REGISTRY_FILES.SUPPORTED_VERSION, entriesKey: MONITOR_REGISTRY_FILES.ENTRIES_KEY };

const REGISTERED_AT_KEY = 'registeredAt';
const RUNNER_KEY        = 'runner';

/** A path that does not exist is resolved through its nearest existing ancestor, so `/tmp/missing` still reads as under `/private/tmp`. */
function canonicalPathOf(path: string): string {
  const absolutePath = resolve(path);
  try {
    return realpathSync(absolutePath);
  } catch {
    const parentDirectory = dirname(absolutePath);
    return parentDirectory === absolutePath ? absolutePath : join(canonicalPathOf(parentDirectory), basename(absolutePath));
  }
}

function trackerLiesInATemporaryFolder(rootDirectory: string, temporaryDirectories: readonly string[]): boolean {
  const canonicalRoot = canonicalPathOf(rootDirectory);
  return temporaryDirectories.some((temporaryDirectory) => {
    const pathFromTemporaryFolder = relative(canonicalPathOf(temporaryDirectory), canonicalRoot);
    return !pathFromTemporaryFolder.startsWith('..') && !isAbsolute(pathFromTemporaryFolder);
  });
}

/** `null` when the repository has no `origin` remote, or git cannot say. */
function gitOriginOf(rootDirectory: string): string | null {
  const finishedRun = GitProcess.run(rootDirectory, ['remote', 'get-url', 'origin']);
  if (finishedRun === null || finishedRun.exitCode !== 0) return null;
  const origin = finishedRun.standardOutput.trim();
  return origin.length > 0 ? origin : null;
}

function errorReasonOf(error: unknown): string {
  if (refusalIsOperationRefusal(error)) return 'its lock is held by another process';
  return error instanceof Error ? error.message : String(error);
}

interface Registration {
  registryFilePath: string;
  trackerId:        string;
  /** What this write says about the tracker's place, all replaced on every write, so a moved tracker's one entry follows it. */
  locationFields:   RegistryEntry;
  changedAt:        string;
  command:          string;
  runner?:          RunnerRegistration | 'removed';
}

/** Keeps the stored entry's keys, unknown ones included, in order, and its first `registeredAt`. */
function updatedEntry(storedEntry: RegistryEntry | undefined, registration: Registration): RegistryEntry {
  const storedRegisteredAt = storedEntry?.[REGISTERED_AT_KEY];
  const entry: RegistryEntry = {
    ...storedEntry,
    ...registration.locationFields,
    [REGISTERED_AT_KEY]: typeof storedRegisteredAt === 'string' ? storedRegisteredAt : registration.changedAt,
    lastChangedAt:       registration.changedAt,
    lastCommand:         registration.command,
  };
  if (registration.runner === 'removed') delete entry[RUNNER_KEY];
  else if (registration.runner !== undefined) entry[RUNNER_KEY] = { ...registration.runner };
  return entry;
}

function registerUnderTheLock(registration: Registration): MonitorRegistrationOutcome {
  const { registryFilePath, trackerId } = registration;
  const storedText = storedFileTextOf(registryFilePath);
  if (storedText.verdict === 'unreadable') return { verdict: 'not-registered-unwritable', registryFilePath, reason: storedText.reason };
  const reading = VersionedRegistryUtil.readingOf(storedText.verdict === 'readable' ? storedText.text : null, REGISTRY_SHAPE);
  if (reading.verdict === 'newer-version') return { verdict: 'not-registered-newer-version', registryFilePath, version: reading.version };

  const document = VersionedRegistryUtil.documentWithEntry(reading.document, REGISTRY_SHAPE, trackerId, (storedEntry) => updatedEntry(storedEntry, registration));
  writeFileAtomically(registryFilePath, VersionedRegistryUtil.textOf(document));
  return reading.verdict === 'malformed'
    ? { verdict: 'registered-over-malformed', registryFilePath, problems: reading.problems }
    : { verdict: 'registered', registryFilePath };
}

export async function registerWithTheMonitor(request: MonitorRegistrationRequest): Promise<MonitorRegistrationOutcome> {
  const {
    workspace, homeDirectory, temporaryDirectories, command, now, runner
  } = request;
  if (trackerLiesInATemporaryFolder(workspace.rootDirectory, temporaryDirectories)) return { verdict: 'not-registered-temporary-tracker' };
  const progressReading = new ProgressFileIngestion(workspace.progressFilePath).read();
  if (progressReading.verdict === 'absent') return { verdict: 'not-registered-unreadable-tracker', reason: 'its progress file is absent' };
  if (progressReading.verdict === 'unreadable') return { verdict: 'not-registered-unreadable-tracker', reason: progressReading.reason };

  const registryDirectory = join(homeDirectory, MONITOR_REGISTRY_FILES.REGISTRY_DIRECTORY_NAME);
  const registryFilePath  = join(registryDirectory, MONITOR_REGISTRY_FILES.REGISTRY_FILE_NAME);
  const registration: Registration = {
    registryFilePath,
    trackerId:      progressReading.progress.trackerId,
    locationFields: {
      project:      progressReading.progress.project,
      root:         workspace.rootDirectory,
      progressHtml: workspace.htmlFilePath,
      progressJson: workspace.progressFilePath,
      gitOrigin:    gitOriginOf(workspace.rootDirectory),
    },
    changedAt: LocalTimeUtil.formatLocalIso(now()),
    command,
    ...(runner === undefined ? {} : { runner }),
  };
  try {
    // Made before the lock, which would otherwise read a home it cannot write as a lock held until its retries ran out.
    mkdirSync(registryDirectory, { recursive: true });
    return await withLockAt(join(registryDirectory, MONITOR_REGISTRY_FILES.LOCK_DIRECTORY_NAME), () => registerUnderTheLock(registration), now);
  } catch (error) {
    return { verdict: 'not-registered-unwritable', registryFilePath, reason: errorReasonOf(error) };
  }
}
