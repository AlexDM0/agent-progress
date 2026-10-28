/**
 * The gate and its cache. What matters: a pass is cached under the content of tree, checks line and install line, so a second gate on the
 * same tree runs nothing and records `cached: true`; a failure is never cached; the memory cache stands alone for the sandbox fallback;
 * and the gate runs the argv it is handed, in a process group of its own, without the job variables a session carries.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join }                     from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                        from 'bun:test';
import { JOB_ID_VARIABLE, RELAY_DIRECTORY_VARIABLE }      from '../../shared/Environment.ts';
import { boardFixture }                                   from '../../testing/BoardFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import {
  createFolderGateResultCache,
  createMemoryGateResultCache,
  gateCacheKeyOf,
  type GateResultCache
} from './GateResultCache.ts';
import { GateRun } from './GateRun.ts';

const TREE_ID = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const OTHER_TREE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const CHECKS_LINE = 'bun run verify';

const INSTALL_LINE = 'bun install --frozen-lockfile';

let scratchDirectory = '';

beforeEach(() => {
  scratchDirectory = createScratchDirectory('gate-run');
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

function countingArgv(exitCode: number): string[] {
  return ['/bin/sh', '-c', `echo ran >> runs.txt; exit ${exitCode}`];
}

function runCount(): number {
  const runsPath = join(scratchDirectory, 'runs.txt');
  return existsSync(runsPath) ? readFileSync(runsPath, 'utf8').trim().split('\n').length : 0;
}

async function gateOnce(cache: GateResultCache, exitCode: number, treeId = TREE_ID): Promise<Awaited<ReturnType<typeof GateRun.gateTree>>> {
  return await GateRun.gateTree({
    argv:        countingArgv(exitCode),
    directory:   scratchDirectory,
    treeId,
    checksLine:  CHECKS_LINE,
    installLine: INSTALL_LINE,
    cache,
  });
}

describe('the gate cache key', () => {
  test('is the sha256 of tree, checks line and install line, the same for the same three and different when any one differs', () => {
    const key = gateCacheKeyOf({ treeId: TREE_ID, checksLine: CHECKS_LINE, installLine: INSTALL_LINE });

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(gateCacheKeyOf({ treeId: TREE_ID, checksLine: CHECKS_LINE, installLine: INSTALL_LINE })).toBe(key);
    expect(gateCacheKeyOf({ treeId: OTHER_TREE_ID, checksLine: CHECKS_LINE, installLine: INSTALL_LINE })).not.toBe(key);
    expect(gateCacheKeyOf({ treeId: TREE_ID, checksLine: 'bun test', installLine: INSTALL_LINE })).not.toBe(key);
    expect(gateCacheKeyOf({ treeId: TREE_ID, checksLine: CHECKS_LINE, installLine: null })).not.toBe(key);
  });
});

describe('a gate on a tree', () => {
  test('a pass is cached in memory alone: the second gate on the same tree runs nothing and is a hit, another tree runs', async () => {
    const cache = createMemoryGateResultCache();

    const first  = await gateOnce(cache, 0);
    const second = await gateOnce(cache, 0);
    const other  = await gateOnce(cache, 0, OTHER_TREE_ID);

    expect([first.outcome, first.cached]).toEqual(['passed', false]);
    expect([second.outcome, second.cached, second.run]).toEqual(['passed', true, null]);
    expect(other.cached).toBe(false);
    expect(runCount()).toBe(2);
  });

  test('a failure is never cached, so the next gate on the tree runs again', async () => {
    const cache = createMemoryGateResultCache();

    const first  = await gateOnce(cache, 1);
    const second = await gateOnce(cache, 1);

    expect([first.outcome, second.outcome, second.cached]).toEqual(['failed', 'failed', false]);
    expect(runCount()).toBe(2);
  });

  test('exit 126 or 127 is a gate that cannot run, never a failed pass, and is not cached either', async () => {
    const cache = createMemoryGateResultCache();

    expect((await gateOnce(cache, 127)).outcome).toBe('cannot-run');
    expect((await gateOnce(cache, 126)).outcome).toBe('cannot-run');
    expect(runCount()).toBe(2);
  });

  test('the folder cache keeps one file per pass under its key, which a fresh cache over the same folder reads as a hit', async () => {
    const cacheFolder = join(scratchDirectory, 'gates');

    await gateOnce(createFolderGateResultCache(cacheFolder), 0);
    const again = await gateOnce(createFolderGateResultCache(cacheFolder), 0);

    const key = gateCacheKeyOf({ treeId: TREE_ID, checksLine: CHECKS_LINE, installLine: INSTALL_LINE });
    expect(JSON.parse(readFileSync(join(cacheFolder, `${key}.json`), 'utf8'))).toEqual({ treeId: TREE_ID, checksLine: CHECKS_LINE, installLine: INSTALL_LINE });
    expect(again.cached).toBe(true);
    expect(runCount()).toBe(1);
  });

  test('a hit is logged gate-ran with cached: true, a run with cached: false', async () => {
    const cache              = createMemoryGateResultCache();
    const { board, records } = boardFixture();

    for (const { tree, outcome, cached } of [await gateOnce(cache, 0), await gateOnce(cache, 0)]) board.recordGateRan({ tree, outcome, cached }, '2026-10-28T10:00:00+01:00');

    expect(records.map(({ kind, fields }) => [kind, fields])).toEqual([
      ['gate-ran', { tree: TREE_ID, outcome: 'passed', cached: false }],
      ['gate-ran', { tree: TREE_ID, outcome: 'passed', cached: true }],
    ]);
  });
});

describe('the gate process', () => {
  test('runs the argv it is handed in the directory it names, its two streams joined', async () => {
    const run = await GateRun.runGate({ argv: ['/bin/sh', '-c', 'pwd; echo to-error >&2'], directory: scratchDirectory });

    expect(run.exitCode).toBe(0);
    expect(run.output).toContain('to-error');
    expect(run.output).toContain(scratchDirectory.split('/').at(-1) ?? scratchDirectory);
  });

  test('leads a process group of its own, so a checks line that signals its group reaches only the gate', async () => {
    const run = await GateRun.runGate({ argv: ['/bin/sh', '-c', 'echo "$$ $(ps -o pgid= -p $$)"'], directory: scratchDirectory });

    const [shellProcessId, processGroupId] = run.output.trim().split(/\s+/);
    expect(processGroupId).toBe(shellProcessId);
    expect(processGroupId).not.toBe(String(process.pid));
  });

  test('a gate ended by a signal is one that cannot run', async () => {
    const run = await GateRun.runGate({ argv: ['/bin/sh', '-c', 'kill -TERM $$'], directory: scratchDirectory });

    expect(run.signalCode).toBe('SIGTERM');
    expect(GateRun.gateOutcomeOf(run)).toBe('cannot-run');
  });

  test('has the job id and the relay folder removed from its environment, and keeps every other variable', async () => {
    const environment = {
      [JOB_ID_VARIABLE]: 'J7', [RELAY_DIRECTORY_VARIABLE]: '/example/relay', EXAMPLE_KEPT: 'kept', PATH: '/usr/bin:/bin'
    };

    const run = await GateRun.runGate({
      argv:      ['/bin/sh', '-c', `echo "\${${JOB_ID_VARIABLE}-unset} \${${RELAY_DIRECTORY_VARIABLE}-unset} $EXAMPLE_KEPT"`],
      directory: scratchDirectory,
      environment,
    });

    expect(run.output.trim()).toBe('unset unset kept');
  });

  test('the checks line is handed to the user\'s shell through sh, so it is one argument whatever it holds', () => {
    const argv = GateRun.checksLineArgvOf('bun test && echo "done"');

    expect(argv.at(-1)).toBe('bun test && echo "done"');
    expect(argv[0]).toBe('/bin/sh');
  });
});
