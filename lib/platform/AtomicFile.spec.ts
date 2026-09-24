/**
 * `writeFileAtomically` against its own contract: a reader holding the file across the write sees the
 * whole old or the whole new content and never a prefix, a symlink and its mode survive, and a failed
 * write leaves the previous file untouched.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'fs';
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm
} from 'fs/promises';
import { tmpdir }                 from 'os';
import { join }                   from 'path';
import { afterAll, expect, test } from 'bun:test';

import { writeFileAtomically } from './AtomicFile';

/** Root can write into a directory it has no permission on, so the failure case cannot be staged there. */
const RUNNING_AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

const LARGE_CONTENT_REPEATS = 200_000;

const scratchDirectories: string[] = [];

async function createScratchDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-progress-atomic-file-'));
  scratchDirectories.push(directory);
  return directory;
}

afterAll(async () => {
  for (const directory of scratchDirectories) {
    await chmod(directory, 0o700).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

async function unexpectedLeftovers(directory: string, expectedNames: string[]): Promise<string[]> {
  return (await readdir(directory)).filter((name) => !expectedNames.includes(name));
}

test('a reader holding the file across the write sees the whole old content or the whole new one, never a prefix', async () => {
  const directory = await createScratchDirectory();
  const filePath = join(directory, 'progress.json');
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
  const directory = await createScratchDirectory();
  const filePath = join(directory, 'progress.json');
  writeFileAtomically(filePath, '{"version":1}');
  writeFileAtomically(filePath, '{"version":1,"project":"Example Agency"}');
  expect(readFileSync(filePath, 'utf8')).toBe('{"version":1,"project":"Example Agency"}');
  expect(await unexpectedLeftovers(directory, ['progress.json'])).toEqual([]);
});

test('the parent directory is created when it is not there yet', async () => {
  const directory = await createScratchDirectory();
  const filePath = join(directory, '.agent-progress', 'tickets', '001-example-ticket.md');
  writeFileAtomically(filePath, '# 001 — Example ticket\n');
  expect(readFileSync(filePath, 'utf8')).toBe('# 001 — Example ticket\n');
});

test('a symlinked target stays a symlink and its content lands on the file it points at', async () => {
  const directory = await createScratchDirectory();
  const realDirectory = join(directory, 'real');
  mkdirSync(realDirectory);
  const realPath = join(realDirectory, 'progress.json');
  const linkPath = join(directory, 'progress.json');
  writeFileSync(realPath, '{"version":1}');
  symlinkSync(realPath, linkPath);

  writeFileAtomically(linkPath, '{"version":1,"project":"Example Agency"}');

  expect(lstatSync(linkPath).isSymbolicLink(), 'the link is still a link').toBe(true);
  expect(readFileSync(realPath, 'utf8')).toBe('{"version":1,"project":"Example Agency"}');
  expect(await unexpectedLeftovers(realDirectory, ['progress.json'])).toEqual([]);
});

test.skipIf(RUNNING_AS_ROOT)('a restricted file comes back with the same permission bits', async () => {
  const directory = await createScratchDirectory();
  const filePath = join(directory, 'progress.json');
  writeFileSync(filePath, '{"version":1}', { mode: 0o600 });
  writeFileAtomically(filePath, '{"version":1,"project":"Example Agency"}');
  expect(statSync(filePath).mode & 0o777).toBe(0o600);
});

// The mode handed to `open` is masked by the umask, so a group- or world-writable file would lose those bits without an explicit `fchmod`.
test('a file with bits the umask would mask comes back with the same permission bits', async () => {
  const directory = await createScratchDirectory();
  const filePath = join(directory, 'progress.json');
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
  const directory = await createScratchDirectory();
  const filePath = join(directory, 'progress.json');
  writeFileSync(filePath, '{"version":1}');
  await chmod(directory, 0o500);

  expect(() => writeFileAtomically(filePath, '{"version":1,"project":"Example Agency"}')).toThrow();

  await chmod(directory, 0o700);
  expect(readFileSync(filePath, 'utf8')).toBe('{"version":1}');
  expect(await unexpectedLeftovers(directory, ['progress.json'])).toEqual([]);
});

test('an empty string is a legitimate content, not a no-op', async () => {
  const directory = await createScratchDirectory();
  const filePath = join(directory, 'empty.txt');
  writeFileSync(filePath, 'previous');
  writeFileAtomically(filePath, '');
  expect(readFileSync(filePath, 'utf8')).toBe('');
  expect(existsSync(filePath)).toBe(true);
});
