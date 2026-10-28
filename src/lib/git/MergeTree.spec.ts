/**
 * Merge prediction, first as a table over planted git runs, then against real git in a scratch repository. What matters is that the
 * status and the tree decide together: exit 1 with no tree (an unresolvable revision) is a failed prediction, never a conflict with no
 * files, while a conflict listing no file is still a conflict. A `--stdin` batch reads its inverted per-record status, and a batch that
 * exits non-zero fails every pair, which `predictMerges` then predicts singly so one bad revision costs only its own pair.
 */
import { existsSync } from 'node:fs';
import { join }       from 'node:path';
import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import {
  commitFile,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitMergeTreeStdinIsPresent } from '../../testing/ToolGuard.ts';
import type { GitRun }                            from './GitProcess.ts';
import {
  batchPredictionsOfRun,
  commitCountAheadOf,
  predictionOfRun,
  predictMerge,
  predictMergeBatch,
  predictMerges,
  type MergePrediction
} from './MergeTree.ts';

const PLANTED_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const SINGLE_ARGUMENTS = ['merge-tree', '--write-tree'];

function plantedRun(exitCode: number, standardOutput: string): GitRun {
  return { exitCode, standardOutput, standardError: '' };
}

describe('reading one merge-tree run', () => {
  const cases: { claim: string; run: GitRun | null; expected: MergePrediction['verdict']; conflictedFiles?: string[] }[] = [
    { claim: 'exit 0 with a tree is clean', run: plantedRun(0, `${PLANTED_TREE}\0`), expected: 'clean' },
    {
      claim:           'exit 1 with a tree is conflicting, with its files once each',
      run:             plantedRun(1, `${PLANTED_TREE}\0a.txt\0b.txt\0a.txt\0`),
      expected:        'conflicting',
      conflictedFiles: ['a.txt', 'b.txt'],
    },
    {
      claim: 'exit 1 with a tree and no file listed is still a conflict', run: plantedRun(1, `${PLANTED_TREE}\0`), expected: 'conflicting', conflictedFiles: []
    },
    { claim: 'exit 1 with nothing on standard output, as for an unresolvable revision, failed', run: plantedRun(1, ''), expected: 'prediction-failed' },
    { claim: 'exit 0 with no tree failed', run: plantedRun(0, 'not a tree\0'), expected: 'prediction-failed' },
    { claim: 'any other exit code failed, even with a tree', run: plantedRun(128, `${PLANTED_TREE}\0`), expected: 'prediction-failed' },
    { claim: 'a git that could not be started failed', run: null, expected: 'prediction-failed' },
  ];
  for (const {
    claim, run, expected, conflictedFiles
  } of cases) {
    test(claim, () => {
      const prediction = predictionOfRun(run, SINGLE_ARGUMENTS);
      expect(prediction.verdict).toBe(expected);
      if (prediction.verdict === 'conflicting') expect(prediction.conflictedFiles).toEqual(conflictedFiles ?? []);
    });
  }
});

describe('reading one merge-tree --stdin run', () => {
  test('a batch that exits non-zero is prediction-failed for every pair, the records printed before the bad one included', () => {
    const predictions = batchPredictionsOfRun(plantedRun(1, `1\0${PLANTED_TREE}\0\0`), 3);
    expect(predictions.map((prediction) => prediction.verdict)).toEqual(['prediction-failed', 'prediction-failed', 'prediction-failed']);
  });

  test('a batch that prints fewer records than pairs is prediction-failed for every pair', () => {
    const predictions = batchPredictionsOfRun(plantedRun(0, `1\0${PLANTED_TREE}\0\0`), 2);
    expect(predictions.map((prediction) => prediction.verdict)).toEqual(['prediction-failed', 'prediction-failed']);
  });

  test('each record\'s inverted status is read: 1 clean, 0 conflicting with its files, even when it lists none', () => {
    const output      = `0\0${PLANTED_TREE}\0a.txt\0\0` + `1\0${PLANTED_TREE}\0\0` + `0\0${PLANTED_TREE}\0\0`;
    const predictions = batchPredictionsOfRun(plantedRun(0, output), 3);
    expect(predictions).toEqual([
      { verdict: 'conflicting', conflictedFiles: ['a.txt'] },
      { verdict: 'clean' },
      { verdict: 'conflicting', conflictedFiles: [] },
    ]);
  });
});

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

