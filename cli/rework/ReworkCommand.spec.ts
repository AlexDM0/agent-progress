/**
 * `agent-progress rework` end to end, against a scratch repository that goes through the workflow it is
 * measured by: a builder's commit, a reviewer's commit, the main line moving underneath with a conflicting
 * change, and a rebase whose conflict is resolved by hand. The claims that matter are the ones a threshold
 * rests on: the main line's own work is in neither count, the hand resolution is in the rebase count and
 * nowhere else, a rebase without conflicts counts nothing, and comments and documentation never count.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join }            from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import { createCapturedCommandContext } from '../../lib/tooling/dev/CapturedCommandContext';
import {
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
}                                                                             from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine } from '../Main';

interface ReworkPartDocument {
  reworkedCodeLines: number;
  addedCodeLines:    number;
  removedCodeLines:  number;
}

interface ReworkDocument extends ReworkPartDocument {
  worktree:     string;
  headCommit:   string;
  notCounted:   { commentLines: number; blankLines: number; documentationLines: number };
  since?:       ReworkPartDocument & { commit: string; commitCount: number };
  rebasedFrom?: ReworkPartDocument & { oldTipCommit: string; mainLine: string; oldBaseCommit: string; newBaseCommit: string };
  files:        Array<{ path: string; addedCodeLines: number; removedCodeLines: number; commentLines: number; documentationLines: number }>;
}

const COMMIT_IDENTITY = ['-c', 'user.name=Alex Example', '-c', 'user.email=alex.example@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.editor=true'];

const SHARED_BEFORE = 'export function greet(): string {\n  return \'hello\';\n}\n';

const BUILDER_FILE = 'export const builderValue = 1;\n// the builder\'s note\nexport const builderOther = 2;\n';

let repositoryDirectory = '';
let outsideDirectory    = '';

function git(gitArguments: readonly string[]): { exitCode: number; output: string } {
  const finished = Bun.spawnSync(['git', ...COMMIT_IDENTITY, ...gitArguments], { cwd: repositoryDirectory, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: finished.exitCode, output: `${finished.stdout.toString()}${finished.stderr.toString()}`.trim() };
}

function gitOrFail(gitArguments: readonly string[]): string {
  const { exitCode, output } = git(gitArguments);
  if (exitCode !== 0) throw new Error(`git ${gitArguments.join(' ')} failed: ${output}`);
  return output;
}

function writeRepositoryFile(relativePath: string, content: string): void {
  const absolutePath = join(repositoryDirectory, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function commitEverything(message: string): string {
  gitOrFail(['add', '--all']);
  gitOrFail(['commit', '-q', '-m', message]);
  return gitOrFail(['rev-parse', 'HEAD']);
}

async function rework(commandArguments: readonly string[], currentDirectory = repositoryDirectory): Promise<{ exitCode: number; output: string; error: string }> {
  const context  = createCapturedCommandContext({ currentDirectory });
  const exitCode = await runCommandLine(['rework', ...commandArguments], context);
  return { exitCode, output: context.outputText(), error: context.errorText() };
}

async function reworkDocument(commandArguments: readonly string[]): Promise<ReworkDocument> {
  const { exitCode, output, error } = await rework([...commandArguments, '--json']);
  expect(exitCode, error).toBe(0);
  return JSON.parse(output) as ReworkDocument;
}

/** The builder's branch off `main`, with one builder commit and the commit the review starts from returned. */
function buildTheFeatureBranch(): string {
  writeRepositoryFile('lib/shared.ts', SHARED_BEFORE);
  commitEverything('Base');
  gitOrFail(['checkout', '-q', '-b', 'feature']);
  writeRepositoryFile('lib/shared.ts', SHARED_BEFORE.replace('\'hello\'', '\'hello from the builder\''));
  writeRepositoryFile('lib/builder.ts', BUILDER_FILE);
  return commitEverything('Builder');
}

/** Two code lines added, one changed; everything else in the commit is comment, blank or documentation. */
function commitTheReview(): void {
  writeRepositoryFile('lib/review.ts', [
    '// a comment the reviewer wrote',
    '/*',
    ' * a block comment across lines',
    ' */',
    'export const reviewed = true;',
    '',
    'export const alsoReviewed = 2; // a trailing comment',
    '',
  ].join('\n'));
  writeRepositoryFile('lib/builder.ts', BUILDER_FILE.replace('builderValue = 1', 'builderValue = 10'));
  writeRepositoryFile('docs/notes.ts', 'export const documentation = true;\n');
  writeRepositoryFile('README.md', '# Example\n\nWhy the review changed things.\n');
  commitEverything('Review');
}

