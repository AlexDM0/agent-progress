/**
 * How the Overseer notices an update, design section 7.3: its code and install version in memory against the code on disk, learned by
 * running the on-disk binary's `version --json` at each sweep and after each landing, and against the manifest, read on every look.
 * An install change holds launches until a Baton pass brings matching code; new code alone is only shown. The Overseer never restarts itself.
 */
export interface ProgramVersions {
  codeVersion:    string;
  installVersion: number;
}

export interface InstallChangeWatchRequest {
  inMemory:        ProgramVersions;
  /** The on-disk binary's own answer; `null` when it did not give one, which changes nothing the watch last learned. */
  versionsOnDisk:  () => ProgramVersions | null;
  manifestMatches: () => boolean;
  /** Moves when a landing moves the main line, such as its tip; the on-disk binary is asked again once it does. */
  landingMark:     () => string | null;
}

export interface InstallChangeWatch {
  /** The next look asks the on-disk binary again. */
  noteSweep:             () => void;
  installVersionChanged: () => boolean;
  /** Code on disk differs while its install version does not: shown as "new code", holding nothing. */
  newCodeOnDisk:         () => boolean;
}

const VERSION_ARGUMENTS = ['version', '--json'];

/** Runs `<program> version --json` as a child: the code on disk answers for itself, whatever this process loaded. */
export function versionsFromTheBinary(programCommand: readonly string[], workingDirectory: string): ProgramVersions | null {
  if (programCommand.length === 0) return null;
  try {
    const child = Bun.spawnSync([...programCommand, ...VERSION_ARGUMENTS], {
      cwd: workingDirectory, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore'
    });
    if (child.exitCode !== 0) return null;
    const parsed = JSON.parse(child.stdout.toString()) as Partial<Record<keyof ProgramVersions, unknown>>;
    return typeof parsed.codeVersion === 'string' && typeof parsed.installVersion === 'number'
      ? { codeVersion: parsed.codeVersion, installVersion: parsed.installVersion }
      : null;
  } catch {
    return null;
  }
}

export function createInstallChangeWatch(request: InstallChangeWatchRequest): InstallChangeWatch {
  let learned: ProgramVersions | null = null;
  let askAgain = true;
  let lastLandingMark: string | null = null;

  function onDisk(): ProgramVersions | null {
    const landingMark = request.landingMark();
    if (askAgain || landingMark !== lastLandingMark) {
      askAgain        = false;
      lastLandingMark = landingMark;
      learned         = request.versionsOnDisk() ?? learned;
    }
    return learned;
  }

  function installVersionChanged(): boolean {
    const versions = onDisk();
    return !request.manifestMatches() || (versions !== null && versions.installVersion !== request.inMemory.installVersion);
  }

  return {
    noteSweep:     () => { askAgain = true; },
    installVersionChanged,
    newCodeOnDisk: () => {
      const versions = onDisk();
      return !installVersionChanged() && versions !== null && versions.codeVersion !== request.inMemory.codeVersion;
    },
  };
}
