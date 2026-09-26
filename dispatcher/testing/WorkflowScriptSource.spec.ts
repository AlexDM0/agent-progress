/**
 * The guard over a dispatcher Workflow script's text: no clock, no randomness, a `meta` the Workflow tool can read without running the script,
 * and no top-level binding that shadows a Workflow global. A clean verdict proves nothing on its own, so every form is constructed here and must
 * be caught; the cases on the committed old script are in `dispatcher/testing/OldDispatchScript.spec.ts`, and those on the bundle in
 * `dispatcher/DispatchScript.spec.ts`. The meta's value must come back exactly, as the bundle's JSON-written meta is compared by value.
 */
import { describe, expect, test } from 'bun:test';

import {
  metaLiteralValueOf,
  metaLiteralVerdictOf,
  nondeterministicCallsIn,
  topLevelBindingsNamed,
} from './WorkflowScriptSource.ts';

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

describe('metaLiteralValueOf', () => {
  test('a pure meta comes back as the value it spells, negative numbers, booleans and null included', () => {
    expect(metaLiteralValueOf(PURE_META)).toEqual({
      verdict: 'value',
      value:   {
        name:        'example',
        description: 'Example',
        phases:      [{ title: 'One' }],
        retries:     -1,
        cached:      false,
        owner:       null,
      },
    });
  });

  // The bundle writes its meta with JSON.stringify, so every key is a quoted string and the key order is the one compared.
  test('a meta written as JSON, with string keys, comes back equal and in its key order', () => {
    const written = {
      name:          'example',
      'when to use': 'a "quoted" word\nand a line',
      phases:        [{ title: 'Survey', model: 'haiku' }, { title: 'Build' }],
      limit:         2.5,
    };
    const valueRead = metaLiteralValueOf(`export const meta = ${JSON.stringify(written, null, 2)};\nconst after = 1;\n`);
    expect(valueRead).toEqual({ verdict: 'value', value: written });
    expect(valueRead.verdict === 'value' ? JSON.stringify(valueRead.value) : null).toBe(JSON.stringify(written));
  });

  test('an impure or absent meta gives no value', () => {
    expect(metaLiteralValueOf('export const meta = { name: title };')).toEqual({ verdict: 'impure' });
    expect(metaLiteralValueOf(`const first = 1;\n${PURE_META}`)).toEqual({ verdict: 'absent' });
  });
});

describe('topLevelBindingsNamed', () => {
  test.each([
    ['a const', 'const log = 1;'],
    ['a let', 'let log;'],
    ['a var', 'var log = null;'],
    ['an object destructuring', 'const { log } = example;'],
    ['a renamed object destructuring', 'const { writer: log } = example;'],
    ['a nested destructuring', 'const { inner: { log } } = example;'],
    ['an array destructuring', 'const [, log] = example;'],
    ['a rest element', 'const { first, ...log } = example;'],
    ['a function', 'function log() {}'],
    ['an async function', 'async function log() {}'],
    ['a class', 'class log {}'],
  ])('%s after the meta is caught', (_form, statement) => {
    expect(topLevelBindingsNamed(`${PURE_META}${statement}\n`, ['log', 'agent'])).toEqual(['log at line 2']);
  });

  test('a name bound inside a function body, used as a key or renamed away from, or not asked for, is left alone', () => {
    const source = `${PURE_META}function outer() { const log = 1; function agent() {} return log; }\n`
      + 'const settings = { log: 1 };\nconst { log: writer } = example;\nconst logger = log;\n';
    expect(topLevelBindingsNamed(source, ['log', 'agent'])).toEqual([]);
  });

  test('every binding asked for is reported, each with its own line', () => {
    expect(topLevelBindingsNamed(`${PURE_META}const agent = 1;\nconst other = 2;\nfunction phase() {}\n`, ['agent', 'phase'])).toEqual([
      'agent at line 2',
      'phase at line 4',
    ]);
  });
});
