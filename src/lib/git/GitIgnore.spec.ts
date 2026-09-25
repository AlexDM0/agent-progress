/**
 * What `init` does to a repository's `.gitignore` and, mostly, when it does nothing: any pattern that
 * already covers the tracker must produce no diff, and a plain directory gains no file nobody asked for.
 * A symlinked (even dangling) or permission-restricted `.gitignore` survives the append as it was, replaced whole rather than rewritten in place;
 * a link chain resolves as the kernel resolves it, and a link cycle or a dangling link into a missing folder is refused as a plain write was.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
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
} from '../../testing/ScratchWorkspace';
import { ensureIgnored } from './GitIgnore';

const IGNORED_DIRECTORY_NAME = '.agent-progress';

const OWNER_READ_WRITE_GROUP_READ_MODE = 0o640;

const PERMISSION_BITS = 0o777;

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
    expect(ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toBe('appended');
    expect(gitIgnoreIn(repositoryDirectory)).toBe('.agent-progress/\n');
  });

  test('running init twice does not add the line twice', () => {
    const repositoryDirectory = scratchRepository('gitignore-idempotent');
    expect(ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toBe('appended');
    expect(ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toBe('already-ignored');
    expect(gitIgnoreIn(repositoryDirectory)).toBe('.agent-progress/\n');
  });

  test('a broader pattern that already covers the tracker produces no diff at all', () => {
    const repositoryDirectory = scratchRepository('gitignore-broad-pattern');
    writeFileSync(join(repositoryDirectory, '.gitignore'), '.*\n!.gitignore\n');
    expect(ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toBe('already-ignored');
    expect(gitIgnoreIn(repositoryDirectory)).toBe('.*\n!.gitignore\n');
  });

  test('a rule inherited from .git/info/exclude counts as ignored too', () => {
    const repositoryDirectory = scratchRepository('gitignore-info-exclude');
    writeFileSync(join(repositoryDirectory, '.git', 'info', 'exclude'), '.agent-progress/\n');
    expect(ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toBe('already-ignored');
    expect(existsSync(join(repositoryDirectory, '.gitignore'))).toBe(false);
  });

  test('a directory-form rule is recognised before the tracker directory exists, which is when init asks', () => {
    // `git check-ignore` answers "not ignored" for a `.agent-progress/` rule unless the probe carries the trailing slash.
    const repositoryDirectory = scratchRepository('gitignore-directory-form-rule');
    writeFileSync(join(repositoryDirectory, '.git', 'info', 'exclude'), '.agent-progress/\n');
    expect(existsSync(join(repositoryDirectory, '.agent-progress')), 'nothing has been created yet').toBe(false);
    expect(ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toBe('already-ignored');
  });

  test('an existing .gitignore keeps everything it had and gains one line', () => {
    const repositoryDirectory = scratchRepository('gitignore-appended');
    writeFileSync(join(repositoryDirectory, '.gitignore'), 'node_modules/\ndist/\n');
    expect(ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toBe('appended');
    expect(gitIgnoreIn(repositoryDirectory)).toBe('node_modules/\ndist/\n.agent-progress/\n');
  });

  test('a file that does not end in a newline gets one before the new line, not after the last rule', () => {
    const repositoryDirectory = scratchRepository('gitignore-no-final-newline');
    writeFileSync(join(repositoryDirectory, '.gitignore'), 'node_modules/');
    expect(ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toBe('appended');
    expect(gitIgnoreIn(repositoryDirectory)).toBe('node_modules/\n.agent-progress/\n');
  });

  test('a file written with CRLF keeps CRLF', () => {
    const repositoryDirectory = scratchRepository('gitignore-crlf');
    writeFileSync(join(repositoryDirectory, '.gitignore'), 'node_modules/\r\ndist/\r\n');
    expect(ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toBe('appended');
    expect(gitIgnoreIn(repositoryDirectory)).toBe('node_modules/\r\ndist/\r\n.agent-progress/\r\n');
  });

  test('a dangling .gitignore link stays a link and its missing target is created holding the tracker line', () => {
    const repositoryDirectory = scratchRepository('gitignore-dangling-symlink');
    const linkPath = join(repositoryDirectory, '.gitignore');
    symlinkSync('shared-gitignore', linkPath);

    expect(ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toBe('appended');

    expect(lstatSync(linkPath).isSymbolicLink(), 'the link is still a link').toBe(true);
    expect(readlinkSync(linkPath)).toBe('shared-gitignore');
    expect(readFileSync(join(repositoryDirectory, 'shared-gitignore'), 'utf8')).toBe('.agent-progress/\n');
  });

  test('a .gitignore link chain whose relative hop climbs out of a symlinked folder is written where the kernel resolves it', () => {
    const repositoryDirectory = scratchRepository('gitignore-symlinked-folder-chain');
    const outsideDirectory = scratchDirectory('gitignore-symlinked-folder-chain-outside');
    mkdirSync(join(outsideDirectory, 'Dropbox', 'dotfiles'), { recursive: true });
    mkdirSync(join(outsideDirectory, 'Dropbox', 'shared'));
    const realPath = join(outsideDirectory, 'Dropbox', 'shared', 'gitignore');
    writeFileSync(realPath, 'node_modules/\n');
    symlinkSync(join(outsideDirectory, 'Dropbox', 'dotfiles'), join(outsideDirectory, 'dotfiles'));
    symlinkSync('../shared/gitignore', join(outsideDirectory, 'Dropbox', 'dotfiles', 'gitignore'));
    const linkPath = join(repositoryDirectory, '.gitignore');
    symlinkSync(join(outsideDirectory, 'dotfiles', 'gitignore'), linkPath);

    expect(ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toBe('appended');
    expect(ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toBe('already-ignored');

    expect(readFileSync(realPath, 'utf8')).toBe('node_modules/\n.agent-progress/\n');
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(outsideDirectory, 'Dropbox', 'dotfiles', 'gitignore')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(outsideDirectory, 'shared')), 'no stray folder at the spelled path').toBe(false);
  });

  test('a dangling .gitignore link into a missing folder is refused with ENOENT and creates no folder', () => {
    const repositoryDirectory = scratchRepository('gitignore-dangling-into-missing-folder');
    const linkPath = join(repositoryDirectory, '.gitignore');
    symlinkSync('missing-folder/shared-gitignore', linkPath);

    expect(() => ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toThrow(expect.objectContaining({ code: 'ENOENT' }));

    expect(existsSync(join(repositoryDirectory, 'missing-folder'))).toBe(false);
    expect(readlinkSync(linkPath)).toBe('missing-folder/shared-gitignore');
  });

  // A cycle answered with the link itself would let the rename replace the link with a regular file.
  test('a .gitignore link cycle is refused with ELOOP and stays a link', () => {
    const repositoryDirectory = scratchRepository('gitignore-symlink-cycle');
    const linkPath = join(repositoryDirectory, '.gitignore');
    symlinkSync('other-ignore', linkPath);
    symlinkSync('.gitignore', join(repositoryDirectory, 'other-ignore'));

    expect(() => ensureIgnored(repositoryDirectory, IGNORED_DIRECTORY_NAME)).toThrow(expect.objectContaining({ code: 'ELOOP' }));

    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkPath)).toBe('other-ignore');
  });
});

test('the exact line without a trailing slash is recognised, because that is what a person writes by hand', () => {
  const plainDirectory = scratchDirectory('gitignore-no-slash');
  writeFileSync(join(plainDirectory, '.gitignore'), '.agent-progress\n');
  expect(ensureIgnored(plainDirectory, IGNORED_DIRECTORY_NAME)).toBe('already-ignored');
});

test('a line with surrounding whitespace is still that line', () => {
  const plainDirectory = scratchDirectory('gitignore-whitespace');
  writeFileSync(join(plainDirectory, '.gitignore'), 'node_modules/\n  .agent-progress/  \n');
  expect(ensureIgnored(plainDirectory, IGNORED_DIRECTORY_NAME)).toBe('already-ignored');
});

test('a negation is not mistaken for the rule it negates', () => {
  const plainDirectory = scratchDirectory('gitignore-negation');
  writeFileSync(join(plainDirectory, '.gitignore'), '!.agent-progress\n');
  expect(ensureIgnored(plainDirectory, IGNORED_DIRECTORY_NAME)).toBe('appended');
  expect(gitIgnoreIn(plainDirectory)).toBe('!.agent-progress\n.agent-progress/\n');
});

test('a directory that is no repository and has no .gitignore is left entirely alone', () => {
  const plainDirectory = scratchDirectory('gitignore-not-a-repository');
  expect(ensureIgnored(plainDirectory, IGNORED_DIRECTORY_NAME)).toBe('no-gitignore-written');
  expect(existsSync(join(plainDirectory, '.gitignore'))).toBe(false);
});

test('a directory that is no repository but already has a .gitignore still gains the line', () => {
  const plainDirectory = scratchDirectory('gitignore-not-a-repository-with-file');
  writeFileSync(join(plainDirectory, '.gitignore'), 'node_modules/\n');
  expect(ensureIgnored(plainDirectory, IGNORED_DIRECTORY_NAME)).toBe('appended');
  expect(gitIgnoreIn(plainDirectory)).toBe('node_modules/\n.agent-progress/\n');
});

test('a symlinked .gitignore stays a symlink and the line lands on the file it points at', () => {
  const plainDirectory = scratchDirectory('gitignore-symlink');
  const sharedConfigDirectory = join(plainDirectory, 'shared-config');
  mkdirSync(sharedConfigDirectory);
  const realPath = join(sharedConfigDirectory, 'gitignore');
  const linkPath = join(plainDirectory, '.gitignore');
  writeFileSync(realPath, 'node_modules/\n');
  symlinkSync(realPath, linkPath);

  expect(ensureIgnored(plainDirectory, IGNORED_DIRECTORY_NAME)).toBe('appended');

  expect(lstatSync(linkPath).isSymbolicLink(), 'the link is still a link').toBe(true);
  expect(readFileSync(realPath, 'utf8')).toBe('node_modules/\n.agent-progress/\n');
});

test('an existing .gitignore keeps its permission bits', () => {
  const plainDirectory = scratchDirectory('gitignore-mode');
  const gitIgnorePath = join(plainDirectory, '.gitignore');
  writeFileSync(gitIgnorePath, 'node_modules/\n');
  chmodSync(gitIgnorePath, OWNER_READ_WRITE_GROUP_READ_MODE);
  expect(ensureIgnored(plainDirectory, IGNORED_DIRECTORY_NAME)).toBe('appended');
  expect(statSync(gitIgnorePath).mode & PERMISSION_BITS).toBe(OWNER_READ_WRITE_GROUP_READ_MODE);
});

test('the .gitignore is replaced rather than rewritten in place, and no temporary file is left beside it', () => {
  const plainDirectory = scratchDirectory('gitignore-replaced-not-rewritten');
  const gitIgnorePath = join(plainDirectory, '.gitignore');
  writeFileSync(gitIgnorePath, 'node_modules/\n');
  const inodeBeforeWrite = statSync(gitIgnorePath).ino;
  expect(ensureIgnored(plainDirectory, IGNORED_DIRECTORY_NAME)).toBe('appended');
  expect(statSync(gitIgnorePath).ino).not.toBe(inodeBeforeWrite);
  expect(readdirSync(plainDirectory)).toEqual(['.gitignore']);
});
