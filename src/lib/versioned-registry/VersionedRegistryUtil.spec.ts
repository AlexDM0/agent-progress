/**
 * The registry document's reading and update. What matters: a newer version is never read (so a caller leaves it alone), every key the
 * caller does not know survives in its place at the top level and on each entry, and a malformed document still yields every entry that is
 * an object, with the problems named, ready to be written back.
 */
import { describe, expect, test } from 'bun:test';

import { VersionedRegistryUtil, type RegistryShape } from './VersionedRegistryUtil.ts';

const SHAPE: RegistryShape = { supportedVersion: 1, entriesKey: 'projects' };

describe('reading', () => {
  test('no stored document reads as an empty one of the supported version', () => {
    expect(VersionedRegistryUtil.readingOf(null, SHAPE)).toEqual({ verdict: 'readable', document: { version: 1, projects: {} } });
  });

  test('a newer version is not read at all', () => {
    expect(VersionedRegistryUtil.readingOf('{"version":2,"projects":"anything"}', SHAPE)).toEqual({ verdict: 'newer-version', version: 2 });
  });

  test('text that is not JSON is malformed and leaves an empty document', () => {
    const reading = VersionedRegistryUtil.readingOf('{ not json', SHAPE);
    expect(reading.verdict).toBe('malformed');
    if (reading.verdict === 'malformed') {
      expect(reading.problems[0]).toStartWith('it is not JSON');
      expect(reading.document).toEqual({ version: 1, projects: {} });
    }
  });

  test('an array is malformed', () => {
    expect(VersionedRegistryUtil.readingOf('[]', SHAPE)).toEqual({ verdict: 'malformed', problems: ['it is not a JSON object'], document: { version: 1, projects: {} } });
  });

  test('an entry that is not an object is dropped and named, while every readable entry and unknown key stays', () => {
    const storedText = JSON.stringify({
      comment: 'kept', version: 1, projects: { first: { project: 'Example Agency' }, second: 'broken' }, tail: 3
    });
    expect(VersionedRegistryUtil.readingOf(storedText, SHAPE)).toEqual({
      verdict:  'malformed',
      problems: ['entry "second" is not an object'],
      document: {
        comment: 'kept', version: 1, projects: { first: { project: 'Example Agency' } }, tail: 3
      },
    });
  });

  test('a missing or older version and entries that are not an object are each named', () => {
    const reading = VersionedRegistryUtil.readingOf('{"projects":[]}', SHAPE);
    expect(reading).toEqual({ verdict: 'malformed', problems: ['"version" is missing', '"projects" is not an object'], document: { projects: {}, version: 1 } });
    const olderReading = VersionedRegistryUtil.readingOf('{"version":0,"projects":{}}', SHAPE);
    expect(olderReading).toEqual({ verdict: 'malformed', problems: ['"version" is 0'], document: { version: 1, projects: {} } });
  });

  test('a well-formed document is readable as stored', () => {
    const storedText = '{"version":1,"owner":"Alex Example","projects":{"first":{"project":"Example Agency","note":"kept"}}}';
    expect(VersionedRegistryUtil.readingOf(storedText, SHAPE)).toEqual({ verdict: 'readable', document: JSON.parse(storedText) as Record<string, unknown> });
  });
});

describe('updating an entry', () => {
  const document = {
    version: 1, owner: 'Alex Example', projects: { first: { project: 'Example Agency', note: 'kept' }, second: { project: 'Other' } }, tail: true
  };

  test('a stored entry is handed to the caller and keeps its place among the entries, the document its key order', () => {
    const handed: unknown[] = [];
    const updated = VersionedRegistryUtil.documentWithEntry(document, SHAPE, 'first', (storedEntry) => {
      handed.push(storedEntry);
      return { ...storedEntry, project: 'Renamed' };
    });
    expect(handed).toEqual([{ project: 'Example Agency', note: 'kept' }]);
    expect(VersionedRegistryUtil.textOf(updated)).toBe(`${JSON.stringify({
      version: 1, owner: 'Alex Example', projects: { first: { project: 'Renamed', note: 'kept' }, second: { project: 'Other' } }, tail: true
    }, null, 2)}\n`);
  });

  test('a new key goes last, handed no stored entry, and a key named like an Object prototype member is not mistaken for one', () => {
    const updated = VersionedRegistryUtil.documentWithEntry(document, SHAPE, 'constructor', (storedEntry) => ({ stored: storedEntry ?? null }));
    expect(Object.keys(updated['projects'] as object)).toEqual(['first', 'second', 'constructor']);
    expect((updated['projects'] as Record<string, unknown>)['constructor']).toEqual({ stored: null });
  });
});
