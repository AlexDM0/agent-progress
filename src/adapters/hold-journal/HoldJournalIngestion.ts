/** `hold-journal.json`, the redo record of one tracker write, read into absolute file paths: read, validate, map. */
import { isAbsolute, join } from 'node:path';

import { storedFileTextOf } from '../StoredFileText.ts';
import { StoredValueUtil }  from '../utils/StoredValueUtil.ts';

/** One file a hold writes or removes, its path absolute. */
export type JournaledFile = { kind: 'written'; filePath: string; contents: string } | { kind: 'removed'; filePath: string };

export type HoldJournalReading =
  | { verdict: 'absent' }
  | { verdict: 'readable'; files: JournaledFile[] }
  | { verdict: 'malformed'; reason: string };

export const HOLD_JOURNAL_FORMAT_VERSION = 1;

const PATH_SEPARATOR = '/';

const UNSAFE_PATH_SEGMENTS = new Set(['', '.', '..']);

/** A stored path is relative to the data folder and never leaves it, so a hand-edited journal cannot replay a write anywhere else. */
function pathStaysInsideTheDataFolder(storedPath: string): boolean {
  if (isAbsolute(storedPath) || storedPath.includes('\\')) return false;
  return storedPath.split(PATH_SEPARATOR).every((segment) => !UNSAFE_PATH_SEGMENTS.has(segment));
}

type StoredEntryReading = { verdict: 'readable'; file: JournaledFile } | { verdict: 'malformed'; reason: string };

function storedEntryReadingOf(entry: unknown, index: number, dataDirectory: string): StoredEntryReading {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return { verdict: 'malformed', reason: `files[${index}] is not an object` };
  const { path, contents, removed } = entry as { path?: unknown; contents?: unknown; removed?: unknown };
  if (typeof path !== 'string' || !pathStaysInsideTheDataFolder(path)) {
    return { verdict: 'malformed', reason: `files[${index}].path is not a path inside the data folder` };
  }
  const filePath = join(dataDirectory, path);
  if (removed === true && contents === undefined) return { verdict: 'readable', file: { kind: 'removed', filePath } };
  if (typeof contents === 'string' && removed === undefined) return { verdict: 'readable', file: { kind: 'written', filePath, contents } };
  return { verdict: 'malformed', reason: `files[${index}] holds neither a string "contents" nor "removed": true` };
}

export class HoldJournalIngestion {
  constructor(private readonly journalFilePath: string, private readonly dataDirectory: string) {}

  /** Never throws: a journal that cannot be read, parsed or trusted whole is `malformed`, and none of its files is handed out. */
  read(): HoldJournalReading {
    const storedText = storedFileTextOf(this.journalFilePath);
    if (storedText.verdict === 'absent') return storedText;
    if (storedText.verdict === 'unreadable') return { verdict: 'malformed', reason: storedText.reason };

    const parsedJson = StoredValueUtil.parsedJsonOf(storedText.text);
    if (parsedJson.verdict === 'unparseable') return { verdict: 'malformed', reason: parsedJson.problem };
    const document = parsedJson.value as { version?: unknown; files?: unknown } | null;
    if (typeof document !== 'object' || document === null || Array.isArray(document)) return { verdict: 'malformed', reason: 'it is not a JSON object' };
    if (document.version !== HOLD_JOURNAL_FORMAT_VERSION) return { verdict: 'malformed', reason: `its version is not ${HOLD_JOURNAL_FORMAT_VERSION}` };
    if (!Array.isArray(document.files)) return { verdict: 'malformed', reason: 'its "files" is not a list' };

    const files: JournaledFile[] = [];
    for (const [index, entry] of (document.files as unknown[]).entries()) {
      const entryReading = storedEntryReadingOf(entry, index, this.dataDirectory);
      if (entryReading.verdict === 'malformed') return entryReading;
      files.push(entryReading.file);
    }
    return { verdict: 'readable', files };
  }
}
