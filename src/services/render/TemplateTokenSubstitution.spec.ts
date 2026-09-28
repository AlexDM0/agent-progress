/**
 * The token substitution the page render relies on: each token replaced once and everything else kept byte for byte, a token that is gone or
 * doubled refused as unrepaired, every token split on though its spelling holds regular expression characters, and nothing injected searched again.
 */
import { describe, expect, test } from 'bun:test';

import { refusalIsOperationRefusal } from '../../shared/OperationRefusal.ts';
import { substituteTemplateTokens }  from './TemplateTokenSubstitution.ts';

describe('substituteTemplateTokens', () => {
  const values = { '__PROGRESS__': '{}', '__TICKETS__': '[]' };

  test('substitutes each token once and leaves the rest of the template byte for byte', () => {
    expect(substituteTemplateTokens('a __PROGRESS__ b __TICKETS__ c', values)).toBe('a {} b [] c');
  });

  test('replaces the title element and the page script token too', () => {
    const template = '<head><title>agent-progress</title></head><script>__PAGE_SCRIPT__</script>';
    const filled   = substituteTemplateTokens(template, { '<title>agent-progress</title>': '<title>Example Agency progress</title>', '__PAGE_SCRIPT__': 'run();' });

    expect(filled).toBe('<head><title>Example Agency progress</title></head><script>run();</script>');
  });

  test.each([
    ['a token that is gone', 'a __PROGRESS__ b', 0],
    ['a token that occurs twice', 'a __PROGRESS__ b __TICKETS__ c __TICKETS__', 2],
  ])('refuses %s as unrepaired, carrying the token and how often it occurs', (_description, template, occurrenceCount) => {
    let caught: unknown = null;
    try {
      substituteTemplateTokens(template, values);
    } catch (failure) {
      caught = failure;
    }

    expect(refusalIsOperationRefusal(caught) ? caught.status : null).toBe('unrepaired');
    expect(refusalIsOperationRefusal(caught) ? caught.detail : null).toEqual({
      kind:             'template-token-not-unique',
      templateFilePath: 'resources/template.html',
      token:            '__TICKETS__',
      occurrenceCount,
    });
  });

  test('does not find a token inside the text it just injected', () => {
    const injected = { '__PROGRESS__': '__TICKETS__', '__TICKETS__': 'second' };

    expect(substituteTemplateTokens('__PROGRESS__ / __TICKETS__', injected)).toBe('__TICKETS__ / second');
  });
});