/** The main line moves under the branch: a conflicting edit to the builder's line, and a file of its own. */
function moveTheMainLine(): void {
  gitOrFail(['checkout', '-q', 'main']);
  writeRepositoryFile('lib/shared.ts', SHARED_BEFORE.replace('\'hello\'', '\'hello from main\''));
  writeRepositoryFile('lib/mainOnly.ts', 'export const one = 1;\nexport const two = 2;\nexport const three = 3;\n');
  commitEverything('Main moves');
  gitOrFail(['checkout', '-q', 'feature']);
}

function rebaseWithAHandResolution(): void {
  const { exitCode } = git(['rebase', '-q', 'main']);
  expect(exitCode, 'the rebase stops on the conflict it was built to have').not.toBe(0);
  writeRepositoryFile('lib/shared.ts', 'export function greet(): string {\n  // settled between the builder and main\n  return \'hello from both\';\n}\n');
  gitOrFail(['add', 'lib/shared.ts']);
  gitOrFail(['rebase', '--continue']);
}

beforeEach(() => {
  if (!gitIsAvailable()) return;
  repositoryDirectory = createScratchGitRepository('rework');
  outsideDirectory    = createScratchDirectory('rework-outside');
  gitOrFail(['checkout', '-q', '-B', 'main']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
  removeScratchDirectory(outsideDirectory);
});

describe.skipIf(!gitIsAvailable())('counting the commits a review made', () => {
  test('only the review\'s code lines count: its comments, blank lines and documentation do not', async () => {
    const reviewStart = buildTheFeatureBranch();
    commitTheReview();

    const document = await reworkDocument(['--since', reviewStart]);
    expect(document.reworkedCodeLines).toBe(4);
    expect(document.since).toMatchObject({
      commit:           reviewStart,
      commitCount:      1,
      addedCodeLines:   3,
      removedCodeLines: 1,
    });
    expect(document.notCounted.commentLines).toBe(4);
    expect(document.notCounted.documentationLines).toBe(4);
    expect(document.files.find((file) => file.path === 'lib/shared.ts'), 'the builder\'s commit is before the review started').toBeUndefined();
  });

  test('the human line says how many lines in how many commits, and --files lists only files with code in them', async () => {
    const reviewStart = buildTheFeatureBranch();
    commitTheReview();

    const { exitCode, output } = await rework(['--since', reviewStart, '--files']);
    expect(exitCode).toBe(0);
    expect(output).toContain(`Reworked 4 lines of code in 1 commit since ${reviewStart.slice(0, 8)}: 3 added, 1 removed.`);
    expect(output).toContain('lib/review.ts');
    expect(output).toContain('lib/builder.ts');
    expect(output).not.toContain('README.md');
    expect(output).not.toContain('docs/notes.ts');
    expect(output).toContain('Not counted: 4 comment, 1 blank and 4 documentation lines.');
  });

  test('--worktree reads the named working tree instead of the current directory', async () => {
    const reviewStart = buildTheFeatureBranch();
    commitTheReview();
    const { exitCode, output } = await rework(['--since', reviewStart, '--worktree', repositoryDirectory], outsideDirectory);
    expect(exitCode).toBe(0);
    expect(output).toStartWith('Reworked 4 lines of code');
  });

  test('the main line\'s commits are in no count once the branch is rebased onto them', async () => {
    buildTheFeatureBranch();
    commitTheReview();
    moveTheMainLine();
    const oldTip = gitOrFail(['rev-parse', 'HEAD']);
    rebaseWithAHandResolution();
    const rebasedTip = gitOrFail(['rev-parse', 'HEAD']);
    writeRepositoryFile('lib/afterRebase.ts', 'export const fixedAfterTheRebase = true;\n');
    commitEverything('A fix after the rebase');

    const document = await reworkDocument(['--since', rebasedTip, '--rebased-from', oldTip]);
    expect(document.since?.reworkedCodeLines).toBe(1);
    expect(document.rebasedFrom?.reworkedCodeLines, 'the fix after the rebase is the review\'s, counted once').toBe(2);
    expect(document.files.map(({ path }) => path)).not.toContain('lib/mainOnly.ts');
  });
});

describe.skipIf(!gitIsAvailable())('counting what a rebase changed', () => {
  test('the hand resolution of a conflict is counted, and the comment written into it is not', async () => {
    buildTheFeatureBranch();
    commitTheReview();
    moveTheMainLine();
    const oldTip = gitOrFail(['rev-parse', 'HEAD']);
    rebaseWithAHandResolution();

    const document = await reworkDocument(['--rebased-from', oldTip]);
    // The builder's version leaves the patch and the resolved version enters it; main's own line is not the review's.
    expect(document.rebasedFrom).toMatchObject({ oldTipCommit: oldTip, mainLine: 'main', reworkedCodeLines: 2 });
    expect(document.notCounted.commentLines).toBe(1);
    expect(document.files.map(({ path }) => path)).toEqual(['lib/shared.ts']);
  });

  test('a rebase without conflicts counts nothing', async () => {
    buildTheFeatureBranch();
    commitTheReview();
    gitOrFail(['checkout', '-q', 'main']);
    writeRepositoryFile('lib/mainOnly.ts', 'export const one = 1;\n');
    commitEverything('Main moves elsewhere');
    gitOrFail(['checkout', '-q', 'feature']);
    const oldTip = gitOrFail(['rev-parse', 'HEAD']);
    gitOrFail(['rebase', '-q', 'main']);

    const { exitCode, output } = await rework(['--rebased-from', oldTip]);
    expect(exitCode).toBe(0);
    expect(output).toBe(`Reworked 0 lines of code in the rebase from ${oldTip.slice(0, 8)} onto main: 0 added, 0 removed.`);
  });

  test('both options in one call print one total and the two parts', async () => {
    buildTheFeatureBranch();
    commitTheReview();
    moveTheMainLine();
    const oldTip = gitOrFail(['rev-parse', 'HEAD']);
    rebaseWithAHandResolution();
    const rebasedTip = gitOrFail(['rev-parse', 'HEAD']);
    writeRepositoryFile('lib/afterRebase.ts', 'export const fixedAfterTheRebase = true;\n');
    commitEverything('A fix after the rebase');

    const { exitCode, output } = await rework(['--since', rebasedTip, '--rebased-from', oldTip]);
    expect(exitCode).toBe(0);
    expect(output).toBe(`Reworked 3 lines of code: 1 in 1 commit since ${rebasedTip.slice(0, 8)} (1 added, 0 removed) `
      + `and 2 in the rebase from ${oldTip.slice(0, 8)} onto main (2 added, 0 removed).`);
  });
});

describe.skipIf(!gitIsAvailable())('what rework refuses', () => {
  test('a directory outside any repository is refused at exit 1', async () => {
    const { exitCode, error } = await rework(['--since', 'HEAD'], outsideDirectory);
    expect(exitCode).toBe(1);
    expect(error).toContain('is not inside a git working tree');
  });

  test('a --since that names no commit is refused at exit 1', async () => {
    const { exitCode, error } = await rework(['--since', 'no-such-commit']);
    expect(exitCode).toBe(1);
    expect(error).toContain('--since "no-such-commit" does not name a commit');
  });

  /** A rebase rewrites the review's start, and the refusal is what tells a reviewer to count before rebasing. */
  test('a --since that is not an ancestor of HEAD is refused at exit 1, and the refusal says to count before rebasing', async () => {
    const reviewStart = buildTheFeatureBranch();
    commitTheReview();
    moveTheMainLine();
    rebaseWithAHandResolution();
    const { exitCode, error } = await rework(['--since', reviewStart]);
    expect(exitCode).toBe(1);
    expect(error).toContain('is not an ancestor of HEAD');
    expect(error).toContain('--rebased-from ORIG_HEAD');
  });

  test('a merge among the commits is refused at exit 1, naming it', async () => {
    const reviewStart = buildTheFeatureBranch();
    gitOrFail(['checkout', '-q', 'main']);
    writeRepositoryFile('lib/mainOnly.ts', 'export const one = 1;\n');
    commitEverything('Main moves');
    gitOrFail(['checkout', '-q', 'feature']);
    gitOrFail(['merge', '-q', '--no-edit', 'main']);
    const mergeCommit = gitOrFail(['rev-parse', 'HEAD']);

    const { exitCode, error } = await rework(['--since', reviewStart]);
    expect(exitCode).toBe(1);
    expect(error).toContain(`include the merge ${mergeCommit.slice(0, 8)}`);
  });

  test('naming nothing to count is refused at exit 1', async () => {
    const { exitCode, error } = await rework([]);
    expect(exitCode).toBe(1);
    expect(error).toContain('Name what to count');
  });

  test('--main without --rebased-from is refused at exit 1 rather than ignored', async () => {
    const { exitCode, error } = await rework(['--since', 'HEAD', '--main', 'main']);
    expect(exitCode).toBe(1);
    expect(error).toContain('only applies with --rebased-from');
  });

  test('a --main that names no branch is refused at exit 1, naming the option to fix', async () => {
    buildTheFeatureBranch();
    const { exitCode, error } = await rework(['--rebased-from', 'HEAD', '--main', 'trunk']);
    expect(exitCode).toBe(1);
    expect(error).toContain('--main "trunk" does not name a commit');
  });
});
