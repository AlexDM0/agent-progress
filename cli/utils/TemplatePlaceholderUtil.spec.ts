/**
 * The filler behind the ticket body and the installed agent definition. What matters: every occurrence is filled, a value is never filled
 * in turn (a ticket title holding `{{id}}` stays literal), a name the values do not own is left as written, prototype names included, and
 * a template without placeholders is returned as it came.
 */
import { describe, expect, test } from 'bun:test';

import { TemplatePlaceholderUtil } from './TemplatePlaceholderUtil.ts';

const { filledTemplateOf } = TemplatePlaceholderUtil;

describe('TemplatePlaceholderUtil.filledTemplateOf', () => {
  test('a placeholder repeated three times is filled everywhere', () => {
    expect(filledTemplateOf('{{id}} and {{id}}, then {{id}}', { id: '007' })).toBe('007 and 007, then 007');
  });

  test('a value holding a placeholder stays literal', () => {
    expect(filledTemplateOf('# {{id}} — {{title}}', { id: '007', title: 'Rename {{id}} in the example' })).toBe('# 007 — Rename {{id}} in the example');
  });

  test('a placeholder the values do not name stays as written', () => {
    expect(filledTemplateOf('model: {{model}}, effort: {{effort}}', { model: 'opus' })).toBe('model: opus, effort: {{effort}}');
  });

  test('a placeholder naming a prototype property is not filled from the prototype', () => {
    expect(filledTemplateOf('{{constructor}} {{toString}}', {})).toBe('{{constructor}} {{toString}}');
  });

  test('a template without placeholders comes back unchanged', () => {
    const template = 'No placeholders here, only {braces} and a {{ spaced }} pair.\n';

    expect(filledTemplateOf(template, { id: '007' })).toBe(template);
  });
});
