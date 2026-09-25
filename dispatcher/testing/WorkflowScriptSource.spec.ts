/**
 * The guard over a dispatcher Workflow script's text: no clock, no randomness, and a `meta` the Workflow tool can read without running the script.
 * A clean verdict proves nothing on its own, so every form is constructed here and must be caught; the cases on the committed old script are in
 * `dispatcher/testing/OldDispatchScript.spec.ts`.
 */
import { describe, expect, test } from 'bun:test';

import { metaLiteralVerdictOf, nondeterministicCallsIn } from './WorkflowScriptSource';

const PURE_META = 'export const meta = { name: \'example\', description: \'Example\', phases: [{ title: \'One\' }], retries: -1, cached: false, owner: null };\n';

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
});
