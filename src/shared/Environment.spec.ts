/**
 * What `AGENT_PROGRESS_ROOT` and `SHELL` mean at each value they arrive with. The value cases run in a child
 * process so that the one assignment below stays the repository's only in-process write to the
 * environment, and that assignment is what shows the getter reads afresh rather than capturing at import.
 */
import { join }         from 'node:path';
import { expect, test } from 'bun:test';

import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS } from '../testing/ChildProcessCaseTimeout.ts';
import { jsonPrintedByAChildProcess }              from '../testing/JsonPrintedByAChildProcess.ts';
import {
  agentProgressRootOverride,
  EVERY_TOOL_REQUIRED_VARIABLE,
  REAL_AGENT_SPECS_VARIABLE,
  ROOT_OVERRIDE_VARIABLE
} from './Environment.ts';
import { PRODUCT_NAMES } from './constants/ProductNames.ts';

const ENVIRONMENT_MODULE_PATH = join(import.meta.dir, 'Environment.ts');

test('both variables the product reads are named from its environment prefix', () => {
  expect(ROOT_OVERRIDE_VARIABLE).toBe(`${PRODUCT_NAMES.ENVIRONMENT_PREFIX}ROOT`);
  expect(EVERY_TOOL_REQUIRED_VARIABLE).toBe(`${PRODUCT_NAMES.ENVIRONMENT_PREFIX}REQUIRE_EVERY_TOOL`);
});

/** The child inherits nothing: its environment is exactly `childEnvironment`, so "unset" means unset. */
function overrideSeenByAChildProcess(childEnvironment: Record<string, string>): string | null {
  const source = [
    `const loaded = await import(${JSON.stringify(ENVIRONMENT_MODULE_PATH)});`,
    'console.log(JSON.stringify(loaded.agentProgressRootOverride() ?? null));',
  ].join('\n');
  return jsonPrintedByAChildProcess(childEnvironment, source) as string | null;
}

function shellSeenByAChildProcess(childEnvironment: Record<string, string>): string | null {
  const source = [
    `const loaded = await import(${JSON.stringify(ENVIRONMENT_MODULE_PATH)});`,
    'console.log(JSON.stringify(loaded.userShell() ?? null));',
  ].join('\n');
  return jsonPrintedByAChildProcess(childEnvironment, source) as string | null;
}

