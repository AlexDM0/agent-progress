/**
 * What the manifest reader answers. The cases that matter: an absent file, which a tracker from before the manifest gives and which must
 * never be confused with a file that exists but cannot be read; every way the stored version can be wrong, each named in the reason; and
 * a path that is a directory, which exists and so reads as a directory, never as absent.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';

import { afterAll, expect, test } from 'bun:test';

import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { InstallManifestIngestion }                       from './InstallManifestIngestion.ts';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchManifestFilePath(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return join(directory, 'version.json');
}

function readingOfText(prefix: string, manifestText: string): ReturnType<InstallManifestIngestion['read']> {
  const manifestFilePath = scratchManifestFilePath(prefix);
  writeFileSync(manifestFilePath, manifestText);
  return new InstallManifestIngestion(manifestFilePath).read();
}

test('a manifest that is not there reads as absent', () => {
  expect(new InstallManifestIngestion(scratchManifestFilePath('manifest-absent')).read()).toEqual({ verdict: 'absent' });
});

test('a manifest holding a whole install version reads as that version, and a key beside it is ignored', () => {
  expect(readingOfText('manifest-readable', '{\n  "installVersion": 3,\n  "note": "Example Agency"\n}\n')).toEqual({ verdict: 'readable', installVersion: 3 });
});

test('a manifest that is not JSON is unreadable, and the reason says so', () => {
  const reading = readingOfText('manifest-not-json', '{ "installVersion": ');
  expect(reading.verdict).toBe('unreadable');
  expect(reading.verdict === 'unreadable' ? reading.reason : '').toStartWith('it is not valid JSON (');
});

test('a manifest that is JSON but not an object is unreadable', () => {
  for (const manifestText of ['[1]', '1', 'null', '"installVersion"']) {
    expect(readingOfText('manifest-not-an-object', manifestText), manifestText).toEqual({ verdict: 'unreadable', reason: 'it is not a JSON object' });
  }
});

test('a missing, fractional, zero or textual install version is unreadable, and the reason names the field and what it holds', () => {
  const expectedReasons: Array<[string, string]> = [
    ['{}', 'installVersion is missing, and it has to be a whole number of at least 1'],
    ['{ "installVersion": 1.5 }', 'installVersion is 1.5, and it has to be a whole number of at least 1'],
    ['{ "installVersion": 0 }', 'installVersion is 0, and it has to be a whole number of at least 1'],
    ['{ "installVersion": "x" }', 'installVersion is "x", and it has to be a whole number of at least 1'],
  ];
  for (const [manifestText, reason] of expectedReasons) {
    expect(readingOfText('manifest-bad-version', manifestText), manifestText).toEqual({ verdict: 'unreadable', reason });
  }
});

test('a directory at the manifest\'s path reads as a directory, never as absent', () => {
  const manifestFilePath = scratchManifestFilePath('manifest-directory');
  mkdirSync(manifestFilePath);
  expect(new InstallManifestIngestion(manifestFilePath).read()).toEqual({ verdict: 'directory' });
});
