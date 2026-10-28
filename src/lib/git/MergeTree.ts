/**
 * Predicting a merge without touching a worktree, through `git merge-tree --write-tree`: one pair, or a `--stdin` batch of pairs that falls
 * back to one prediction per pair when the batch fails. Verdicts, never throws, and a conflicted-file list is never read without its status.
 */
import { GitProcess, type GitRun } from './GitProcess.ts';

const CLEAN_EXIT_CODE       = 0;
const CONFLICTING_EXIT_CODE = 1;

// A --stdin record's status is inverted against the single command's exit code.
const BATCH_RECORD_CLEAN_STATUS       = '1';
const BATCH_RECORD_CONFLICTING_STATUS = '0';

const TREE_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const PREDICTION_ARGUMENTS       = ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z'] as const;
const BATCH_PREDICTION_ARGUMENTS = ['merge-tree', '--stdin', '--name-only', '--no-messages', '-z'] as const;

export type MergePrediction =
  | { verdict: 'clean' }
  | { verdict: 'conflicting'; conflictedFiles: string[] }
  | { verdict: 'prediction-failed'; reason: string };

/** `target` is merged into, `branch` merged in; the order only decides how git labels the two sides. */
export interface MergePair {
  target: string;
  branch: string;
}

function uniqueFilesOf(fields: readonly string[]): string[] {
  return [...new Set(fields.filter((field) => field !== ''))];
}

/**
 * Exit 0 with a tree is clean and exit 1 with a tree conflicting, even with no file listed; anything else failed, since an unresolvable
 * revision also exits 1, with nothing on standard output.
 */
export function predictionOfRun(run: GitRun | null, gitArguments: readonly string[]): MergePrediction {
  if (run === null) return { verdict: 'prediction-failed', reason: GitProcess.failureReasonOf(run, gitArguments) };
  const [treeObjectId = '', ...fileFields] = run.standardOutput.split('\0');
  const treeWasWritten = TREE_OBJECT_ID.test(treeObjectId);
  if (treeWasWritten && run.exitCode === CLEAN_EXIT_CODE) return { verdict: 'clean' };
  if (treeWasWritten && run.exitCode === CONFLICTING_EXIT_CODE) return { verdict: 'conflicting', conflictedFiles: uniqueFilesOf(fileFields) };
  const reason = GitProcess.failureReasonOf(run, gitArguments);
  return { verdict: 'prediction-failed', reason: treeWasWritten ? reason : `${reason} (no tree written)` };
}

export function predictMerge(directory: string, pair: MergePair): MergePrediction {
  const gitArguments = [...PREDICTION_ARGUMENTS, '--end-of-options', pair.target, pair.branch];
  return predictionOfRun(GitProcess.run(directory, gitArguments), gitArguments);
}

type BatchRecord = { treeObjectId: string; status: string; conflictedFiles: string[] };

/** Each record is its status, its tree and its files, closed by an empty field; `null` unless exactly `recordCount` records fill the output. */
function batchRecordsOf(standardOutput: string, recordCount: number): BatchRecord[] | null {
  const fields  = standardOutput.split('\0');
  const records: BatchRecord[] = [];
  let position = 0;
  while (records.length < recordCount) {
    const status       = fields[position];
    const treeObjectId = fields[position + 1];
    if (status === undefined || treeObjectId === undefined) return null;
    position += 2;
    const conflictedFiles: string[] = [];
    while (fields[position] !== '') {
      const field = fields[position];
      if (field === undefined) return null;
      conflictedFiles.push(field);
      position += 1;
    }
    position += 1;
    records.push({ status, treeObjectId, conflictedFiles });
  }
  const onlyTheClosingFieldIsLeft = position === fields.length - 1 && fields[position] === '';
  return onlyTheClosingFieldIsLeft ? records : null;
}

function predictionOfBatchRecord(record: BatchRecord): MergePrediction {
  if (!TREE_OBJECT_ID.test(record.treeObjectId)) return { verdict: 'prediction-failed', reason: `git merge-tree --stdin wrote no tree for a record (status ${record.status}).` };
  if (record.status === BATCH_RECORD_CLEAN_STATUS) return { verdict: 'clean' };
  if (record.status === BATCH_RECORD_CONFLICTING_STATUS) return { verdict: 'conflicting', conflictedFiles: uniqueFilesOf(record.conflictedFiles) };
  return { verdict: 'prediction-failed', reason: `git merge-tree --stdin answered status ${record.status} for a record.` };
}

/** A batch that exits non-zero stopped at a bad record, so every pair is failed, the records printed before it included. */
export function batchPredictionsOfRun(run: GitRun | null, pairCount: number): MergePrediction[] {
  const failedEveryPair = (reason: string): MergePrediction[] => Array.from({ length: pairCount }, () => ({ verdict: 'prediction-failed', reason }));
  if (!GitProcess.succeeded(run)) return failedEveryPair(GitProcess.failureReasonOf(run, BATCH_PREDICTION_ARGUMENTS));
  const records = batchRecordsOf(run.standardOutput, pairCount);
  if (records === null) return failedEveryPair(`git merge-tree --stdin did not print one record for each of the ${pairCount} pairs.`);
  return records.map(predictionOfBatchRecord);
}

export function predictMergeBatch(directory: string, pairs: readonly MergePair[]): MergePrediction[] {
  if (pairs.length === 0) return [];
  const standardInput = pairs.map((pair) => `${pair.target} ${pair.branch}\n`).join('');
  return batchPredictionsOfRun(GitProcess.run(directory, BATCH_PREDICTION_ARGUMENTS, 'hooks-off', standardInput), pairs.length);
}

/** One batch, and a single prediction for each pair the batch failed, so one bad revision costs only its own pairs. */
export function predictMerges(directory: string, pairs: readonly MergePair[]): MergePrediction[] {
  return predictMergeBatch(directory, pairs).map((prediction, index) => {
    const pair = pairs[index];
    return prediction.verdict === 'prediction-failed' && pair !== undefined ? predictMerge(directory, pair) : prediction;
  });
}

/** `git rev-list --count <excluded>..<included>`: how far `included` is ahead, such as main past a group. `null` when git cannot answer. */
export function commitCountAheadOf(directory: string, excluded: string, included: string): number | null {
  const run = GitProcess.run(directory, ['rev-list', '--count', '--end-of-options', `${excluded}..${included}`]);
  if (!GitProcess.succeeded(run)) return null;
  const count = run.standardOutput.trim();
  return /^[0-9]+$/.test(count) ? Number(count) : null;
}
