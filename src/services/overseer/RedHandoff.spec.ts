/**
 * The Baton pass a red handoff leaves in its job's folder. What matters: it names every field the resumed session needs instead of
 * rerunning the gate (gate, command, fix command, commit, exit code, the full log's path); a long output shows only its first and last
 * 40 lines and never more than 8 KB; a gate that changed a file shows the diff in the output's place; and the facts read back as written.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { createScratchDirectory, removeScratchDirectory }             from '../../testing/ScratchWorkspace.ts';
import { BATON_PASS_OUTPUT_LIMITS, RedHandoff, type RedHandoffFacts } from './RedHandoff.ts';

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) removeScratchDirectory(folder);
});

function factsIn(jobFolder: string): RedHandoffFacts {
  return {
    kind:                'gate',
    name:                'tests',
    command:             'bun test',
    fixCommand:          'bun run format',
    commit:              '0123456789abcdef0123456789abcdef01234567',
    exitCode:            1,
    batonPassPath:       RedHandoff.batonPassPathOf(jobFolder),
    fullLogPath:         join(jobFolder, 'gate.log'),
    resume:              1,
    resumesAllowed:      2,
    callBudget:          30,
    interruptedInstance: 1,
  };
}

function longOutput(lineCount: number, lineText = 'example output line'): string {
  return Array.from({ length: lineCount }, (_unused, i) => `${lineText} ${i + 1}`).join('\n');
}

describe('the red handoff baton-pass', () => {
  test('names the gate, its command and fix command, the commit, the exit code and the full log\'s path', () => {
    const jobFolder = createScratchDirectory('red-handoff');
    folders.push(jobFolder);
    const facts = factsIn(jobFolder);
    RedHandoff.writeRedHandoff(jobFolder, facts, 'expected 2, received 3');
    const batonPass = readFileSync(join(jobFolder, 'gate-failure.md'), 'utf8');

    const fields = [
      'Gate: tests',
      'Command: `bun test`',
      'Fix command: `bun run format`',
      `Commit: ${facts.commit}`,
      'Exit code: 1',
      `Full log: ${String(facts.fullLogPath)}`,
      'expected 2, received 3',
    ];
    for (const field of fields) expect(batonPass).toContain(field);
    expect(RedHandoff.redHandoffFactsOf(jobFolder)).toEqual(facts);
  });

  test('shows a long output\'s first and last 40 lines only, marking what lies between', () => {
    const excerpt = RedHandoff.outputExcerptOf(longOutput(500));
    const lines = excerpt.split('\n');

    expect(lines.slice(0, BATON_PASS_OUTPUT_LIMITS.HEAD_LINES)).toEqual(longOutput(40).split('\n'));
    expect(lines[BATON_PASS_OUTPUT_LIMITS.HEAD_LINES]).toBe('[… 420 lines omitted …]');
    expect(lines.slice(-BATON_PASS_OUTPUT_LIMITS.TAIL_LINES)).toEqual(longOutput(500).split('\n').slice(-40));
    expect(lines).toHaveLength(81);
  });

  test('cuts an output of long lines to at most 8 KB, keeping its start and its end', () => {
    const excerpt = RedHandoff.outputExcerptOf(longOutput(500, 'x'.repeat(400)));

    expect(Buffer.byteLength(excerpt, 'utf8')).toBeLessThanOrEqual(BATON_PASS_OUTPUT_LIMITS.BYTES);
    expect(excerpt.startsWith(`${'x'.repeat(400)} 1\n`)).toBe(true);
    expect(excerpt.endsWith(`${'x'.repeat(400)} 500`)).toBe(true);
  });

  test('keeps a short output whole', () => {
    expect(RedHandoff.outputExcerptOf('expected 2, received 3\n')).toBe('expected 2, received 3');
  });

  test('shows the diff in the output\'s place for a gate that changed a file', () => {
    const diff = 'diff --git a/example.ts b/example.ts\n-const example = 1\n+const example = 1;';
    expect(RedHandoff.batonPassTextOf(factsIn('/example/job'), diff)).toContain(diff);
  });

  test('names the Customs check for a refused Customs check, with no gate', () => {
    const facts: RedHandoffFacts = {
      ...factsIn('/example/job'), kind: 'customs', name: 'V4', command: null, fixCommand: null, exitCode: null, fullLogPath: null
    };
    const batonPass = RedHandoff.batonPassTextOf(facts, 'the worktree has uncommitted changes');

    expect(batonPass).toContain('Customs check: V4');
    expect(batonPass).toContain('Gate: -');
  });
});
