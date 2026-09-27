/**
 * A reader holding the file sees the whole old or the whole new content, never a prefix, and a failed write leaves the old file; links
 * and modes survive, a chain resolving as the kernel resolves it.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { chmod, readFile, readdir } from 'node:fs/promises';
import { join }                     from 'node:path';
import { afterAll, expect, test }   from 'bun:test';

import { createScratchDirectory, removeScratchDirectory }                             from '../../testing/ScratchWorkspace';
import { createFileAtomically, writeFileAtomically, writeFileAtomicallyThroughLinks } from './AtomicFile';

/** Root can write into a directory it has no permission on, so the failure case cannot be staged there. */
const RUNNING_AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

const LARGE_CONTENT_REPEATS = 200_000;
const TARGET_FILE_NAME      = 'document.json';

const scratchDirectories: string[] = [];

function trackedScratchDirectory(): string {
  const directory = createScratchDirectory('atomic-file');
  scratchDirectories.push(directory);
  return directory;
}

// The permission test may have left a directory unwritable, which would stop its removal.
afterAll(async () => {
  for (const directory of scratchDirectories) {
    await chmod(directory, 0o700).catch(() => {});
    removeScratchDirectory(directory);
  }
});

async function unexpectedLeftovers(directory: string, expectedNames: string[]): Promise<string[]> {
  return (await readdir(directory)).filter((name) => !expectedNames.includes(name));
}

test('a reader holding the file across the write sees the whole old content or the whole new one, never a prefix', async () => {
  const directory = trackedScratchDirectory();
  const filePath = join(directory, TARGET_FILE_NAME);
  const oldContent = 'old'.repeat(LARGE_CONTENT_REPEATS);
  const newContent = 'new'.repeat(LARGE_CONTENT_REPEATS);
  writeFileSync(filePath, oldContent);

  // The reads are served off a thread pool while the main thread is blocked inside the synchronous write, so this is a real race.
  const concurrentReads = Array.from({ length: 40 }, () => readFile(filePath, 'utf8'));
  writeFileAtomically(filePath, newContent);
  const observed = await Promise.all(concurrentReads);

  const torn = observed.filter((content) => content !== oldContent && content !== newContent);
  expect(observed.length, 'the burst actually ran').toBe(40);
  expect(torn.map((content) => content.length), 'no reader saw a partial file').toEqual([]);
  expect(readFileSync(filePath, 'utf8')).toBe(newContent);
});

test('a successful write leaves no temporary file beside the target', async () => {
  const directory = trackedScratchDirectory();
  const filePath = join(directory, TARGET_FILE_NAME);
  writeFileAtomically(filePath, '{"version":1}');
  writeFileAtomically(filePath, '{"version":1,"project":"Example Agency"}');
  expect(readFileSync(filePath, 'utf8')).toBe('{"version":1,"project":"Example Agency"}');
  expect(await unexpectedLeftovers(directory, [TARGET_FILE_NAME])).toEqual([]);
});

test('the parent directory is created when it is not there yet', async () => {
  const directory = trackedScratchDirectory();
  const filePath = join(directory, 'example-folder', 'nested', '001-example.md');
  writeFileAtomically(filePath, '# 001 — Example\n');
  expect(readFileSync(filePath, 'utf8')).toBe('# 001 — Example\n');
});

test('a symlinked target stays a symlink and its content lands on the file it points at', async () => {
  const directory = trackedScratchDirectory();
  const realDirectory = join(directory, 'real');
  mkdirSync(realDirectory);
  const realPath = join(realDirectory, TARGET_FILE_NAME);
  const linkPath = join(directory, TARGET_FILE_NAME);
  writeFileSync(realPath, '{"version":1}');
  symlinkSync(realPath, linkPath);

  writeFileAtomically(linkPath, '{"version":1,"project":"Example Agency"}');

  expect(lstatSync(linkPath).isSymbolicLink(), 'the link is still a link').toBe(true);
  expect(readFileSync(realPath, 'utf8')).toBe('{"version":1,"project":"Example Agency"}');
  expect(await unexpectedLeftovers(realDirectory, [TARGET_FILE_NAME])).toEqual([]);
});

test.skipIf(RUNNING_AS_ROOT)('a restricted file comes back with the same permission bits', async () => {
  const directory = trackedScratchDirectory();
  const filePath = join(directory, TARGET_FILE_NAME);
  writeFileSync(filePath, '{"version":1}', { mode: 0o600 });
  writeFileAtomically(filePath, '{"version":1,"project":"Example Agency"}');
  expect(statSync(filePath).mode & 0o777).toBe(0o600);
});

