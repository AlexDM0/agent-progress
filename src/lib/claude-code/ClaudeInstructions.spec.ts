/**
 * What the tool may do to somebody's `CLAUDE.md`: everything outside the managed region survives byte
 * for byte, a start marker with no end is refused, and a symlinked file stays a symlink, dangling or not, with a chain
 * resolved as the kernel resolves it. A link cycle or a dangling link into a missing folder is refused as a plain write was.
 * The file is replaced whole, never rewritten in place, and its permission bits survive the replacement.
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
import { dirname, join }          from 'node:path';
import { afterAll, expect, test } from 'bun:test';

import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace';
import { writeManagedBlock }                              from './ClaudeInstructions';

const MANAGED_BLOCK_MARKERS = { start: '<!-- example-tool:managed:start -->', end: '<!-- example-tool:managed:end -->' };

const BLOCK_BODY = 'This repository is managed by example-tool.';
const EXPECTED_BLOCK = `${MANAGED_BLOCK_MARKERS.start}\n${BLOCK_BODY}\n${MANAGED_BLOCK_MARKERS.end}`;

const OWNER_READ_WRITE_GROUP_READ_MODE = 0o640;

const PERMISSION_BITS = 0o777;

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchDirectory(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return directory;
}

function claudeFileWith(prefix: string, content: string | null): string {
  const claudeFilePath = join(scratchDirectory(prefix), 'CLAUDE.md');
  if (content !== null) writeFileSync(claudeFilePath, content);
  return claudeFilePath;
}

test('an absent file is created holding the block and nothing else', () => {
  const claudeFilePath = claudeFileWith('claude-created', null);
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('created');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`${EXPECTED_BLOCK}\n`);
});

test('a file with no markers keeps everything it had and gains the block after a blank line', () => {
  const claudeFilePath = claudeFileWith('claude-appended', '# Example Agency\n\nRun the tests before pushing.\n');
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('appended');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`# Example Agency\n\nRun the tests before pushing.\n\n${EXPECTED_BLOCK}\n`);
});

test('appending to a file that does not end in a newline still produces a markdown document', () => {
  const claudeFilePath = claudeFileWith('claude-appended-no-newline', '# Example Agency');
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('appended');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`# Example Agency\n\n${EXPECTED_BLOCK}\n`);
});

test('one marker pair is replaced in place, with everything around it byte for byte intact', () => {
  const before = '# Example Agency\n\nRun the tests before pushing.\n\n';
  const after = '\n\n## Local conventions\n\nAlex Example reviews every migration.\n';
  const claudeFilePath = claudeFileWith('claude-replaced', `${before}${MANAGED_BLOCK_MARKERS.start}\nan older instruction\n${MANAGED_BLOCK_MARKERS.end}${after}`);
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('replaced');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`${before}${EXPECTED_BLOCK}${after}`);
});

test('replacing twice in a row changes nothing the second time', () => {
  const claudeFilePath = claudeFileWith('claude-replaced-twice', '# Example Agency\n');
  writeManagedBlock(claudeFilePath, BLOCK_BODY, MANAGED_BLOCK_MARKERS);
  const afterFirstWrite = readFileSync(claudeFilePath, 'utf8');
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('replaced');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(afterFirstWrite);
});

test('with two marker pairs only the first is rewritten, and the second is left standing', () => {
  const secondPair = `${MANAGED_BLOCK_MARKERS.start}\na stale copy somebody pasted\n${MANAGED_BLOCK_MARKERS.end}`;
  const claudeFilePath = claudeFileWith(
    'claude-two-pairs',
    `${MANAGED_BLOCK_MARKERS.start}\nan older instruction\n${MANAGED_BLOCK_MARKERS.end}\n\nmiddle text\n\n${secondPair}\n`,
  );
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('replaced');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`${EXPECTED_BLOCK}\n\nmiddle text\n\n${secondPair}\n`);
});

test('a start marker with no end marker is refused and the file is not touched at all', () => {
  const originalContent = `# Example Agency\n\n${MANAGED_BLOCK_MARKERS.start}\nsomething truncated the end marker\n`;
  const claudeFilePath = claudeFileWith('claude-start-without-end', originalContent);
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('refused-start-without-end');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(originalContent);
});

test('an end marker standing alone before the real pair is inert, not a broken fence', () => {
  // The end marker is searched for after the start marker, which is what makes a stray one harmless.
  const claudeFilePath = claudeFileWith(
    'claude-stray-end',
    `${MANAGED_BLOCK_MARKERS.end}\n\n# Example Agency\n\n${MANAGED_BLOCK_MARKERS.start}\nan older instruction\n${MANAGED_BLOCK_MARKERS.end}\n`,
  );
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('replaced');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`${MANAGED_BLOCK_MARKERS.end}\n\n# Example Agency\n\n${EXPECTED_BLOCK}\n`);
});

test('a symlinked CLAUDE.md stays a symlink and the content lands on the file it points at', () => {
  const directory = scratchDirectory('claude-symlink');
  const realDirectory = join(directory, 'config-repository');
  mkdirSync(realDirectory);
  const realPath = join(realDirectory, 'CLAUDE.md');
  const linkPath = join(directory, 'CLAUDE.md');
  writeFileSync(realPath, '# Example Agency\n');
  symlinkSync(realPath, linkPath);

  expect(writeManagedBlock(linkPath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('appended');

  expect(lstatSync(linkPath).isSymbolicLink(), 'the link is still a link').toBe(true);
  expect(readFileSync(realPath, 'utf8')).toBe(`# Example Agency\n\n${EXPECTED_BLOCK}\n`);
});

test('a multi-line body is written between the markers exactly as given', () => {
  const multiLineBody = '## Example section\n\n- Run `example-tool check` at session start.\n- Keep this list short.';
  const claudeFilePath = claudeFileWith('claude-multiline-body', null);
  expect(writeManagedBlock(claudeFilePath, multiLineBody, MANAGED_BLOCK_MARKERS)).toBe('created');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`${MANAGED_BLOCK_MARKERS.start}\n${multiLineBody}\n${MANAGED_BLOCK_MARKERS.end}\n`);
});

test('an existing CLAUDE.md keeps its permission bits across the rewrite', () => {
  const claudeFilePath = claudeFileWith('claude-mode', '# Example Agency\n');
  chmodSync(claudeFilePath, OWNER_READ_WRITE_GROUP_READ_MODE);
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('appended');
  expect(statSync(claudeFilePath).mode & PERMISSION_BITS).toBe(OWNER_READ_WRITE_GROUP_READ_MODE);
});

// A reader holding the old file open keeps reading the old bytes only when the file is replaced by a rename.
test('the file is replaced rather than rewritten in place, and no temporary file is left beside it', () => {
  const claudeFilePath = claudeFileWith('claude-replaced-not-rewritten', '# Example Agency\n');
  const inodeBeforeWrite = statSync(claudeFilePath).ino;
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('appended');
  expect(statSync(claudeFilePath).ino).not.toBe(inodeBeforeWrite);
  expect(readdirSync(dirname(claudeFilePath))).toEqual(['CLAUDE.md']);
});

test('a symlinked CLAUDE.md keeps the mode of the file it points at', () => {
  const directory = scratchDirectory('claude-symlink-mode');
  const realDirectory = join(directory, 'config-repository');
  mkdirSync(realDirectory);
  const realPath = join(realDirectory, 'CLAUDE.md');
  const linkPath = join(directory, 'CLAUDE.md');
  writeFileSync(realPath, '# Example Agency\n');
  chmodSync(realPath, OWNER_READ_WRITE_GROUP_READ_MODE);
  symlinkSync(realPath, linkPath);

  expect(writeManagedBlock(linkPath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('appended');

  expect(lstatSync(linkPath).isSymbolicLink(), 'the link is still a link').toBe(true);
  expect(readFileSync(realPath, 'utf8')).toBe(`# Example Agency\n\n${EXPECTED_BLOCK}\n`);
  expect(statSync(realPath).mode & PERMISSION_BITS).toBe(OWNER_READ_WRITE_GROUP_READ_MODE);
});

test('a dangling CLAUDE.md link stays a link and its missing target is created with the block', () => {
  const directory = scratchDirectory('claude-dangling-symlink');
  const linkPath = join(directory, 'CLAUDE.md');
  symlinkSync('AGENTS.md', linkPath);

  expect(writeManagedBlock(linkPath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('created');

  expect(lstatSync(linkPath).isSymbolicLink(), 'the link is still a link').toBe(true);
  expect(readlinkSync(linkPath)).toBe('AGENTS.md');
  expect(readFileSync(join(directory, 'AGENTS.md'), 'utf8')).toBe(`${EXPECTED_BLOCK}\n`);
});

test('a dangling link into a sibling folder is resolved against the link, not the working directory', () => {
  const directory = scratchDirectory('claude-dangling-relative-symlink');
  mkdirSync(join(directory, 'case'));
  mkdirSync(join(directory, 'shared'));
  const linkPath = join(directory, 'case', 'CLAUDE.md');
  symlinkSync('../shared/CLAUDE.md', linkPath);

  expect(writeManagedBlock(linkPath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('created');

  expect(lstatSync(linkPath).isSymbolicLink(), 'the link is still a link').toBe(true);
  expect(readFileSync(join(directory, 'shared', 'CLAUDE.md'), 'utf8')).toBe(`${EXPECTED_BLOCK}\n`);
});

test('writes through a link chain whose relative hop climbs out of a symlinked folder, as the kernel resolves it', () => {
  const directory = scratchDirectory('claude-symlinked-folder-chain');
  mkdirSync(join(directory, 'Dropbox', 'dotfiles'), { recursive: true });
  mkdirSync(join(directory, 'Dropbox', 'shared'));
  mkdirSync(join(directory, 'repository'));
  const realPath = join(directory, 'Dropbox', 'shared', 'CLAUDE.md');
  writeFileSync(realPath, '# Real\n');
  symlinkSync(join(directory, 'Dropbox', 'dotfiles'), join(directory, 'dotfiles'));
  symlinkSync('../shared/CLAUDE.md', join(directory, 'Dropbox', 'dotfiles', 'CLAUDE.md'));
  const linkPath = join(directory, 'repository', 'CLAUDE.md');
  symlinkSync(join(directory, 'dotfiles', 'CLAUDE.md'), linkPath);

  expect(writeManagedBlock(linkPath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('appended');
  expect(writeManagedBlock(linkPath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toBe('replaced');

  expect(readFileSync(realPath, 'utf8')).toBe(`# Real\n\n${EXPECTED_BLOCK}\n`);
  expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
  expect(lstatSync(join(directory, 'Dropbox', 'dotfiles', 'CLAUDE.md')).isSymbolicLink()).toBe(true);
  expect(existsSync(join(directory, 'shared')), 'no stray folder at the spelled path').toBe(false);
});

test('a dangling CLAUDE.md link into a missing folder is refused with ENOENT and creates no folder', () => {
  const directory = scratchDirectory('claude-dangling-into-missing-folder');
  const linkPath = join(directory, 'CLAUDE.md');
  symlinkSync('missing-folder/CLAUDE.md', linkPath);

  expect(() => writeManagedBlock(linkPath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toThrow(expect.objectContaining({ code: 'ENOENT' }));

  expect(existsSync(join(directory, 'missing-folder'))).toBe(false);
  expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
  expect(readlinkSync(linkPath)).toBe('missing-folder/CLAUDE.md');
});

// A cycle answered with the link itself would let the rename replace the link with a regular file.
test('a CLAUDE.md link cycle is refused with ELOOP and stays a link', () => {
  const directory = scratchDirectory('claude-symlink-cycle');
  const linkPath = join(directory, 'CLAUDE.md');
  symlinkSync('second.md', linkPath);
  symlinkSync('CLAUDE.md', join(directory, 'second.md'));

  expect(() => writeManagedBlock(linkPath, BLOCK_BODY, MANAGED_BLOCK_MARKERS)).toThrow(expect.objectContaining({ code: 'ELOOP' }));

  expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
  expect(readlinkSync(linkPath)).toBe('second.md');
  expect(readdirSync(directory).sort()).toEqual(['CLAUDE.md', 'second.md']);
});
