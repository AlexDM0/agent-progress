/**
 * A versioned JSON document holding one object of entries keyed by id, read and updated so that every key it does not know, at the top
 * level and on each entry, survives in order. It depends on `src/lib/json-record`.
 */
import { JsonRecordUtil } from '../json-record/JsonRecordUtil.ts';

export interface RegistryShape {
  supportedVersion: number;
  entriesKey:       string;
}

export type RegistryDocument = Record<string, unknown>;

export type RegistryEntry = Record<string, unknown>;

export type RegistryReading =
  | { verdict: 'readable'; document: RegistryDocument }
  | { verdict: 'newer-version'; version: number }
  /** The document holds what could still be read, ready to be written back over the malformed one. */
  | { verdict: 'malformed'; problems: string[]; document: RegistryDocument };

const VERSION_KEY = 'version';

const INDENTATION_SPACES = 2;

function emptyDocumentOf(shape: RegistryShape): RegistryDocument {
  return { [VERSION_KEY]: shape.supportedVersion, [shape.entriesKey]: {} };
}

function parsedValueOf(storedText: string): { parsed: unknown } | { problem: string } {
  try {
    return { parsed: JSON.parse(storedText) as unknown };
  } catch (error) {
    return { problem: `it is not JSON (${error instanceof Error ? error.message : String(error)})` };
  }
}

/** Every entry that is an object is readable; anything else under the entries key is dropped and named. */
function readableEntriesOf(entriesValue: unknown, shape: RegistryShape, problems: string[]): Record<string, RegistryEntry> {
  const entries = JsonRecordUtil.recordOf(entriesValue);
  if (entries === undefined) {
    if (entriesValue !== undefined) problems.push(`"${shape.entriesKey}" is not an object`);
    return {};
  }
  const readableEntries: Record<string, RegistryEntry> = {};
  for (const [entryKey, entryValue] of Object.entries(entries)) {
    const entry = JsonRecordUtil.recordOf(entryValue);
    if (entry === undefined) problems.push(`entry "${entryKey}" is not an object`);
    else readableEntries[entryKey] = entry;
  }
  return readableEntries;
}

/** `null` is a document that does not exist yet, read as an empty one of the supported version. */
function readingOf(storedText: string | null, shape: RegistryShape): RegistryReading {
  if (storedText === null) return { verdict: 'readable', document: emptyDocumentOf(shape) };
  const parsing = parsedValueOf(storedText);
  if ('problem' in parsing) return { verdict: 'malformed', problems: [parsing.problem], document: emptyDocumentOf(shape) };
  const parsedDocument = JsonRecordUtil.recordOf(parsing.parsed);
  if (parsedDocument === undefined) return { verdict: 'malformed', problems: ['it is not a JSON object'], document: emptyDocumentOf(shape) };

  const storedVersion = parsedDocument[VERSION_KEY];
  if (typeof storedVersion === 'number' && Number.isInteger(storedVersion) && storedVersion > shape.supportedVersion) {
    return { verdict: 'newer-version', version: storedVersion };
  }
  const problems: string[] = [];
  if (storedVersion !== shape.supportedVersion) problems.push(`"${VERSION_KEY}" is ${JSON.stringify(storedVersion) ?? 'missing'}`);
  const document: RegistryDocument = {
    ...parsedDocument,
    [VERSION_KEY]:      shape.supportedVersion,
    [shape.entriesKey]: readableEntriesOf(parsedDocument[shape.entriesKey], shape, problems),
  };
  return problems.length === 0 ? { verdict: 'readable', document } : { verdict: 'malformed', problems, document };
}

/** The entry under `entryKey` replaced by what `entryFor` makes of the stored one, keeping its place; a new key goes last. */
function documentWithEntry(
  document: RegistryDocument,
  shape: RegistryShape,
  entryKey: string,
  entryFor: (storedEntry: RegistryEntry | undefined) => RegistryEntry,
): RegistryDocument {
  const entries     = JsonRecordUtil.recordOf(document[shape.entriesKey]) ?? {};
  const storedEntry = Object.hasOwn(entries, entryKey) ? JsonRecordUtil.recordOf(entries[entryKey]) : undefined;
  return { ...document, [shape.entriesKey]: { ...entries, [entryKey]: entryFor(storedEntry) } };
}

function textOf(document: RegistryDocument): string {
  return `${JSON.stringify(document, null, INDENTATION_SPACES)}\n`;
}

export const VersionedRegistryUtil = { readingOf, documentWithEntry, textOf } as const;
