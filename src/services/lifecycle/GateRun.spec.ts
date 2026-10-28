/**
 * The gate and its cache. What matters: a pass is cached under the content of tree, checks line, install line and the key command's
 * output, so a second gate on the same tree runs nothing and records `cached: true`; with no key command the key is the one passes were
 * cached under before; a key command that does not exit 0 caches nothing and cannot run; a failure is never cached; the memory cache
 * stands alone for the sandbox fallback; and the gate runs the argv it is handed, in a process group of its own, without the job
 * variables a session carries.
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

// Taken from the key before key commands existed, sha256 of the JSON triple; a pass cached then must keep its key.
const KEY_BEFORE_KEY_COMMANDS = '69bf6a6449205532311e932587be72c270272b485240b9db6bc972fc8a1655a0';

type TreeGateVerdict = Awaited<ReturnType<typeof GateRun.gateTree>>;

async function gateOnce(cache: GateResultCache, exitCode: number, treeId = TREE_ID, keyArgv: readonly string[] | null = null): Promise<TreeGateVerdict> {
  return await GateRun.gateTree({
    argv:        countingArgv(exitCode),
    directory:   scratchDirectory,
    treeId,
    checksLine:  CHECKS_LINE,
    installLine: INSTALL_LINE,
    keyArgv,
    cache,
  });
}

/** A fake key command, such as a toolchain's `--version`, printing what the spec plants and exiting as told. */
function plantedKeyArgv(output: string, exitCode = 0): string[] {
  return GateRun.keyCommandArgvOf(`echo '${output}'; echo 'a warning' >&2; exit ${exitCode}`);
}

describe('the gate cache key', () => {
  test('is the sha256 of tree, checks line and install line, the same for the same three and different when any one differs', () => {
    const key = gateCacheKeyOf({
      treeId: TREE_ID, checksLine: CHECKS_LINE, installLine: INSTALL_LINE, keyOutput: null
    });

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(gateCacheKeyOf({
      treeId: TREE_ID, checksLine: CHECKS_LINE, installLine: INSTALL_LINE, keyOutput: null
    })).toBe(key);
    expect(gateCacheKeyOf({
      treeId: OTHER_TREE_ID, checksLine: CHECKS_LINE, installLine: INSTALL_LINE, keyOutput: null
    })).not.toBe(key);
    expect(gateCacheKeyOf({
      treeId: TREE_ID, checksLine: 'bun test', installLine: INSTALL_LINE, keyOutput: null
    })).not.toBe(key);
    expect(gateCacheKeyOf({
      treeId: TREE_ID, checksLine: CHECKS_LINE, installLine: null, keyOutput: null
    })).not.toBe(key);
  });

  test('with no key command stored is exactly the key from before key commands, so no cached pass changes meaning', () => {
    expect(gateCacheKeyOf({
      treeId: TREE_ID, checksLine: CHECKS_LINE, installLine: INSTALL_LINE, keyOutput: null
    })).toBe(KEY_BEFORE_KEY_COMMANDS);
  });

  test('takes the key command\'s output as a fourth input: each output, the empty one included, keys apart from none', () => {
    const keyOf = (keyOutput: string | null): string => gateCacheKeyOf({
      treeId: TREE_ID, checksLine: CHECKS_LINE, installLine: INSTALL_LINE, keyOutput
    });

    expect(new Set([keyOf(null), keyOf(''), keyOf('1.3.0'), keyOf('1.3.1')]).size).toBe(4);
    expect(keyOf('1.3.0')).toBe(keyOf('1.3.0'));
  });
});

describe('a gate with a key command', () => {
  test('two gates on one tree whose key command prints different output miss each other\'s cache; identical output hits', async () => {
    const cache = createMemoryGateResultCache();

    const underOldToolchain   = await gateOnce(cache, 0, TREE_ID, plantedKeyArgv('bun 1.3.0'));
    const underNewToolchain   = await gateOnce(cache, 0, TREE_ID, plantedKeyArgv('bun 1.3.1'));
    const newToolchainAgain   = await gateOnce(cache, 0, TREE_ID, plantedKeyArgv('bun 1.3.1'));
    const withoutKeyCommand   = await gateOnce(cache, 0, TREE_ID, null);

    expect([underOldToolchain.cached, underNewToolchain.cached, newToolchainAgain.cached, withoutKeyCommand.cached]).toEqual([false, false, true, false]);
    expect(runCount()).toBe(3);
  });

  test('only standard output keys the cache, its trailing newlines dropped', async () => {
    const run = await GateRun.runGate({ argv: plantedKeyArgv('bun 1.3.0'), directory: scratchDirectory });

    expect(GateRun.keyOutputOf(run.output)).toBe('bun 1.3.0');
  });

  const failingKeyExits = [['exits non-zero', 1], ['exits 126', 126], ['exits 127', 127]] as const;
  test.each(failingKeyExits)('a key command that %s caches nothing, never runs the gate, and cannot run', async (_case, exitCode) => {
    const cache = createMemoryGateResultCache();

    const first  = await gateOnce(cache, 0, TREE_ID, plantedKeyArgv('bun 1.3.0', exitCode));
    const second = await gateOnce(cache, 0, TREE_ID, plantedKeyArgv('bun 1.3.0', exitCode));

    expect([first.outcome, first.cached, second.outcome, second.cached]).toEqual(['cannot-run', false, 'cannot-run', false]);
    expect(runCount()).toBe(0);
  });

  test('a key command that cannot be started cannot run either', async () => {
    const verdict = await gateOnce(createMemoryGateResultCache(), 0, TREE_ID, [join(scratchDirectory, 'no-such-shell')]);

    expect(verdict.outcome).toBe('cannot-run');
    expect(runCount()).toBe(0);
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

    const pass = {
      treeId: TREE_ID, checksLine: CHECKS_LINE, installLine: INSTALL_LINE, keyOutput: null
    };
    expect(JSON.parse(readFileSync(join(cacheFolder, `${gateCacheKeyOf(pass)}.json`), 'utf8'))).toEqual(pass);
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
