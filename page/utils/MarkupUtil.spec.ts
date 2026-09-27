/**
 * The markup primitives every part of the page builds on. The cases that matter are the escaping, which happens here once and nowhere
 * else, and a shortened text carrying its full form as a title only when something was actually shortened.
 */

import { describe, expect, test }   from 'bun:test';
import { EXAMPLE_TIMESTAMP_SLICES } from '../testing/PageLimitsFixture.ts';
import { MarkupUtil }               from './MarkupUtil.ts';

const {
  attribute,
  percentText,
  shortenedText,
  shortenedTextMarkup,
  stampMarkup,
} = MarkupUtil;

const EXAMPLE_TODAY = '2026-09-18';

describe('attribute', () => {
  test('escapes the quotes, angle brackets and ampersands of its value', () => {
    expect(attribute('title', 'Alex "Example" <b> & co')).toBe('title="Alex &quot;Example&quot; &lt;b&gt; &amp; co"');
  });
});

describe('percentText', () => {
  test('prints a percentage with two decimals, rounding the rest', () => {
    expect(percentText(12.3456)).toBe('12.35%');
    expect(percentText(100)).toBe('100.00%');
  });
});

describe('shortenedText', () => {
  test('carries the full form as the title of a shortened text', () => {
    expect(shortenedText('21:56', '2026-09-18 21:56')).toEqual({ text: '21:56', title: '2026-09-18 21:56' });
  });

  test('carries no title when the text is already the full text', () => {
    expect(shortenedText('2025-12-31 23:48', '2025-12-31 23:48')).toEqual({ text: '2025-12-31 23:48', title: null });
  });
});

describe('shortenedTextMarkup', () => {
  test('leaves out the class and the title when neither is needed', () => {
    expect(shortenedTextMarkup('span', 'wip', 'wip')).toBe('<span>wip</span>');
  });

  test('writes the class and titles a shortened text with its full form', () => {
    expect(shortenedTextMarkup('span', '21:56', '2026-09-18 21:56', 'ap-ticket-dates'))
      .toBe('<span class="ap-ticket-dates" title="2026-09-18 21:56">21:56</span>');
  });

  test('escapes both the text and its title', () => {
    expect(shortenedTextMarkup('b', '<i>', '<i> & more')).toBe('<b title="&lt;i&gt; &amp; more">&lt;i&gt;</b>');
  });
});

describe('stampMarkup', () => {
  test('shows only the clock of a stamp from today, with the full stamp as the title', () => {
    expect(stampMarkup('time', '2026-09-18T21:56:00+02:00', EXAMPLE_TODAY, EXAMPLE_TIMESTAMP_SLICES)).toBe('<time title="2026-09-18 21:56">21:56</time>');
  });

  test('shows a stamp from another year in full, with no title', () => {
    expect(stampMarkup('span', '2025-12-31T23:48:00+01:00', EXAMPLE_TODAY, EXAMPLE_TIMESTAMP_SLICES)).toBe('<span>2025-12-31 23:48</span>');
  });
});
