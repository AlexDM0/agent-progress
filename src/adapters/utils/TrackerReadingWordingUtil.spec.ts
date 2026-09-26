/**
 * The refusal words for a tracker that cannot be read, pinned as literals: they are what `status`, every mutating command and the
 * hook's sentence have printed since before the reading became a verdict, and a script may match them. The log's text names no path of
 * its own, because the adapter's reason already starts with it.
 */
import { expect, test } from 'bun:test';

import { TrackerReadingWordingUtil } from './TrackerReadingWordingUtil';

test('an absent progress file is named by its path and said to be missing', () => {
  expect(TrackerReadingWordingUtil.refusalMessageOf({ verdict: 'absent', filePath: '/example/.agent-progress/progress.json' }))
    .toBe('/example/.agent-progress/progress.json cannot be read: it is not there');
});

test('an unreadable progress file is named by its path, followed by the adapter reason verbatim', () => {
  const reading = {
    verdict:        'unreadable',
    unreadableFile: 'progress-file',
    filePath:       '/example/.agent-progress/progress.json',
    reason:         'it is not valid JSON (Unexpected end of JSON input)',
  } as const;
  expect(TrackerReadingWordingUtil.refusalMessageOf(reading))
    .toBe('/example/.agent-progress/progress.json cannot be read: it is not valid JSON (Unexpected end of JSON input)');
});

test('an unreadable log is called the log, followed by the adapter reason verbatim', () => {
  const reading = {
    verdict:        'unreadable',
    unreadableFile: 'log-file',
    filePath:       '/example/.agent-progress/log.jsonl',
    reason:         '/example/.agent-progress/log.jsonl, line 1: fields.text is not a string',
  } as const;
  expect(TrackerReadingWordingUtil.refusalMessageOf(reading))
    .toBe('The log cannot be read: /example/.agent-progress/log.jsonl, line 1: fields.text is not a string');
});
