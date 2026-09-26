/**
 * That the page entry bundles from wherever the binary is run and the result is safe to inline in a `<script>`.
 */

import { describe, expect, test }                                                from 'bun:test';
import { createPageBundler, scriptWouldOpenAnHtmlComment, withScriptEndEscaped } from './PageBundle.ts';

describe('createPageBundler', () => {
  test('bundles the page entry point into a non-empty script', async () => {
    const outcome = await createPageBundler().bundlePageScript();

    expect(outcome.verdict).toBe('built');
    expect(outcome.verdict === 'built' && outcome.script.length).toBeGreaterThan(0);
  });

  test('produces a script that contains nothing a browser would read as the end of a script element', async () => {
    const outcome = await createPageBundler().bundlePageScript();

    expect(outcome.verdict).toBe('built');
    expect(outcome.verdict === 'built' && /<\/script/i.test(outcome.script)).toBe(false);
  });

  test('carries the page entry point, not an empty module', async () => {
    const outcome = await createPageBundler().bundlePageScript();

    expect(outcome.verdict === 'built' && outcome.script.includes('ap-progress-data')).toBe(true);
  });

  test('hands a second call the very outcome of the first, without building again', async () => {
    const pageBundler = createPageBundler();
    const first       = await pageBundler.bundlePageScript();
    const second      = await pageBundler.bundlePageScript();

    expect(second).toBe(first);
  });

  test('hands two callers asking at the same time the very same outcome, from one build', async () => {
    const pageBundler     = createPageBundler();
    const [first, second] = await Promise.all([pageBundler.bundlePageScript(), pageBundler.bundlePageScript()]);

    expect(second).toBe(first);
  });

  test('gives each bundler a build of its own, so no bundle outlives the invocation that made it', async () => {
    const first  = await createPageBundler().bundlePageScript();
    const second = await createPageBundler().bundlePageScript();

    expect(second).not.toBe(first);
    expect(first.verdict === 'built' && second.verdict === 'built' && first.script === second.script).toBe(true);
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
    const outcome = await createPageBundler().bundlePageScript();

    expect(outcome.verdict === 'built' && scriptWouldOpenAnHtmlComment(outcome.script)).toBe(false);
  });
});
