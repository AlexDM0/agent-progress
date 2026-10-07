/**
 * The design's styles taken from a template: the real `resources/template.html` gives its one style block's text without the tags, and a
 * template with no style element, two, or no closing tag is refused as unrepaired, naming the path it was given and the tag found wrongly.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

import { refusalIsOperationRefusal } from '../../shared/OperationRefusal.ts';
import { resourceFilePathOf }        from '../../shared/ResourceFilePath.ts';
import { designStylesOf }            from './DesignStyleExtraction.ts';

const EXAMPLE_TEMPLATE_PATH = 'resources/example-template.html';

function refusalDetailOf(templateText: string): unknown {
  try {
    designStylesOf(templateText, EXAMPLE_TEMPLATE_PATH);
  } catch (failure) {
    return refusalIsOperationRefusal(failure) && failure.status === 'unrepaired' ? failure.detail : failure;
  }
  return null;
}

describe('designStylesOf', () => {
  test('gives the text between the tracker template’s one <style> and </style>, holding its rules and neither tag', () => {
    const templateText = readFileSync(resourceFilePathOf('template.html'), 'utf8');
    const styles       = designStylesOf(templateText, 'resources/template.html');

    expect(styles).toContain('.ap-banner');
    expect(styles).not.toContain('<style>');
    expect(styles).not.toContain('</style>');
    expect(templateText).toContain(`<style>${styles}</style>`);
  });

  test.each([
    ['no style element', '<head></head>', '<style>', 0],
    ['two style elements', '<style>a{}</style><style>b{}</style>', '<style>', 2],
    ['a style element never closed', '<style>a{}', '</style>', 0],
  ])('refuses a template with %s, reusing the token refusal', (_description, templateText, token, occurrenceCount) => {
    expect(refusalDetailOf(templateText)).toEqual({
      kind: 'template-token-not-unique', templateFilePath: EXAMPLE_TEMPLATE_PATH, token, occurrenceCount
    });
  });
});
