/**
 * The token substitution the page render relies on: each token replaced once and everything else kept byte for byte, a token that is gone or
 * doubled refused as unrepaired naming the template path it was given, every token split on though its spelling holds regular expression
 * characters, only the given token set split on, and nothing injected searched again.
 */
import { describe, expect, test } from 'bun:test';

import { refusalIsOperationRefusal }                          from '../../shared/OperationRefusal.ts';
import { substituteTemplateTokens, type TemplateDescription } from './TemplateTokenSubstitution.ts';
import { TEMPLATE_TOKENS }                                    from './constants/TemplateFile.ts';

const TRACKER_TEMPLATE: TemplateDescription = { templateFilePath: 'resources/template.html', tokens: Object.values(TEMPLATE_TOKENS) };
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
