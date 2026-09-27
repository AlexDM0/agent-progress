/**
 * The page script's text made safe to inline in a `<script>`: every script end escaped without changing what the script computes, and an HTML
 * comment opener, which cannot be escaped in place, seen wherever it sits.
 */
import { describe, expect, test } from 'bun:test';

import { PageScriptTextUtil } from './PageScriptTextUtil.ts';

const { withScriptEndEscaped, scriptWouldOpenAnHtmlComment } = PageScriptTextUtil;

describe('withScriptEndEscaped', () => {
  test.each([
    ['a lowercase closing tag', 'var sample = "</script>";'],
    ['an uppercase one', 'var sample = "</SCRIPT>";'],
    ['a mixed-case one', 'var sample = "</ScRiPt>";'],
    ['one with no closing angle bracket', 'var sample = "</script ";'],
  ])('leaves nothing an HTML parser reads as the end of a script element, given %s', (_description, script) => {
    expect(/<\/script/i.test(withScriptEndEscaped(script))).toBe(false);
  });

  test('leaves the string the script builds byte for byte unchanged', () => {
    const escaped = withScriptEndEscaped('"</script></SCRIPT>".length');

    expect(escaped).not.toBe('"</script></SCRIPT>".length');

    expect(eval(escaped)).toBe('</script></SCRIPT>'.length);
  });

  test('keeps the case of the tag it escaped, since the page script is minified and compared by eye', () => {
    expect(withScriptEndEscaped('"</SCRIPT>"')).toContain('SCRIPT');
  });

  test('leaves a script containing no such sequence exactly as it was', () => {
    const untouched = 'var sample = 1; sample += 2;';

    expect(withScriptEndEscaped(untouched)).toBe(untouched);
  });
});

describe('scriptWouldOpenAnHtmlComment', () => {
  test('sees an HTML comment opener wherever it sits, and nothing else', () => {
    expect(scriptWouldOpenAnHtmlComment('var sample = "<!--<script";')).toBe(true);
    expect(scriptWouldOpenAnHtmlComment('var sample = 1 < 2; // -- not a comment opener')).toBe(false);
  });
});
