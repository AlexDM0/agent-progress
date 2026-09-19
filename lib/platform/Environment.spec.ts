/**
 * What `AGENT_PROGRESS_ROOT` means at each value it arrives with. The value cases run in a child
 * process because `lib/EnvironmentReads.spec.ts` allows an in-process read in only two files, and the
 * one assignment below is what shows the getter reads afresh rather than capturing at import.
 */
import { join }         from 'node:path';
import { expect, test } from 'bun:test';

import { agentProgressRootOverride } from './Environment';

const ENVIRONMENT_MODULE_PATH = join(import.meta.dir, 'Environment.ts');

const ROOT_OVERRIDE_VARIABLE = 'AGENT_PROGRESS_ROOT';

/** The child inherits nothing: its environment is exactly `childEnvironment`, so "unset" means unset. */
function overrideSeenByAChildProcess(childEnvironment: Record<string, string>): string | null {
  const source = [
    `const loaded = await import(${JSON.stringify(ENVIRONMENT_MODULE_PATH)});`,
    'console.log(JSON.stringify(loaded.agentProgressRootOverride() ?? null));',
  ].join('\n');
  const finished = Bun.spawnSync([process.execPath, '-e', source], {
    env:    childEnvironment,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (finished.exitCode !== 0) {
    throw new Error(`the child process failed: ${finished.stderr.toString().trim()}`);
  }
  return JSON.parse(finished.stdout.toString().trim()) as string | null;
}

test('the child-process harness can tell the two answers apart, so a case that finds nothing means something', () => {
  expect(overrideSeenByAChildProcess({ AGENT_PROGRESS_ROOT: '/example/repository' })).toBe('/example/repository');
  expect(overrideSeenByAChildProcess({})).toBeNull();
});

test('a set variable is the override, verbatim', () => {
  expect(overrideSeenByAChildProcess({ AGENT_PROGRESS_ROOT: '/example/repository' })).toBe('/example/repository');
});

test('an unset variable is no override', () => {
  expect(overrideSeenByAChildProcess({})).toBeNull();
});

test('an empty or whitespace-only value reads as unset rather than as the empty root', () => {
  for (const clearedValue of ['', '   ', '\t']) {
    expect(overrideSeenByAChildProcess({ AGENT_PROGRESS_ROOT: clearedValue }), JSON.stringify(clearedValue)).toBeNull();
  }
});

test('a real path is handed back untouched, spaces and all', () => {
  const pathWithSpaces = '/Users/alex.example/development/example agency';
  expect(overrideSeenByAChildProcess({ AGENT_PROGRESS_ROOT: pathWithSpaces })).toBe(pathWithSpaces);
});

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

test('the override is exposed as a function, which is what lets it be redirected at all', () => {
  expect(typeof agentProgressRootOverride).toBe('function');
});
