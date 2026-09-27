/**
 * The log's lines, newest first. The cases that matter are the order under `--at` backfills and same-second appends, the cap keeping the
 * newest lines rather than the first appended, and each line's stamp judged against the viewer's day on its own.
 */

import { describe, expect, test }   from 'bun:test';
import type { WordedLogEntry }      from '../../src/shared/@types/WordedLogEntry.ts';
import { EXAMPLE_TIMESTAMP_SLICES } from '../testing/PageLimitsFixture.ts';
import { MarkupUtil }               from './MarkupUtil.ts';

const { logItemsMarkup } = MarkupUtil;

/** The example board's own day: its stamps from the 18th print as a clock, the rest dated. */
const EXAMPLE_TODAY = '2026-09-18';

describe('logItemsMarkup', () => {
  const entries: WordedLogEntry[] = [
    { at: '2026-09-18T20:36:00+02:00', text: 'Tracker created' },
    { at: '2026-09-18T21:56:00+02:00', text: 'Subagent started' },
    { at: '2026-09-18T21:21:00+02:00', text: 'Old idea abandoned' },
  ];

  function timesIn(markup: string): Array<string | undefined> {
    return [...markup.matchAll(/<time(?: title="[^"]+")?>([^<]+)<\/time>/g)].map((match) => match[1]);
  }

  test('puts the newest entry first however the store appended them', () => {
    expect(timesIn(logItemsMarkup(entries, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY))).toEqual(['21:56', '21:21', '20:36']);
  });

  // Commands run in one second stamp their lines alike; under the cap the newer appends must win, or the card drops the latest lines.
  test('keeps the later append first among lines stamped in the same second', () => {
    const sameSecond = [
      { at: '2026-09-18T21:56:00+02:00', text: 'First append' },
      { at: '2026-09-18T21:56:00+02:00', text: 'Second append' },
      { at: '2026-09-18T21:56:00+02:00', text: 'Third append' },
    ];
    const texts = [...logItemsMarkup(sameSecond, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY, 2).matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);

    expect(texts).toEqual(['Third append', 'Second append']);
  });

  // Each line is judged on its own day against the viewer's, so a log that crosses midnight dates only the earlier day's lines, never today's.
  test('dates only the lines from another day, and gives every shortened line its full stamp as the title', () => {
    const withEarlierDays = [
      ...entries,
      { at: '2026-09-17T23:48:00+02:00', text: 'The day before' },
      { at: '2025-12-31T23:48:00+01:00', text: 'Last year' },
    ];
    const markup = logItemsMarkup(withEarlierDays, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(timesIn(markup)).toEqual(['21:56', '21:21', '20:36', '09-17 23:48', '2025-12-31 23:48']);
    expect(markup).toContain('<time title="2026-09-18 21:56">21:56</time>');
    expect(markup).toContain('<time title="2026-09-17 23:48">09-17 23:48</time>');
    expect(markup, 'a stamp shown in full needs no hover').toContain('<time>2025-12-31 23:48</time>');
  });

  // The card shows the newest ten of a long log; cutting before sorting would keep the oldest ten the store happened to append first.
  test('keeps the newest entries when a limit is given, newest first', () => {
    expect(timesIn(logItemsMarkup(entries, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY, 2))).toEqual(['21:56', '21:21']);
  });

  // Toggling the cap must not change a kept line's form: it depends on the line's own day and the viewer's, never on the rest of the log.
  test('prints a kept line the same under the cap as without it', () => {
    const withTheDayBefore = [...entries, { at: '2026-09-17T23:59:00+02:00', text: 'The day before' }];
    const capped           = logItemsMarkup(withTheDayBefore, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY, 2);
    const whole            = logItemsMarkup(withTheDayBefore, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(timesIn(capped)).toEqual(['21:56', '21:21']);
    expect(whole.startsWith(capped)).toBe(true);
  });

  test('renders exactly the markup of no limit when the limit is null', () => {
    expect(logItemsMarkup(entries, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY, null)).toBe(logItemsMarkup(entries, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY));
  });

  test('escapes a log line that carries markup', () => {
    const markup = logItemsMarkup([{ at: '2026-09-18T20:36:00+02:00', text: '</script><b>x</b>' }], EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(markup).not.toContain('<b>');
    expect(markup).toContain('&lt;/script&gt;');
  });
});
