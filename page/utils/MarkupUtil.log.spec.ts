/**
 * The log's lines, newest first. The cases that matter are the order under `--at` backfills and same-second appends, a shown range keeping
 * the newest lines rather than the first appended and joining the next range exactly, each line's stamp judged against the viewer's day on
 * its own, and a line linking only the tickets the filter would keep it for.
 */

import { describe, expect, test }   from 'bun:test';
import type { IdentifiedLogEntry }  from '../../src/shared/@types/WordedLogEntry.ts';
import { EXAMPLE_TIMESTAMP_SLICES } from '../testing/PageLimitsFixture.ts';
import { MarkupUtil }               from './MarkupUtil.ts';

const { logItemsMarkup } = MarkupUtil;

/** The example board's own day: its stamps from the 18th print as a clock, the rest dated. */
const EXAMPLE_TODAY = '2026-09-18';

describe('logItemsMarkup', () => {
  const entries: IdentifiedLogEntry[] = [
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
    const markup = logItemsMarkup(sameSecond, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY, { shownRange: { start: 0, end: 2 } });
    const texts  = [...markup.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);

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
  test('keeps the newest entries when a range is given, newest first', () => {
    expect(timesIn(logItemsMarkup(entries, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY, { shownRange: { start: 0, end: 2 } }))).toEqual(['21:56', '21:21']);
  });

  // "Show 50 more" appends the next range to what is shown, so consecutive ranges must print exactly the whole list, nothing twice.
  test('prints consecutive ranges that join into the whole list, each line printed the same', () => {
    const withTheDayBefore = [...entries, { at: '2026-09-17T23:59:00+02:00', text: 'The day before' }];
    const first            = logItemsMarkup(withTheDayBefore, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY, { shownRange: { start: 0, end: 2 } });
    const rest             = logItemsMarkup(withTheDayBefore, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY, { shownRange: { start: 2, end: 4 } });
    const whole            = logItemsMarkup(withTheDayBefore, EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(timesIn(first)).toEqual(['21:56', '21:21']);
    expect(first + rest).toBe(whole);
  });

  test('escapes a log line that carries markup', () => {
    const markup = logItemsMarkup([{ at: '2026-09-18T20:36:00+02:00', text: '</script><b>x</b>' }], EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(markup).not.toContain('<b>');
    expect(markup).toContain('&lt;/script&gt;');
  });
});

describe('ticket links in log lines', () => {
  const boardTickets = new Set(['007', '455']);

  function linkedTicketsIn(entry: IdentifiedLogEntry): Array<string | undefined> {
    const markup = logItemsMarkup([entry], EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY, { linkedTicketIds: boardTickets });
    return [...markup.matchAll(/<a href="#ap-ticket-([0-9]+)" data-log-ticket-id="\1">#\1<\/a>/g)].map((match) => match[1]);
  }

  test('links the tickets a record\'s ids hold and leaves the rest of its sentence as text', () => {
    const entry = {
      at:        '2026-09-18T20:36:00+02:00',
      text:      'Review row #120 started: Review 1 #007 — <Example>',
      taskIds:   [120],
      ticketIds: ['007'],
    };
    const markup = logItemsMarkup([entry], EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY, { linkedTicketIds: boardTickets });

    expect(linkedTicketsIn(entry)).toEqual(['007']);
    expect(markup).toContain('<span>Review row #120 started: Review 1 <a href="#ap-ticket-007" data-log-ticket-id="007">#007</a> — &lt;Example&gt;</span>');
  });

  // A record's ids are its claim: a number it quotes from another ticket is not linked, as the filter would not keep it for that ticket.
  test('links no ticket a record merely quotes', () => {
    expect(linkedTicketsIn({
      at: '2026-09-18T20:36:00+02:00', text: 'Ticket #300 filed: follow-up to #455', taskIds: [], ticketIds: ['300'],
    })).toEqual([]);
  });

  test('links each board ticket a note names as a whole token, and no row or longer number', () => {
    expect(linkedTicketsIn({ at: '2026-09-18T20:36:00+02:00', text: 'Merged #455 and #007, not #4555 or task #455' })).toEqual(['455', '007']);
  });

  test('prints no link when no tickets are given to link', () => {
    const markup = logItemsMarkup([{
      at: '2026-09-18T20:36:00+02:00', text: 'Merged #455', ticketIds: ['455'], taskIds: []
    }], EXAMPLE_TIMESTAMP_SLICES, EXAMPLE_TODAY);

    expect(markup).not.toContain('<a ');
  });
});
