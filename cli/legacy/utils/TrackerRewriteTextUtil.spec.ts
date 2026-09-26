/**
 * What `init` and `update` print after rewriting older tracker files, byte for byte: the progress file, with where its log went only when
 * the log moved, the ticket files counted in the singular or the plural, and both joined by ` and ` when a rewrite touched both.
 */
import { expect, test } from 'bun:test';

import { TrackerRewriteTextUtil } from './TrackerRewriteTextUtil';

const { rewrittenFilesTextOf } = TrackerRewriteTextUtil;

test('a rewrite of the progress file alone names it and where its log moved', () => {
  expect(rewrittenFilesTextOf({ progressFileWasRewritten: true, logWasMovedToItsOwnFile: true, rewrittenTicketCount: 0 }))
    .toBe('progress.json, with its log moved to log.jsonl');
});

test('a progress file whose rows alone were rewritten is named without a log', () => {
  expect(rewrittenFilesTextOf({ progressFileWasRewritten: true, logWasMovedToItsOwnFile: false, rewrittenTicketCount: 0 })).toBe('progress.json');
});

test('one rewritten ticket file is counted in the singular', () => {
  expect(rewrittenFilesTextOf({ progressFileWasRewritten: false, logWasMovedToItsOwnFile: false, rewrittenTicketCount: 1 })).toBe('1 ticket file');
});

test('several rewritten ticket files are counted in the plural', () => {
  expect(rewrittenFilesTextOf({ progressFileWasRewritten: false, logWasMovedToItsOwnFile: false, rewrittenTicketCount: 3 })).toBe('3 ticket files');
});

test('a rewrite of both joins them with and, the progress file first', () => {
  expect(rewrittenFilesTextOf({ progressFileWasRewritten: true, logWasMovedToItsOwnFile: true, rewrittenTicketCount: 3 }))
    .toBe('progress.json, with its log moved to log.jsonl and 3 ticket files');
  expect(rewrittenFilesTextOf({ progressFileWasRewritten: true, logWasMovedToItsOwnFile: false, rewrittenTicketCount: 1 }))
    .toBe('progress.json and 1 ticket file');
});