// The mode handed to `open` is masked by the umask, so a group- or world-writable file would lose those bits without an explicit `fchmod`.
test('a file with bits the umask would mask comes back with the same permission bits', async () => {
  const directory = trackedScratchDirectory();
  const filePath = join(directory, TARGET_FILE_NAME);
  writeFileSync(filePath, '{"version":1}');
  chmodSync(filePath, 0o666);
  const previousUmask = process.umask(0o022);
  try {
    writeFileAtomically(filePath, '{"version":1,"project":"Example Agency"}');
  } finally {
    process.umask(previousUmask);
  }
  expect(statSync(filePath).mode & 0o777).toBe(0o666);
});

test.skipIf(RUNNING_AS_ROOT)('a write that cannot be performed leaves the previous file exactly as it was', async () => {
  const directory = trackedScratchDirectory();
  const filePath = join(directory, TARGET_FILE_NAME);
  writeFileSync(filePath, '{"version":1}');
  await chmod(directory, 0o500);

  expect(() => writeFileAtomically(filePath, '{"version":1,"project":"Example Agency"}')).toThrow();

  await chmod(directory, 0o700);
  expect(readFileSync(filePath, 'utf8')).toBe('{"version":1}');
  expect(await unexpectedLeftovers(directory, [TARGET_FILE_NAME])).toEqual([]);
});

test('an empty string is a legitimate content, not a no-op', async () => {
  const directory = trackedScratchDirectory();
  const filePath = join(directory, 'empty.txt');
  writeFileSync(filePath, 'previous');
  writeFileAtomically(filePath, '');
  expect(readFileSync(filePath, 'utf8')).toBe('');
  expect(existsSync(filePath)).toBe(true);
});

test('the create-exclusive write creates a missing file whole and leaves no temporary file beside it', async () => {
  const directory = trackedScratchDirectory();
  const filePath = join(directory, TARGET_FILE_NAME);

  expect(createFileAtomically(filePath, 'created')).toBe('created');

  expect(readFileSync(filePath, 'utf8')).toBe('created');
  expect(await unexpectedLeftovers(directory, [TARGET_FILE_NAME])).toEqual([]);
});

// The guarantee a first write rests on: no path through it can truncate a file that already exists.
test('the create-exclusive write refuses an existing file, leaving its bytes and no temporary file behind', async () => {
  const directory = trackedScratchDirectory();
  const filePath = join(directory, TARGET_FILE_NAME);
  writeFileSync(filePath, 'existing content');

  expect(createFileAtomically(filePath, 'new content')).toBe('already-exists');

  expect(readFileSync(filePath, 'utf8')).toBe('existing content');
  expect(await unexpectedLeftovers(directory, [TARGET_FILE_NAME])).toEqual([]);
});

/** `temporary/dotfiles` is a symlinked folder, and the link inside it climbs out with `..`: spelled, that lands on `temporary/shared`. */
function linkChainThroughASymlinkedFolder(directory: string): { linkPath: string; realPath: string; spelledStrayFolder: string } {
  mkdirSync(join(directory, 'Dropbox', 'dotfiles'), { recursive: true });
  mkdirSync(join(directory, 'Dropbox', 'shared'));
  mkdirSync(join(directory, 'repository'));
  symlinkSync(join(directory, 'Dropbox', 'dotfiles'), join(directory, 'dotfiles'));
  symlinkSync('../shared/CLAUDE.md', join(directory, 'Dropbox', 'dotfiles', 'CLAUDE.md'));
  const linkPath = join(directory, 'repository', 'CLAUDE.md');
  symlinkSync('../dotfiles/CLAUDE.md', linkPath);
  return { linkPath, realPath: join(directory, 'Dropbox', 'shared', 'CLAUDE.md'), spelledStrayFolder: join(directory, 'shared') };
}

test('writing through a relative dangling link keeps the link and creates its target beside the folder the link sits in', async () => {
  const directory = trackedScratchDirectory();
  mkdirSync(join(directory, 'case'));
  mkdirSync(join(directory, 'shared'));
  const linkPath = join(directory, 'case', 'CLAUDE.md');
  symlinkSync('../shared/CLAUDE.md', linkPath);

  writeFileAtomicallyThroughLinks(linkPath, '# Example Agency\n');

  expect(lstatSync(linkPath).isSymbolicLink(), 'the link is still a link').toBe(true);
  expect(readlinkSync(linkPath)).toBe('../shared/CLAUDE.md');
  expect(readFileSync(join(directory, 'shared', 'CLAUDE.md'), 'utf8')).toBe('# Example Agency\n');
});

