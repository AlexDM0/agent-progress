/**
 * The section and fact shapes both dialog bodies are built from. What matters is that the title and the label are escaped, while the
 * body and the value element, already markup, pass through untouched.
 */

import { describe, expect, test } from 'bun:test';

import { DetailMarkupUtil } from './DetailMarkupUtil.ts';

const { sectionMarkup, factMarkup } = DetailMarkupUtil;

describe('sectionMarkup', () => {
  test('wraps the body in a section headed by the title', () => {
    expect(sectionMarkup('Timeline', '<p>body</p>'))
      .toBe('<section class="ap-detail-section"><h3 class="ap-detail-section-title">Timeline</h3><p>body</p></section>');
  });

  test('escapes the title and leaves the body markup as it was given', () => {
    expect(sectionMarkup('Review & <notes>', '<b>&amp;</b>'))
      .toBe('<section class="ap-detail-section"><h3 class="ap-detail-section-title">Review &amp; &lt;notes&gt;</h3><b>&amp;</b></section>');
  });
});

describe('factMarkup', () => {
  test('pairs a bold label with the value element', () => {
    expect(factMarkup('branch', '<span>feature/example</span>')).toBe('<div><b>branch</b><span>feature/example</span></div>');
  });

  test('escapes the label and leaves the value element as it was given', () => {
    expect(factMarkup('"waits" <on>', '<span title="x">&lt;</span>'))
      .toBe('<div><b>&quot;waits&quot; &lt;on&gt;</b><span title="x">&lt;</span></div>');
  });
});
