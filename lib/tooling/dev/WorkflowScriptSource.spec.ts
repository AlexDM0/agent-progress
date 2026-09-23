/**
 * The guard over `templates/workflows/AgentProgressDispatch.js`: no clock, no randomness, and a `meta` the Workflow tool can read without running
 * the script. The real script is clean, so a clean verdict proves nothing on its own: every form is also constructed and must be caught, first in
 * isolation and then planted in the real script, and the real `meta` must have been walked node by node before its purity counts.
 */
import { describe, expect, test } from 'bun:test';

import { readDispatchScript }                            from './DispatchScriptHarness';
import { metaLiteralVerdictOf, nondeterministicCallsIn } from './WorkflowScriptSource';

const PURE_META = 'export const meta = { name: \'example\', description: \'Example\', phases: [{ title: \'One\' }], retries: -1, cached: false, owner: null };\n';

/** The real script's closing log line, where a planted form stands inside the body the Workflow tool would run. */
const PLANTING_POINT = 'log(`Done: ';

describe('nondeterministicCallsIn', () => {
  test.each([
    ['const now = Date.now();', 'Date.now at line 1'],
    ['const pick = Math.random();', 'Math.random at line 1'],
    ['const now = new Date();', 'new Date() at line 1'],
    ['const now = new Date;', 'new Date() at line 1'],
    ['const stamp = Date();', 'Date() at line 1'],
    ['const clock = Date[\'now\'];', 'Date.now at line 1'],
  ])('%s is caught', (statement, expected) => {
    expect(nondeterministicCallsIn(statement)).toEqual([expected]);
  });

  test('a date built from a value handed in, and Math used deterministically, are left alone', () => {
    expect(nondeterministicCallsIn('const when = new Date(args.startedAt); const most = Math.max(1, 2); const text = "Date.now()";')).toEqual([]);
  });

  test('each form planted in the real script is caught', () => {
    const source = readDispatchScript();
    expect(source.split(PLANTING_POINT).length - 1).toBe(1);
    for (const planted of ['Date.now()', 'Math.random()', 'new Date()']) {
      const found = nondeterministicCallsIn(source.replace(PLANTING_POINT, `log(String(${planted}));\n${PLANTING_POINT}`));
      expect(found, planted).toHaveLength(1);
    }
  });

  test('the real script calls no clock and no randomness', () => {
    expect(nondeterministicCallsIn(readDispatchScript())).toEqual([]);
  });
});

describe('metaLiteralVerdictOf', () => {
  test('a meta of strings, numbers, booleans, null, arrays and objects is pure', () => {
    expect(metaLiteralVerdictOf(PURE_META)).toEqual({ verdict: 'pure', literalNodeCount: 9 });
  });

  test.each([
    ['a variable', 'export const meta = { name: title };'],
    ['a call', 'export const meta = { name: String(1) };'],
    ['a spread', 'export const meta = { ...base, name: \'x\' };'],
    ['a computed key', 'export const meta = { [key]: \'x\' };'],
    ['a template hole', 'export const meta = { name: `x${1}` };'],
    ['a shorthand property', 'export const meta = { name };'],
    ['an arithmetic value', 'export const meta = { retries: 1 + 1 };'],
  ])('meta holding %s is impure', (_form, source) => {
    expect(metaLiteralVerdictOf(source).verdict).toBe('impure');
  });

  test('a meta that is not the first statement, is not exported or is not const is refused', () => {
    expect(metaLiteralVerdictOf(`const first = 1;\n${PURE_META}`)).toEqual({ verdict: 'absent' });
    expect(metaLiteralVerdictOf(PURE_META.replace('export ', ''))).toEqual({ verdict: 'absent' });
    expect(metaLiteralVerdictOf(PURE_META.replace('const', 'let')).verdict).toBe('impure');
  });

  test('the real script\'s meta is a pure literal, walked node by node', () => {
    const verdict = metaLiteralVerdictOf(readDispatchScript());
    expect(verdict.verdict).toBe('pure');
    expect(verdict.verdict === 'pure' ? verdict.literalNodeCount : 0).toBeGreaterThan(15);
  });

  test('an impurity planted in the real script\'s meta is caught', () => {
    const source = readDispatchScript().replace('name:        \'agent-progress-dispatch\',', 'name:        `agent-progress-${1}`,');
    expect(metaLiteralVerdictOf(source).verdict).toBe('impure');
  });
});
