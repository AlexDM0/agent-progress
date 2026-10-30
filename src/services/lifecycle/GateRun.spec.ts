/**
 * The gate pipeline run on a checkout. What matters: the prepare steps run first and a failed one is a setup failure, never a red gate;
 * the gates run in list order and the first red one stops the rest, reported by name with its output; a gate that exits 0 but changes a
 * tracked file is red with the diff as its output; each step gets its own confinement (a prepare step the network, a gate only its own
 * domains and writes) and a gate runs in its `in` folder; a gate takes a machine slot while it runs; nothing is cached, so the same tree
 * gated twice runs twice; and the gate process runs the argv it is handed, in a process group of its own, without the job variables.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                        from 'bun:test';
import type { PipelineGate }                         from '../../lib/tracker-model/@types/Pipeline.ts';
import { JOB_ID_VARIABLE, HATCH_DIRECTORY_VARIABLE } from '../../shared/Environment.ts';
import {
  commitFile,
  createScratchDirectory,
  createScratchGitRepository,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { testWhenGitIsPresent }          from '../../testing/ToolGuard.ts';
import { type GateConfinement, GateRun } from './GateRun.ts';

let scratchDirectory = '';

beforeEach(() => {
  scratchDirectory = createScratchDirectory('gate-run');
});

const repositories: string[] = [];

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
  for (const repository of repositories.splice(0)) removeScratchDirectory(repository);
});

function gatedRepository(): string {
  const repository = createScratchGitRepository('gate-pipeline');
  repositories.push(repository);
  return repository;
}

function journalLine(name: string): string {
  return `echo ${name} >> '${join(scratchDirectory, 'journal.txt')}'`;
}

function journal(): string[] {
  const journalPath = join(scratchDirectory, 'journal.txt');
  return existsSync(journalPath) ? readFileSync(journalPath, 'utf8').trim().split('\n') : [];
}

function gateOf(name: string, run: string, extra: Partial<PipelineGate> = {}): PipelineGate {
  return { name, run, ...extra };
}

describe('the pipeline', () => {
  testWhenGitIsPresent('runs gate a then the red gate b and never c, reporting b by name with its output', async () => {
    const repository = gatedRepository();

    const verdict = await GateRun.runPipeline({
      prepare:   [],
      gates:     [gateOf('a', journalLine('a')), gateOf('b', `${journalLine('b')}; echo 'expected 2, received 3'; exit 1`), gateOf('c', journalLine('c'))],
      directory: repository,
    });

    expect(verdict).toEqual({
      outcome: 'failed', gate: 'b', output: 'expected 2, received 3\n', gatesRun: ['a', 'b']
    });
    expect(journal()).toEqual(['a', 'b']);
  });

  testWhenGitIsPresent('holds a gate that exits 0 but changes a tracked file red, with the diff as its output', async () => {
    const repository = gatedRepository();
    commitFile(repository, 'source.txt', 'unformatted\n');

    const verdict = await GateRun.runPipeline({ prepare: [], gates: [gateOf('format', 'echo formatted > source.txt')], directory: repository });

    expect(verdict.outcome).toBe('failed');
    expect('output' in verdict ? verdict.output : '').toContain('-unformatted\n+formatted');
  });

  testWhenGitIsPresent('passes every gate that exits 0 and leaves the tree, and runs them again on the same tree, caching nothing', async () => {
    const repository = gatedRepository();
    const request    = { prepare: [], gates: [gateOf('a', journalLine('a')), gateOf('b', journalLine('b'))], directory: repository };

    expect(await GateRun.runPipeline(request)).toEqual({ outcome: 'passed', gatesRun: ['a', 'b'] });
    expect(await GateRun.runPipeline(request)).toEqual({ outcome: 'passed', gatesRun: ['a', 'b'] });
    expect(journal()).toEqual(['a', 'b', 'a', 'b']);
  });

  testWhenGitIsPresent('a failed prepare step is a setup failure that runs no gate', async () => {
    const repository = gatedRepository();

    const verdict = await GateRun.runPipeline({
      prepare:   [{ name: 'install', run: 'echo registry unreachable; exit 1' }],
      gates:     [gateOf('a', journalLine('a'))],
      directory: repository,
    });

    expect(verdict).toEqual({
      outcome: 'setup-failed', step: 'install', output: 'registry unreachable\n', gatesRun: []
    });
    expect(journal()).toEqual([]);
  });

  testWhenGitIsPresent('a gate the shell cannot find is one that cannot run', async () => {
    const repository = gatedRepository();

    const verdict = await GateRun.runPipeline({ prepare: [], gates: [gateOf('missing', 'no-such-example-tool --check')], directory: repository });

    expect(verdict.outcome).toBe('cannot-run');
  });

  testWhenGitIsPresent('confines a prepare step to the network and every gate to its own domains and writes, run in its in folder', async () => {
    const repository = gatedRepository();
    mkdirSync(join(repository, 'service'));
    writeFileSync(join(repository, 'service', '.gitkeep'), '');
    const confinements: [string, GateConfinement][] = [];

    await GateRun.runPipeline({
      prepare: [{ name: 'install', run: 'true' }],
      gates:   [
        gateOf('tests', `pwd > '${join(scratchDirectory, 'tests-folder.txt')}'`, { in: 'service', network: ['registry.example.com'], writes: ['~/.cache/example'] }),
        gateOf('lint', 'true'),
      ],
      directory:      repository,
      confinedArgvOf: (argv, confinement) => {
        confinements.push([String(argv.at(-1)), confinement]);
        return argv;
      },
    });

    expect(confinements).toEqual([
      ['true', { network: true, networkDomains: [], writes: ['~/.cache/example'] }],
      [`pwd > '${join(scratchDirectory, 'tests-folder.txt')}'`, { network: true, networkDomains: ['registry.example.com'], writes: ['~/.cache/example'] }],
      ['true', { network: false, networkDomains: [], writes: [] }],
    ]);
    expect(readFileSync(join(scratchDirectory, 'tests-folder.txt'), 'utf8').trim()).toEndWith('/service');
  });

  testWhenGitIsPresent('takes a gate slot for each gate and releases it when the gate ends, a prepare step taking none', async () => {
    const repository = gatedRepository();
    const slotEvents: string[] = [];

    await GateRun.runPipeline({
      prepare:         [{ name: 'install', run: 'true' }],
      gates:           [gateOf('a', 'true'), gateOf('b', 'true')],
      directory:       repository,
      acquireGateSlot: () => {
        slotEvents.push('acquired');
        return Promise.resolve(() => slotEvents.push('released'));
      },
    });

    expect(slotEvents).toEqual(['acquired', 'released', 'acquired', 'released']);
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

  test('has the job id and the Hatch folder removed from its environment, and keeps every other variable', async () => {
    const environment = {
      [JOB_ID_VARIABLE]: 'J7', [HATCH_DIRECTORY_VARIABLE]: '/example/hatch', EXAMPLE_KEPT: 'kept', PATH: '/usr/bin:/bin'
    };

    const run = await GateRun.runGate({
      argv:      ['/bin/sh', '-c', `echo "\${${JOB_ID_VARIABLE}-unset} \${${HATCH_DIRECTORY_VARIABLE}-unset} $EXAMPLE_KEPT"`],
      directory: scratchDirectory,
      environment,
    });

    expect(run.output.trim()).toBe('unset unset kept');
  });

  test('a shell line is handed to the user\'s shell through sh, so it is one argument whatever it holds', () => {
    const argv = GateRun.shellLineArgvOf('bun test && echo "done"');

    expect(argv.at(-1)).toBe('bun test && echo "done"');
    expect(argv[0]).toBe('/bin/sh');
  });
});
