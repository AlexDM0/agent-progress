/**
 * The merge forecasting a board read runs, counted through a predictor wrapping real git. What matters is that a publish over an unmoved
 * tip set runs no second merge-tree, that moving the target or any candidate predicts afresh, and that a candidate whose branch does not
 * resolve, or a prediction that failed, is never cached, so it is retried on the next read.
 */
import { afterAll, expect, test } from 'bun:test';

import { predictMerges, type MergePair } from '../../../src/lib/git/MergeTree.ts';
import {
  commitFile,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
} from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitMergeTreeStdinIsPresent }       from '../../../src/testing/ToolGuard.ts';
import { createMergeForecastCache, mergeForecastingIn } from './BoardStateReader.ts';

const scratchDirectories: string[] = [];
afterAll(() => {
  for (const scratchDirectory of scratchDirectories) removeScratchDirectory(scratchDirectory);
});

/** `main` holds `shared.txt`; `ticket-1` and `ticket-2` each add a file of their own. */
function plantedQueueRepository(): string {
  const repositoryDirectory = createScratchGitRepository('merge-forecast-cache');
  scratchDirectories.push(repositoryDirectory);
  commitFile(repositoryDirectory, 'shared.txt', 'first\n');
  gitOutputIn(repositoryDirectory, ['branch', '-M', 'main']);
  for (const ticketId of ['1', '2']) {
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', `ticket-${ticketId}`, 'main']);
    commitFile(repositoryDirectory, `ticket-${ticketId}.txt`, `${ticketId}\n`);
  }
  gitOutputIn(repositoryDirectory, ['checkout', '-q', 'main']);
  return repositoryDirectory;
}

function countingPredictor(): { predict: typeof predictMerges; runCount: () => number } {
  let runs = 0;
  return {
    predict: (directory: string, pairs: readonly MergePair[]) => {
      runs += 1;
      return predictMerges(directory, pairs);
    },
    runCount: () => runs,
  };
}

describeWhenGitMergeTreeStdinIsPresent('caching the merge forecasts across board reads', () => {
  test('a second read over an unchanged tip set runs no merge-tree and returns the same forecasts', () => {
    const repositoryDirectory = plantedQueueRepository();
    const predictor   = countingPredictor();
    const forecasting = mergeForecastingIn(repositoryDirectory, 'main', createMergeForecastCache(), predictor.predict);
    const first       = forecasting.forecastsOf('main', ['1', '2']);
    const runsAfterFirstRead = predictor.runCount();
    expect(runsAfterFirstRead).toBeGreaterThan(0);
    expect(forecasting.forecastsOf('main', ['1', '2'])).toBe(first);
    expect(predictor.runCount()).toBe(runsAfterFirstRead);
  });

  test('a moved candidate branch or a moved target predicts afresh', () => {
    const repositoryDirectory = plantedQueueRepository();
    const predictor   = countingPredictor();
    const forecasting = mergeForecastingIn(repositoryDirectory, 'main', createMergeForecastCache(), predictor.predict);
    forecasting.forecastsOf('main', ['1', '2']);
    const runsPerRead = predictor.runCount();
    gitOutputIn(repositoryDirectory, ['checkout', '-q', 'ticket-2']);
    commitFile(repositoryDirectory, 'shared.txt', 'second\n');
    forecasting.forecastsOf('main', ['1', '2']);
    expect(predictor.runCount()).toBe(runsPerRead * 2);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', 'main']);
    commitFile(repositoryDirectory, 'shared.txt', 'main\n');
    expect(forecasting.forecastsOf('main', ['1', '2']).againstTarget['2']?.forecast).toBe('conflicting');
    expect(predictor.runCount()).toBeGreaterThan(runsPerRead * 2);
  });

  test('a queue holding a branch that does not resolve is never cached', () => {
    const repositoryDirectory = plantedQueueRepository();
    const predictor   = countingPredictor();
    const forecasting = mergeForecastingIn(repositoryDirectory, 'main', createMergeForecastCache(), predictor.predict);
    expect(forecasting.forecastsOf('main', ['1', '3']).againstTarget['3']?.forecast).toBe('prediction-failed');
    const runsAfterFirstRead = predictor.runCount();
    forecasting.forecastsOf('main', ['1', '3']);
    expect(predictor.runCount()).toBe(runsAfterFirstRead * 2);
  });

  test('a prediction that failed over a resolvable tip set is never cached, so the next read retries it', () => {
    const repositoryDirectory = plantedQueueRepository();
    let failNextRun = true;
    const predictor = countingPredictor();
    const failingOncePredictor: typeof predictMerges = (directory, pairs) => {
      if (!failNextRun) return predictor.predict(directory, pairs);
      failNextRun = false;
      return pairs.map(() => ({ verdict: 'prediction-failed' as const, reason: 'planted failure' }));
    };
    const forecasting = mergeForecastingIn(repositoryDirectory, 'main', createMergeForecastCache(), failingOncePredictor);
    expect(forecasting.forecastsOf('main', ['1', '2']).againstTarget['1']?.forecast).toBe('prediction-failed');
    expect(forecasting.forecastsOf('main', ['1', '2']).againstTarget['1']?.forecast).toBe('clean');
  });

  test('without a cache every read predicts afresh', () => {
    const repositoryDirectory = plantedQueueRepository();
    const predictor   = countingPredictor();
    const forecasting = mergeForecastingIn(repositoryDirectory, 'main', null, predictor.predict);
    forecasting.forecastsOf('main', ['1', '2']);
    const runsAfterFirstRead = predictor.runCount();
    forecasting.forecastsOf('main', ['1', '2']);
    expect(predictor.runCount()).toBe(runsAfterFirstRead * 2);
  });
});
