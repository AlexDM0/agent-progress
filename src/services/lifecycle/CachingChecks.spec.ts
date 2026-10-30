/**
 * The four caching checks on scratch repositories, suggestions only: a repository using Turbo with its cache per worktree (`.turbo/cache`),
 * a task whose inputs miss its templates and fixtures, and a gate run past `turbo run` gets all three of its suggestions; one with no caching
 * tool gets the measured slow gates; an absolute cache folder, default inputs and gates through Turbo get none. Nothing is written.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';
import { createScratchDirectory, removeScratchDirectory }                from '../../testing/ScratchWorkspace.ts';
import { CachingChecks, SLOW_GATE_MILLISECONDS, type CachingSuggestion } from './CachingChecks.ts';
import type { ProposalRunRecord }                                        from './ProposalTwiceRun.ts';

let repositoryDirectory = '';

function recordWith(millisecondsByGate: Readonly<Record<string, number>>): ProposalRunRecord {
  return {
    snapshotCommit: 'a'.repeat(40),
    prepare:        { failedSteps: [null, null], output: '' },
    gates:          Object.entries(millisecondsByGate).map(([name, milliseconds]) => ({
      name, outcomes: ['passed', 'passed'], durationsMilliseconds: [milliseconds, milliseconds / 2], verdict: 'green', output: ''
    })),
  };
}

function writeTurbo(configuration: unknown): void {
  writeFileSync(join(repositoryDirectory, 'turbo.json'), JSON.stringify(configuration));
}

beforeEach(() => {
  repositoryDirectory = createScratchDirectory('caching-checks');
  for (const folder of ['resources/templates', 'testing/fixtures', 'bin']) mkdirSync(join(repositoryDirectory, folder), { recursive: true });
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe('the caching checks suggest and never install', () => {
  test('a repository with a per-worktree .turbo/cache gets the cache, task input and turbo run suggestions', () => {
    writeTurbo({ tasks: { test: { inputs: ['src/**'] }, lint: {} } });
    const gates = [{ name: 'tests', run: 'bun test' }, { name: 'lint', run: 'turbo run lint' }];

    expect(CachingChecks.cachingSuggestionsOf(repositoryDirectory, gates, recordWith({ tests: 1000, lint: 1000 }))).toEqual([
      { kind: 'per-worktree-cache', cacheFolder: '.turbo/cache' },
      { kind: 'task-inputs-unseen', task: 'test', folders: ['bin', 'resources', 'resources/templates', 'testing/fixtures'] },
      { kind: 'gate-not-through-turbo', gate: 'tests' },
    ]);
  });

  test('a relative cacheDir is still one per worktree', () => {
    writeTurbo({ cacheDir: '.cache/turbo', tasks: {} });

    expect(CachingChecks.cachingSuggestionsOf(repositoryDirectory, [], recordWith({}))).toEqual([{ kind: 'per-worktree-cache', cacheFolder: '.cache/turbo' }]);
  });

  test('one absolute cache folder, default inputs and gates through turbo run suggest nothing', () => {
    const lintInputs = ['src/**', 'bin/**', 'resources/**', 'testing/fixtures/**'];
    writeTurbo({ cacheDir: '/Users/example/.cache/turbo', tasks: { test: { inputs: ['$TURBO_DEFAULT$'] }, lint: { inputs: lintInputs } } });
    const gates = [{ name: 'tests', run: 'bunx turbo run test' }];

    expect(CachingChecks.cachingSuggestionsOf(repositoryDirectory, gates, recordWith({ tests: 90_000 }))).toEqual([]);
  });

  test('with no caching tool, the gates at or over the slow bound are named with their slower measured time', () => {
    const record = recordWith({ tests: SLOW_GATE_MILLISECONDS, lint: SLOW_GATE_MILLISECONDS - 1 });

    const expected: CachingSuggestion[] = [{ kind: 'no-caching-tool', slowGates: [{ name: 'tests', milliseconds: SLOW_GATE_MILLISECONDS }] }];

    expect(CachingChecks.cachingSuggestionsOf(repositoryDirectory, [], record)).toEqual(expected);
  });

  test('with no caching tool and fast gates, nothing is suggested', () => {
    expect(CachingChecks.cachingSuggestionsOf(repositoryDirectory, [], recordWith({ tests: 1000 }))).toEqual([]);
  });
});