test('writing through a two-hop dangling chain keeps both links and creates the last, missing path', async () => {
  const directory = trackedScratchDirectory();
  const firstLinkPath = join(directory, 'CLAUDE.md');
  const secondLinkPath = join(directory, 'AGENTS.md');
  symlinkSync('AGENTS.md', firstLinkPath);
  symlinkSync('missing-instructions.md', secondLinkPath);

  writeFileAtomicallyThroughLinks(firstLinkPath, '# Example Agency\n');

  expect(lstatSync(firstLinkPath).isSymbolicLink()).toBe(true);
  expect(lstatSync(secondLinkPath).isSymbolicLink()).toBe(true);
  expect(readFileSync(join(directory, 'missing-instructions.md'), 'utf8')).toBe('# Example Agency\n');
});

test('a path that is no link, present or absent, is written in place', async () => {
  const directory = trackedScratchDirectory();
  const presentPath = join(directory, 'CLAUDE.md');
  const absentPath = join(directory, 'absent.md');
  writeFileSync(presentPath, '# Example Agency\n');

  writeFileAtomicallyThroughLinks(presentPath, 'rewritten\n');
  writeFileAtomicallyThroughLinks(absentPath, 'created\n');

  expect(readFileSync(presentPath, 'utf8')).toBe('rewritten\n');
  expect(readFileSync(absentPath, 'utf8')).toBe('created\n');
  expect(await unexpectedLeftovers(directory, ['CLAUDE.md', 'absent.md'])).toEqual([]);
});

// Following a relative hop by its spelling would write a stray file under `temporary/shared` and leave the real file unchanged.
test('a live chain whose relative hop climbs out of a symlinked folder writes the file the kernel resolves', async () => {
  const directory = trackedScratchDirectory();
  const { linkPath, realPath, spelledStrayFolder } = linkChainThroughASymlinkedFolder(directory);
  writeFileSync(realPath, '# Real\n');

  writeFileAtomicallyThroughLinks(linkPath, '# Rewritten\n');

  expect(readFileSync(realPath, 'utf8')).toBe('# Rewritten\n');
  expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
  expect(existsSync(spelledStrayFolder), 'no stray folder at the spelled path').toBe(false);
});

test('a dangling chain whose relative hop climbs out of a symlinked folder creates its target under the physical folder', async () => {
  const directory = trackedScratchDirectory();
  const { linkPath, realPath, spelledStrayFolder } = linkChainThroughASymlinkedFolder(directory);

  writeFileAtomicallyThroughLinks(linkPath, '# Created\n');

  expect(readFileSync(realPath, 'utf8')).toBe('# Created\n');
  expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
  expect(existsSync(spelledStrayFolder), 'no stray folder at the spelled path').toBe(false);
});

// Answering the link itself would let the rename replace the link with a regular file.
test('a link cycle is refused with ELOOP and stays a link', async () => {
  const directory = trackedScratchDirectory();
  const firstLinkPath = join(directory, 'first.md');
  symlinkSync('second.md', firstLinkPath);
  symlinkSync('first.md', join(directory, 'second.md'));

  expect(() => writeFileAtomicallyThroughLinks(firstLinkPath, 'content')).toThrow(expect.objectContaining({ code: 'ELOOP' }));

  expect(lstatSync(firstLinkPath).isSymbolicLink()).toBe(true);
  expect(readlinkSync(firstLinkPath)).toBe('second.md');
  expect(await unexpectedLeftovers(directory, ['first.md', 'second.md'])).toEqual([]);
});

test('a dangling link into a folder that does not exist is refused with ENOENT and creates no folder', async () => {
  const directory = trackedScratchDirectory();
  const linkPath = join(directory, 'CLAUDE.md');
  symlinkSync('missing-folder/CLAUDE.md', linkPath);

  expect(() => writeFileAtomicallyThroughLinks(linkPath, 'content')).toThrow(expect.objectContaining({ code: 'ENOENT' }));

  expect(existsSync(join(directory, 'missing-folder'))).toBe(false);
  expect(readlinkSync(linkPath)).toBe('missing-folder/CLAUDE.md');
});