test('the user\'s shell is SHELL verbatim, and an unset, empty or whitespace-only one is none', () => {
  expect(shellSeenByAChildProcess({ SHELL: '/bin/example shell' })).toBe('/bin/example shell');
  expect(shellSeenByAChildProcess({})).toBeNull();
  for (const clearedValue of ['', '  ']) expect(shellSeenByAChildProcess({ SHELL: clearedValue }), JSON.stringify(clearedValue)).toBeNull();
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('the child-process harness can tell the two answers apart, so a case that finds nothing means something', () => {
  expect(overrideSeenByAChildProcess({ [ROOT_OVERRIDE_VARIABLE]: '/example/repository' })).toBe('/example/repository');
  expect(overrideSeenByAChildProcess({})).toBeNull();
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('a set variable is the override, verbatim', () => {
  expect(overrideSeenByAChildProcess({ [ROOT_OVERRIDE_VARIABLE]: '/example/repository' })).toBe('/example/repository');
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('an unset variable is no override', () => {
  expect(overrideSeenByAChildProcess({})).toBeNull();
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('an empty or whitespace-only value reads as unset rather than as the empty root', () => {
  for (const clearedValue of ['', '   ', '\t']) {
    expect(overrideSeenByAChildProcess({ [ROOT_OVERRIDE_VARIABLE]: clearedValue }), JSON.stringify(clearedValue)).toBeNull();
  }
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('a real path is handed back untouched, spaces and all', () => {
  const pathWithSpaces = '/Users/alex.example/development/example agency';
  expect(overrideSeenByAChildProcess({ [ROOT_OVERRIDE_VARIABLE]: pathWithSpaces })).toBe(pathWithSpaces);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('a value set after this module was imported is still seen, and so is clearing it again', () => {
  const previousValue = process.env[ROOT_OVERRIDE_VARIABLE];
  try {
    process.env[ROOT_OVERRIDE_VARIABLE] = '/example/repository/redirected-in-process';
    expect(agentProgressRootOverride()).toBe('/example/repository/redirected-in-process');
    delete process.env[ROOT_OVERRIDE_VARIABLE];
    expect(agentProgressRootOverride()).toBeUndefined();
  } finally {
    // Restored, not cleared: Bun runs every spec file in one process, and the machine may legitimately have set it.
    if (previousValue === undefined) delete process.env[ROOT_OVERRIDE_VARIABLE];
    else process.env[ROOT_OVERRIDE_VARIABLE] = previousValue;
  }
});

function everyToolRequirementSeenByAChildProcess(childEnvironment: Record<string, string>): boolean {
  const source = [
    `const loaded = await import(${JSON.stringify(ENVIRONMENT_MODULE_PATH)});`,
    'console.log(JSON.stringify(loaded.everyToolIsRequired()));',
  ].join('\n');
  return jsonPrintedByAChildProcess(childEnvironment, source) as boolean;
}

test('an unset, empty, whitespace or 0 AGENT_PROGRESS_REQUIRE_EVERY_TOOL lets a missing tool skip', () => {
  expect(everyToolRequirementSeenByAChildProcess({})).toBe(false);
  for (const relaxedValue of ['', '  ', '0', ' 0 ']) {
    expect(everyToolRequirementSeenByAChildProcess({ [EVERY_TOOL_REQUIRED_VARIABLE]: relaxedValue }), JSON.stringify(relaxedValue)).toBe(false);
  }
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('any other AGENT_PROGRESS_REQUIRE_EVERY_TOOL value requires every tool, so a true or yes is never a silent skip', () => {
  for (const requiringValue of ['1', 'true', 'yes']) {
    expect(everyToolRequirementSeenByAChildProcess({ [EVERY_TOOL_REQUIRED_VARIABLE]: requiringValue }), requiringValue).toBe(true);
  }
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

function realAgentSpecsSeenByAChildProcess(childEnvironment: Record<string, string>): boolean {
  const source = [
    `const loaded = await import(${JSON.stringify(ENVIRONMENT_MODULE_PATH)});`,
    'console.log(JSON.stringify(loaded.realAgentSpecsAreOn()));',
  ].join('\n');
  return jsonPrintedByAChildProcess(childEnvironment, source) as boolean;
}

test('the real-agent specs are on only for a set, non-zero opt-in, never because every tool is required', () => {
  expect(REAL_AGENT_SPECS_VARIABLE).toBe(`${PRODUCT_NAMES.ENVIRONMENT_PREFIX}REAL_AGENT_SPECS`);
  expect(realAgentSpecsSeenByAChildProcess({})).toBe(false);
  expect(realAgentSpecsSeenByAChildProcess({ [EVERY_TOOL_REQUIRED_VARIABLE]: '1' })).toBe(false);
  for (const offValue of ['', ' ', '0']) expect(realAgentSpecsSeenByAChildProcess({ [REAL_AGENT_SPECS_VARIABLE]: offValue }), JSON.stringify(offValue)).toBe(false);
  expect(realAgentSpecsSeenByAChildProcess({ [REAL_AGENT_SPECS_VARIABLE]: '1' })).toBe(true);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('the environment copy holds every variable verbatim, and nothing else', () => {
  const source = [
    `const loaded = await import(${JSON.stringify(ENVIRONMENT_MODULE_PATH)});`,
    'console.log(JSON.stringify(loaded.environmentCopy()));',
  ].join('\n');
  const copy = jsonPrintedByAChildProcess({ EXAMPLE_VARIABLE: 'Example Agency', EMPTY_VARIABLE: '' }, source) as Record<string, string>;
  expect(copy['EXAMPLE_VARIABLE']).toBe('Example Agency');
  expect(copy['EMPTY_VARIABLE']).toBe('');
  expect(Object.keys(copy).filter((variable) => variable.startsWith('EXAMPLE_') || variable.startsWith('EMPTY_')).sort()).toEqual(['EMPTY_VARIABLE', 'EXAMPLE_VARIABLE']);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('the override is exposed as a function, which is what lets it be redirected at all', () => {
  expect(typeof agentProgressRootOverride).toBe('function');
});
