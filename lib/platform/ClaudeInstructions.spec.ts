/**
 * What the tool may do to somebody's `CLAUDE.md`: everything outside the managed region survives byte
 * for byte, a start marker with no end is refused, and a symlinked file stays a symlink.
 */
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { join }                   from 'node:path';
import { afterAll, expect, test } from 'bun:test';

import { CLAUDE_MANAGED_END, CLAUDE_MANAGED_START }       from '../constants/Statuses';
import { createScratchDirectory, removeScratchDirectory } from '../tooling/dev/ScratchWorkspace';
import { writeManagedBlock }                              from './ClaudeInstructions';

const BLOCK_BODY = 'This repository tracks work with `agent-progress`. Load the agent-progress skill.';
const EXPECTED_BLOCK = `${CLAUDE_MANAGED_START}\n${BLOCK_BODY}\n${CLAUDE_MANAGED_END}`;

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
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY)).toBe('created');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`${EXPECTED_BLOCK}\n`);
});

test('a file with no markers keeps everything it had and gains the block after a blank line', () => {
  const claudeFilePath = claudeFileWith('claude-appended', '# Example Agency\n\nRun the tests before pushing.\n');
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY)).toBe('appended');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`# Example Agency\n\nRun the tests before pushing.\n\n${EXPECTED_BLOCK}\n`);
});

test('appending to a file that does not end in a newline still produces a markdown document', () => {
  const claudeFilePath = claudeFileWith('claude-appended-no-newline', '# Example Agency');
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY)).toBe('appended');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`# Example Agency\n\n${EXPECTED_BLOCK}\n`);
});

test('one marker pair is replaced in place, with everything around it byte for byte intact', () => {
  const before = '# Example Agency\n\nRun the tests before pushing.\n\n';
  const after = '\n\n## Local conventions\n\nAlex Example reviews every migration.\n';
  const claudeFilePath = claudeFileWith('claude-replaced', `${before}${CLAUDE_MANAGED_START}\nan older instruction\n${CLAUDE_MANAGED_END}${after}`);
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY)).toBe('replaced');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`${before}${EXPECTED_BLOCK}${after}`);
});

test('replacing twice in a row changes nothing the second time', () => {
  const claudeFilePath = claudeFileWith('claude-replaced-twice', '# Example Agency\n');
  writeManagedBlock(claudeFilePath, BLOCK_BODY);
  const afterFirstWrite = readFileSync(claudeFilePath, 'utf8');
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY)).toBe('replaced');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(afterFirstWrite);
});

test('with two marker pairs only the first is rewritten, and the second is left standing', () => {
  const secondPair = `${CLAUDE_MANAGED_START}\na stale copy somebody pasted\n${CLAUDE_MANAGED_END}`;
  const claudeFilePath = claudeFileWith(
    'claude-two-pairs',
    `${CLAUDE_MANAGED_START}\nan older instruction\n${CLAUDE_MANAGED_END}\n\nmiddle text\n\n${secondPair}\n`,
  );
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY)).toBe('replaced');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`${EXPECTED_BLOCK}\n\nmiddle text\n\n${secondPair}\n`);
});

test('a start marker with no end marker is refused and the file is not touched at all', () => {
  const originalContent = `# Example Agency\n\n${CLAUDE_MANAGED_START}\nsomething truncated the end marker\n`;
  const claudeFilePath = claudeFileWith('claude-start-without-end', originalContent);
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY)).toBe('refused-start-without-end');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(originalContent);
});

test('an end marker standing alone before the real pair is inert, not a broken fence', () => {
  // The end marker is searched for after the start marker, which is what makes a stray one harmless.
  const claudeFilePath = claudeFileWith(
    'claude-stray-end',
    `${CLAUDE_MANAGED_END}\n\n# Example Agency\n\n${CLAUDE_MANAGED_START}\nan older instruction\n${CLAUDE_MANAGED_END}\n`,
  );
  expect(writeManagedBlock(claudeFilePath, BLOCK_BODY)).toBe('replaced');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`${CLAUDE_MANAGED_END}\n\n# Example Agency\n\n${EXPECTED_BLOCK}\n`);
});

test('a symlinked CLAUDE.md stays a symlink and the content lands on the file it points at', () => {
  const directory = scratchDirectory('claude-symlink');
  const realDirectory = join(directory, 'config-repository');
  mkdirSync(realDirectory);
  const realPath = join(realDirectory, 'CLAUDE.md');
  const linkPath = join(directory, 'CLAUDE.md');
  writeFileSync(realPath, '# Example Agency\n');
  symlinkSync(realPath, linkPath);

  expect(writeManagedBlock(linkPath, BLOCK_BODY)).toBe('appended');

  expect(lstatSync(linkPath).isSymbolicLink(), 'the link is still a link').toBe(true);
  expect(readFileSync(realPath, 'utf8')).toBe(`# Example Agency\n\n${EXPECTED_BLOCK}\n`);
});

test('a multi-line body is written between the markers exactly as given', () => {
  const multiLineBody = '## Progress tracking\n\n- Run `agent-progress status --json` at session start.\n- File a ticket for every bug.';
  const claudeFilePath = claudeFileWith('claude-multiline-body', null);
  expect(writeManagedBlock(claudeFilePath, multiLineBody)).toBe('created');
  expect(readFileSync(claudeFilePath, 'utf8')).toBe(`${CLAUDE_MANAGED_START}\n${multiLineBody}\n${CLAUDE_MANAGED_END}\n`);
});
