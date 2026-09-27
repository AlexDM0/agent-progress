/** `.agent-progress/version.json` read into the install version it records: read, parse, validate. */
import { storedFileTextOf } from '../StoredFileText.ts';
import { StoredValueUtil }  from '../utils/StoredValueUtil.ts';

const LOWEST_INSTALL_VERSION = 1;

export type InstallManifestReading =
  | { verdict: 'readable'; installVersion: number }
  | { verdict: 'absent' }
  | { verdict: 'unreadable'; reason: string };

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
