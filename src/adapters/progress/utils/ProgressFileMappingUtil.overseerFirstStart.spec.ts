/**
 * The Overseer's first start in progress.json. What matters: the key is written only once set, so a file without it stays byte-identical;
 * a file with it round-trips byte for byte; and a value that is not text makes the file unreadable.
 */
import { expect, test } from 'bun:test';

import { JsonTextUtil }               from '../../../shared/utils/JsonTextUtil.ts';
import { emptyProgress }              from '../../../testing/ProgressFixtures.ts';
import { ProgressFileMappingUtil }    from './ProgressFileMappingUtil.ts';
import { ProgressFileValidationUtil } from './ProgressFileValidationUtil.ts';

const FIRST_STARTED_AT = '2026-10-28T10:15:00+01:00';

function storedTextWithFirstStart(firstStartedAt: unknown): string {
  const progress = emptyProgress();
  return JsonTextUtil.storedFileTextOf({
    version:                2,
    trackerId:              progress.trackerId,
    project:                progress.project,
    startedAt:              progress.startedAt,
    view:                   progress.view,
    nextTaskId:             progress.nextTaskId,
    overseerFirstStartedAt: firstStartedAt,
    tasks:                  [],
  });
}

function roundTripOf(text: string): string {
  const reading = ProgressFileValidationUtil.readingOf(JSON.parse(text));
  if (reading.verdict === 'unreadable') throw new Error(reading.reason);
  const { document } = reading;
  return JsonTextUtil.storedFileTextOf(ProgressFileMappingUtil.storedDocumentOf(ProgressFileMappingUtil.progressOf(document)));
}

test('a file holding the first Overseer start is written back byte for byte', () => {
  const text = storedTextWithFirstStart(FIRST_STARTED_AT);
  expect(roundTripOf(text)).toBe(text);
});

test('a file without the first Overseer start stores none', () => {
  const text = JsonTextUtil.storedFileTextOf(ProgressFileMappingUtil.storedDocumentOf(emptyProgress()));
  expect(roundTripOf(text)).toBe(text);
  expect(text).not.toContain('overseerFirstStartedAt');
});

test('a first Overseer start that is not text makes the file unreadable', () => {
  expect(ProgressFileValidationUtil.readingOf(JSON.parse(storedTextWithFirstStart(1)))).toMatchObject({ verdict: 'unreadable' });
});
