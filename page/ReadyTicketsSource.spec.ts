/**
 * Ready is the Board's: the page reads it from `boardFacts.readyTickets` in one place and derives no rule of its own. The cases that
 * matter: exactly one page module reads the Board's list, and the dependency graph, which knows waves and statuses, carries no ready
 * member a view could take instead.
 */

import { readFileSync }           from 'node:fs';
import { join }                   from 'node:path';
import { describe, expect, test } from 'bun:test';
import { pageBoardFixture }       from './testing/PageBoardFixture.ts';
import { DependencyGraphUtil }    from './utils/DependencyGraphUtil.ts';

const PAGE_DIRECTORY             = import.meta.dir;
const READY_LIST_READ            = /\.readyTickets\b/;
const MODULES_READING_READY_LIST = ['utils/IslandUtil.ts'];

function pageModulePaths(): string[] {
  return [...new Bun.Glob('**/*.ts').scanSync({ cwd: PAGE_DIRECTORY })]
    .filter((path) => !path.endsWith('.spec.ts') && !path.startsWith('testing/'))
    .sort();
}

describe('the source of ready', () => {
  test('only the island reader reads the Board\'s ready list', () => {
    const modulePaths = pageModulePaths();
    expect(modulePaths.length).toBeGreaterThan(MODULES_READING_READY_LIST.length);
    const readers = modulePaths.filter((path) => READY_LIST_READ.test(readFileSync(join(PAGE_DIRECTORY, path), 'utf8')));
    expect(readers).toEqual(MODULES_READING_READY_LIST);
  });

  test('the dependency graph has no ready member of its own', () => {
    const board = pageBoardFixture({ tasks: [], tickets: [] });
    const graph = DependencyGraphUtil.dependencyGraphOf(board.tickets, 1);
    expect(Object.keys(graph).length).toBeGreaterThan(0);
    expect(Object.keys(graph).filter((key) => /ready/i.test(key))).toEqual([]);
  });
});
