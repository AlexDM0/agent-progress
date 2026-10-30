/**
 * A proposal's gates run twice on a scratch snapshot, and each of the four verdicts is planted: green both times, red both times, unrunnable,
 * and a gate that fails once and passes once, which is `disagreeing` rather than either. A gate is judged on its own, so a red one hides
 * no later one; a gate that changes a tracked file fails and the snapshot is restored; a failed prepare step judges no gate of its run.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join }                     from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
} from 'bun:test';
import type { PipelineGate } from '../../lib/tracker-model/@types/Pipeline.ts';
import {
  commitFile,
  createScratchDirectory,
  createScratchGitRepository,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                  from '../../testing/ToolGuard.ts';
import { ProposalTwiceRun, type ProposalRunRequest } from './ProposalTwiceRun.ts';

let snapshotDirectory = '';
let markerDirectory = '';
let snapshotCommit = '';

function gate(name: string, run: string): PipelineGate {
  return { name, run };
}

function requestOf(gates: readonly PipelineGate[], prepare: ProposalRunRequest['prepare'] = []): ProposalRunRequest {
  let clock = 0;
  return {
    prepare,
    gates,
    directory:       snapshotDirectory,
    snapshotCommit,
    millisecondsNow: () => {
      clock += 250;
      return clock;
    },
  };
}

beforeEach(() => {
  snapshotDirectory = createScratchGitRepository('proposal-twice-run');
  snapshotCommit    = commitFile(snapshotDirectory, 'package.json', '{ "name": "example" }\n');
  markerDirectory   = createScratchDirectory('proposal-twice-run-marker');
});

afterEach(() => {
  removeScratchDirectory(snapshotDirectory);
  removeScratchDirectory(markerDirectory);
});

describeWhenGitIsPresent('a proposal runs twice before User sees it', () => {
  test('cannot-run, red, green and disagreeing gates are each recorded with both outcomes', async () => {
    const marker = join(markerDirectory, 'ran-once');
    const record = await ProposalTwiceRun.runProposalTwice(requestOf([
      gate('unrunnable', 'no-such-gate-command-anywhere'),
      gate('red', 'exit 1'),
      gate('green', 'true'),
      gate('flaky', `if [ -f '${marker}' ]; then exit 0; fi; touch '${marker}'; exit 1`),
    ]));

    expect(record.gates.map(({ name, outcomes, verdict }) => [name, outcomes, verdict])).toEqual([
      ['unrunnable', ['cannot-run', 'cannot-run'], 'cannot-run'],
      ['red', ['failed', 'failed'], 'red'],
      ['green', ['passed', 'passed'], 'green'],
      ['flaky', ['failed', 'passed'], 'disagreeing'],
    ]);
    expect(record.snapshotCommit).toBe(snapshotCommit);
    expect(record.prepare.failedSteps).toEqual([null, null]);
  });

  test('each run of each gate records its measured time', async () => {
    const record = await ProposalTwiceRun.runProposalTwice(requestOf([gate('green', 'true')]));

    expect(record.gates[0]?.durationsMilliseconds).toEqual([250, 250]);
  });

  test('a gate that changes a tracked file is red, and the snapshot is restored for the gate after it', async () => {
    const record = await ProposalTwiceRun.runProposalTwice(requestOf([
      gate('formats', 'echo changed > package.json'),
      gate('reads', 'grep -q example package.json'),
    ]));

    expect(record.gates.map(({ verdict }) => verdict)).toEqual(['red', 'green']);
    expect(readFileSync(join(snapshotDirectory, 'package.json'), 'utf8')).toBe('{ "name": "example" }\n');
  });

  test('a failed prepare step judges no gate of its run', async () => {
    const record = await ProposalTwiceRun.runProposalTwice(requestOf([gate('green', 'true')], [{ name: 'install', run: 'exit 3' }]));

    expect(record.prepare.failedSteps).toEqual(['install', 'install']);
    expect(record.gates.map(({ verdict }) => verdict)).toEqual(['cannot-run']);
    expect(existsSync(join(snapshotDirectory, 'node_modules'))).toBe(false);
  });
});
