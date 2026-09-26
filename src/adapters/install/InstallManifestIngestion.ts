/** `.agent-progress/version.json` read into the install version it records: read, parse, validate. */
import { existsSync, readFileSync } from 'node:fs';

const LOWEST_INSTALL_VERSION = 1;

export type InstallManifestReading =
  | { verdict: 'readable'; installVersion: number }
  | { verdict: 'absent' }
  | { verdict: 'unreadable'; reason: string };

function installVersionIsValid(installVersion: unknown): installVersion is number {
  return typeof installVersion === 'number' && Number.isSafeInteger(installVersion) && installVersion >= LOWEST_INSTALL_VERSION;
}

function installVersionProblemOf(installVersion: unknown): string {
  const valueAsWritten = installVersion === undefined ? 'missing' : JSON.stringify(installVersion);
  return `installVersion is ${valueAsWritten}, and it has to be a whole number of at least ${LOWEST_INSTALL_VERSION}`;
}

export class InstallManifestIngestion {
  constructor(private readonly manifestFilePath: string) {}

  /**
   * Never throws: an unreadable manifest comes back as a verdict whose reason names the offending field. A file that exists but cannot be
   * read is `unreadable`, never `absent`, because `absent` is the answer a tracker from before the manifest gives.
   */
  read(): InstallManifestReading {
    let rawText: string;
    try {
      rawText = readFileSync(this.manifestFilePath, 'utf8');
    } catch (error) {
      if (!existsSync(this.manifestFilePath)) return { verdict: 'absent' };
      return { verdict: 'unreadable', reason: `it could not be read (${error instanceof Error ? error.message : 'unknown error'})` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      return { verdict: 'unreadable', reason: `it is not valid JSON (${error instanceof Error ? error.message : 'unparseable'})` };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { verdict: 'unreadable', reason: 'it is not a JSON object' };

    const installVersion = Object.hasOwn(parsed, 'installVersion') ? (parsed as Record<string, unknown>)['installVersion'] : undefined;
    if (!installVersionIsValid(installVersion)) return { verdict: 'unreadable', reason: installVersionProblemOf(installVersion) };
    return { verdict: 'readable', installVersion };
  }
}
