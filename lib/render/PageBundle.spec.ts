/**
 * That the page entry bundles from wherever the binary is run and the result is safe to inline in a `<script>`.
 */

import {
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import {
  bundlePageScript,
  PageBundleBookkeeping,
  scriptWouldOpenAnHtmlComment,
  withScriptEndEscaped,
} from './PageBundle.ts';

describe('bundlePageScript', () => {
  beforeEach(() => {
    PageBundleBookkeeping.forgetMemoisedBundle();
  });

  test('bundles the page entry point into a non-empty script', async () => {
    const outcome = await bundlePageScript();

    expect(outcome.verdict).toBe('built');
    expect(outcome.verdict === 'built' && outcome.script.length).toBeGreaterThan(0);
  });

  test('produces a script that contains nothing a browser would read as the end of a script element', async () => {
    const outcome = await bundlePageScript();

    expect(outcome.verdict).toBe('built');
    expect(outcome.verdict === 'built' && /<\/script/i.test(outcome.script)).toBe(false);
  });

  test('carries the page entry point, not an empty module', async () => {
    const outcome = await bundlePageScript();

    expect(outcome.verdict === 'built' && outcome.script.includes('ap-progress-data')).toBe(true);
  });

  test('returns the same script on a second call without building again', async () => {
    const first  = await bundlePageScript();
    const second = await bundlePageScript();

    expect(PageBundleBookkeeping.buildCount).toBe(1);
    expect(first.verdict === 'built' && second.verdict === 'built' && first.script === second.script).toBe(true);
  });

  test('starts only one build when two callers ask at the same time', async () => {
    const [first, second] = await Promise.all([bundlePageScript(), bundlePageScript()]);

    expect(PageBundleBookkeeping.buildCount).toBe(1);
    expect(first.verdict === 'built' && second.verdict === 'built' && first.script === second.script).toBe(true);
  });

  test('builds again once its bookkeeping has been reset', async () => {
    await bundlePageScript();
    PageBundleBookkeeping.forgetMemoisedBundle();
    await bundlePageScript();

    expect(PageBundleBookkeeping.buildCount).toBe(1);
  });
});

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

  test('the real bundle carries none', async () => {
    const outcome = await bundlePageScript();

    expect(outcome.verdict === 'built' && scriptWouldOpenAnHtmlComment(outcome.script)).toBe(false);
  });
});
