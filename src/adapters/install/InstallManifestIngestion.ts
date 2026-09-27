/** `.agent-progress/version.json` read into the install version it records: read, parse, validate. */
import { lstatSync } from 'node:fs';

import { storedFileTextOf } from '../StoredFileText.ts';
import { StoredValueUtil }  from '../utils/StoredValueUtil.ts';

const LOWEST_INSTALL_VERSION = 1;

export type InstallManifestReading =
  | { verdict: 'readable'; installVersion: number }
  | { verdict: 'absent' }
  | { verdict: 'directory' }
  | { verdict: 'unreadable'; reason: string };

function installVersionProblemOf(installVersion: unknown): string {
  const valueAsWritten = installVersion === undefined ? 'missing' : JSON.stringify(installVersion);
  return `installVersion is ${valueAsWritten}, and it has to be a whole number of at least ${LOWEST_INSTALL_VERSION}`;
}

/** Rename replaces any file or link at the manifest's path but fails on a directory, which `update` therefore cannot repair. */
function pathIsADirectory(filePath: string): boolean {
  try {
    return lstatSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

export class InstallManifestIngestion {
  constructor(private readonly manifestFilePath: string) {}

  /**
   * Never throws: an unreadable manifest comes back as a verdict whose reason names the offending field. A file that exists but cannot be
   * read is `unreadable`, and a directory at its path is `directory`, never `absent`, because `absent` is the answer a tracker from before
   * the manifest gives.
   */
  read(): InstallManifestReading {
    if (pathIsADirectory(this.manifestFilePath)) return { verdict: 'directory' };
    const storedText = storedFileTextOf(this.manifestFilePath);
    if (storedText.verdict !== 'readable') return storedText;

    const parsedJson = StoredValueUtil.parsedJsonOf(storedText.text);
    if (parsedJson.verdict === 'unparseable') return { verdict: 'unreadable', reason: parsedJson.problem };
    const parsed = parsedJson.value;
    if (!StoredValueUtil.valueIsAPlainObject(parsed)) return { verdict: 'unreadable', reason: 'it is not a JSON object' };

    const installVersion = Object.hasOwn(parsed, 'installVersion') ? parsed['installVersion'] : undefined;
    if (!StoredValueUtil.wholeNumberIsAtLeast(installVersion, LOWEST_INSTALL_VERSION)) return { verdict: 'unreadable', reason: installVersionProblemOf(installVersion) };
    return { verdict: 'readable', installVersion };
  }
}