/** `main` holds `shared.txt`; `left` and `right` rewrite its first line differently, and `elsewhere` adds another file. */
function plantedPairsRepository(): string {
  const repositoryDirectory = createScratchGitRepository('merge-tree');
  scratchDirectories.push(repositoryDirectory);
  commitFile(repositoryDirectory, 'shared.txt', 'first\nsecond\n');
  gitOutputIn(repositoryDirectory, ['branch', '-M', 'main']);
  const plantedBranches = [['left', 'shared.txt', 'left\nsecond\n'], ['right', 'shared.txt', 'right\nsecond\n'], ['elsewhere', 'other.txt', 'other\n']] as const;
  for (const [branch, fileName, content] of plantedBranches) {
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', branch, 'main']);
    commitFile(repositoryDirectory, fileName, content);
  }
  gitOutputIn(repositoryDirectory, ['checkout', '-q', 'main']);
  return repositoryDirectory;
}

describeWhenGitMergeTreeStdinIsPresent('predicting merges with real git', () => {
  test('a single pair is clean, conflicting with its file, or failed for an unresolvable revision', () => {
    const repositoryDirectory = plantedPairsRepository();
    expect(predictMerge(repositoryDirectory, { target: 'left', branch: 'elsewhere' })).toEqual({ verdict: 'clean' });
    expect(predictMerge(repositoryDirectory, { target: 'left', branch: 'right' })).toEqual({ verdict: 'conflicting', conflictedFiles: ['shared.txt'] });
    expect(predictMerge(repositoryDirectory, { target: 'left', branch: 'no-such-branch' }).verdict).toBe('prediction-failed');
  });

  test('a revision shaped like an option is looked up, failing the prediction, rather than obeyed', () => {
    const repositoryDirectory = plantedPairsRepository();
    expect(predictMerge(repositoryDirectory, { target: 'left', branch: '--output=planted' }).verdict).toBe('prediction-failed');
    expect(existsSync(join(repositoryDirectory, 'planted'))).toBe(false);
  });

  test('a --stdin batch of clean and conflicting pairs reads each record\'s status', () => {
    const repositoryDirectory = plantedPairsRepository();
    const pairs = [{ target: 'left', branch: 'right' }, { target: 'left', branch: 'elsewhere' }, { target: 'right', branch: 'elsewhere' }];
    expect(predictMergeBatch(repositoryDirectory, pairs)).toEqual([
      { verdict: 'conflicting', conflictedFiles: ['shared.txt'] },
      { verdict: 'clean' },
      { verdict: 'clean' },
    ]);
  });

  test('a batch holding a bad revision fails every pair, and predictMerges then predicts each singly', () => {
    const repositoryDirectory = plantedPairsRepository();
    const pairs = [{ target: 'left', branch: 'elsewhere' }, { target: 'left', branch: 'no-such-branch' }, { target: 'left', branch: 'right' }];
    expect(predictMergeBatch(repositoryDirectory, pairs).map((prediction) => prediction.verdict)).toEqual(['prediction-failed', 'prediction-failed', 'prediction-failed']);
    expect(predictMerges(repositoryDirectory, pairs).map((prediction) => prediction.verdict)).toEqual(['clean', 'prediction-failed', 'conflicting']);
  });

  test('an empty batch predicts nothing and runs no git', () => {
    expect(predictMerges('/nonexistent-directory', [])).toEqual([]);
  });

  test('the commit count ahead is how many commits the included side holds past the excluded, and null for an unknown revision', () => {
    const repositoryDirectory = plantedPairsRepository();
    expect(commitCountAheadOf(repositoryDirectory, 'main', 'left')).toBe(1);
    expect(commitCountAheadOf(repositoryDirectory, 'left', 'main')).toBe(0);
    expect(commitCountAheadOf(repositoryDirectory, 'main', 'no-such-branch')).toBeNull();
  });
});
