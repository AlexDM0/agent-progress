/**
 * The token substitution the page render relies on: each token replaced once and everything else kept byte for byte, a token that is gone or
 * doubled refused as unrepaired naming the template path it was given, every token split on though its spelling holds regular expression
 * characters, only the given token set split on, and nothing injected searched again. The real `resources/spec-template.html` holds each
 * of its tokens once, and a token planted there a second time is refused naming that template.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

import { refusalIsOperationRefusal }                                      from '../../shared/OperationRefusal.ts';
import { resourceFilePathOf }                                             from '../../shared/ResourceFilePath.ts';
import { substituteTemplateTokens, type TemplateDescription }             from './TemplateTokenSubstitution.ts';
import { SPEC_TEMPLATE_FILE_NAME, SPEC_TEMPLATE_TOKENS, TEMPLATE_TOKENS } from './constants/TemplateFile.ts';

const TRACKER_TEMPLATE: TemplateDescription = { templateFilePath: 'resources/template.html', tokens: Object.values(TEMPLATE_TOKENS) };
const SPEC_TEMPLATE: TemplateDescription    = { templateFilePath: `resources/${SPEC_TEMPLATE_FILE_NAME}`, tokens: Object.values(SPEC_TEMPLATE_TOKENS) };
const EXAMPLE_TEMPLATE: TemplateDescription = { templateFilePath: 'resources/example-template.html', tokens: ['__PROGRESS__', '__TICKETS__'] };

describe('substituteTemplateTokens', () => {
  const values = { '__PROGRESS__': '{}', '__TICKETS__': '[]' };

  test('substitutes each token once and leaves the rest of the template byte for byte', () => {
    expect(substituteTemplateTokens('a __PROGRESS__ b __TICKETS__ c', TRACKER_TEMPLATE, values)).toBe('a {} b [] c');
  });

  test('replaces the title element and the page script token too', () => {
    const template = '<head><title>agent-progress</title></head><script>__PAGE_SCRIPT__</script>';
    const filled   = substituteTemplateTokens(
      template,
      TRACKER_TEMPLATE,
      { '<title>agent-progress</title>': '<title>Example Agency progress</title>', '__PAGE_SCRIPT__': 'run();' },
    );

    expect(filled).toBe('<head><title>Example Agency progress</title></head><script>run();</script>');
  });

  test.each([
    ['a token that is gone', 'a __PROGRESS__ b', 0],
    ['a token that occurs twice', 'a __PROGRESS__ b __TICKETS__ c __TICKETS__', 2],
  ])('refuses %s as unrepaired, carrying the token and how often it occurs', (_description, template, occurrenceCount) => {
    let caught: unknown = null;
    try {
      substituteTemplateTokens(template, EXAMPLE_TEMPLATE, values);
    } catch (failure) {
      caught = failure;
    }

    expect(refusalIsOperationRefusal(caught) ? caught.status : null).toBe('unrepaired');
    expect(refusalIsOperationRefusal(caught) ? caught.detail : null).toEqual({
      kind:             'template-token-not-unique',
      templateFilePath: 'resources/example-template.html',
      token:            '__TICKETS__',
      occurrenceCount,
    });
  });

  test('does not find a token inside the text it just injected', () => {
    const injected = { '__PROGRESS__': '__TICKETS__', '__TICKETS__': 'second' };

    expect(substituteTemplateTokens('__PROGRESS__ / __TICKETS__', TRACKER_TEMPLATE, injected)).toBe('__TICKETS__ / second');
  });

  test('splits only on the token set it was given, so another template’s tokens are left as text', () => {
    const specTemplate: TemplateDescription = { templateFilePath: 'resources/spec-template.html', tokens: ['__SPEC__'] };

    expect(substituteTemplateTokens('__SPEC__ beside __TICKETS__', specTemplate, { '__SPEC__': '{}' })).toBe('{} beside __TICKETS__');
  });
});

describe('the spec template on disk', () => {
  const specTemplateText = readFileSync(resourceFilePathOf(SPEC_TEMPLATE_FILE_NAME), 'utf8');
  const specValues       = Object.fromEntries(Object.values(SPEC_TEMPLATE_TOKENS).map((token) => [token, `<filled ${token.length}>`]));

  test('holds each spec token exactly once, so the substitution fills every one', () => {
    const filled = substituteTemplateTokens(specTemplateText, SPEC_TEMPLATE, specValues);

    expect(Object.values(SPEC_TEMPLATE_TOKENS).filter((token) => filled.includes(token))).toEqual([]);
  });

  test('with a token planted a second time, is refused naming the spec template and that token', () => {
    const doubled = specTemplateText.replace('</body>', `${SPEC_TEMPLATE_TOKENS.SPEC}\n</body>`);
    let caught: unknown = null;
    try {
      substituteTemplateTokens(doubled, SPEC_TEMPLATE, specValues);
    } catch (failure) {
      caught = failure;
    }

    expect(refusalIsOperationRefusal(caught) ? caught.detail : null).toEqual({
      kind:             'template-token-not-unique',
      templateFilePath: `resources/${SPEC_TEMPLATE_FILE_NAME}`,
      token:            SPEC_TEMPLATE_TOKENS.SPEC,
      occurrenceCount:  2,
    });
  });
});
