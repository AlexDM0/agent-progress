/**
 * What `init` does to a repository's `.gitignore` and, mostly, when it does nothing: any pattern that
 * already covers the tracker must produce no diff, and a plain directory gains no file nobody asked for.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                    from 'node:path';
import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import {
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
} from '../tooling/dev/ScratchWorkspace';
import { ensureIgnored } from './GitIgnore';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchRepository(prefix: string): string {
  const repositoryDirectory = createScratchGitRepository(prefix);
  scratchDirectories.push(repositoryDirectory);
  return repositoryDirectory;
}

function scratchDirectory(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return directory;
}

const gitIgnoreIn = (directory: string): string => readFileSync(join(directory, '.gitignore'), 'utf8');

describe.skipIf(!gitIsAvailable())('in a git repository', () => {
  test('a repository with no .gitignore gets one holding exactly the tracker directory', () => {
    const repositoryDirectory = scratchRepository('gitignore-created');
    expect(ensureIgnored(repositoryDirectory)).toBe('appended');
    expect(gitIgnoreIn(repositoryDirectory)).toBe('.agent-progress/\n');
  });

  test('running init twice does not add the line twice', () => {
    const repositoryDirectory = scratchRepository('gitignore-idempotent');
    expect(ensureIgnored(repositoryDirectory)).toBe('appended');
    expect(ensureIgnored(repositoryDirectory)).toBe('already-ignored');
    expect(gitIgnoreIn(repositoryDirectory)).toBe('.agent-progress/\n');
  });

  test('a broader pattern that already covers the tracker produces no diff at all', () => {
    const repositoryDirectory = scratchRepository('gitignore-broad-pattern');
    writeFileSync(join(repositoryDirectory, '.gitignore'), '.*\n!.gitignore\n');
    expect(ensureIgnored(repositoryDirectory)).toBe('already-ignored');
    expect(gitIgnoreIn(repositoryDirectory)).toBe('.*\n!.gitignore\n');
  });

  test('a rule inherited from .git/info/exclude counts as ignored too', () => {
    const repositoryDirectory = scratchRepository('gitignore-info-exclude');
    writeFileSync(join(repositoryDirectory, '.git', 'info', 'exclude'), '.agent-progress/\n');
    expect(ensureIgnored(repositoryDirectory)).toBe('already-ignored');
    expect(existsSync(join(repositoryDirectory, '.gitignore'))).toBe(false);
  });

  test('a directory-form rule is recognised before the tracker directory exists, which is when init asks', () => {
    // `git check-ignore` answers "not ignored" for a `.agent-progress/` rule unless the probe carries the trailing slash.
    const repositoryDirectory = scratchRepository('gitignore-directory-form-rule');
    writeFileSync(join(repositoryDirectory, '.git', 'info', 'exclude'), '.agent-progress/\n');
    expect(existsSync(join(repositoryDirectory, '.agent-progress')), 'nothing has been created yet').toBe(false);
    expect(ensureIgnored(repositoryDirectory)).toBe('already-ignored');
  });

  test('an existing .gitignore keeps everything it had and gains one line', () => {
    const repositoryDirectory = scratchRepository('gitignore-appended');
    writeFileSync(join(repositoryDirectory, '.gitignore'), 'node_modules/\ndist/\n');
    expect(ensureIgnored(repositoryDirectory)).toBe('appended');
    expect(gitIgnoreIn(repositoryDirectory)).toBe('node_modules/\ndist/\n.agent-progress/\n');
  });

  test('a file that does not end in a newline gets one before the new line, not after the last rule', () => {
    const repositoryDirectory = scratchRepository('gitignore-no-final-newline');
    writeFileSync(join(repositoryDirectory, '.gitignore'), 'node_modules/');
    expect(ensureIgnored(repositoryDirectory)).toBe('appended');
    expect(gitIgnoreIn(repositoryDirectory)).toBe('node_modules/\n.agent-progress/\n');
  });

  test('a file written with CRLF keeps CRLF', () => {
    const repositoryDirectory = scratchRepository('gitignore-crlf');
    writeFileSync(join(repositoryDirectory, '.gitignore'), 'node_modules/\r\ndist/\r\n');
    expect(ensureIgnored(repositoryDirectory)).toBe('appended');
    expect(gitIgnoreIn(repositoryDirectory)).toBe('node_modules/\r\ndist/\r\n.agent-progress/\r\n');
  });
});

test('the exact line without a trailing slash is recognised, because that is what a person writes by hand', () => {
  const plainDirectory = scratchDirectory('gitignore-no-slash');
  writeFileSync(join(plainDirectory, '.gitignore'), '.agent-progress\n');
  expect(ensureIgnored(plainDirectory)).toBe('already-ignored');
});

test('a line with surrounding whitespace is still that line', () => {
  const plainDirectory = scratchDirectory('gitignore-whitespace');
  writeFileSync(join(plainDirectory, '.gitignore'), 'node_modules/\n  .agent-progress/  \n');
  expect(ensureIgnored(plainDirectory)).toBe('already-ignored');
});

test('a negation is not mistaken for the rule it negates', () => {
  const plainDirectory = scratchDirectory('gitignore-negation');
  writeFileSync(join(plainDirectory, '.gitignore'), '!.agent-progress\n');
  expect(ensureIgnored(plainDirectory)).toBe('appended');
  expect(gitIgnoreIn(plainDirectory)).toBe('!.agent-progress\n.agent-progress/\n');
});

test('a directory that is no repository and has no .gitignore is left entirely alone', () => {
  const plainDirectory = scratchDirectory('gitignore-not-a-repository');
  expect(ensureIgnored(plainDirectory)).toBe('no-gitignore-written');
  expect(existsSync(join(plainDirectory, '.gitignore'))).toBe(false);
});

test('a directory that is no repository but already has a .gitignore still gains the line', () => {
  const plainDirectory = scratchDirectory('gitignore-not-a-repository-with-file');
  writeFileSync(join(plainDirectory, '.gitignore'), 'node_modules/\n');
  expect(ensureIgnored(plainDirectory)).toBe('appended');
  expect(gitIgnoreIn(plainDirectory)).toBe('node_modules/\n.agent-progress/\n');
});
