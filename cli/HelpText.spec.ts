/**
 * The help and the bundled `skill/SKILL.md` held against `cli/CommandTable.ts` in both directions: a
 * command the reference omits, and a command the reference offers that the table would refuse.
 */
import { readFileSync }           from 'node:fs';
import { join }                   from 'node:path';
import { describe, expect, test } from 'bun:test';

import { COMMAND_NAMES } from './CommandTable';
import { helpText }      from './HelpText';

const HELP_TEXT = helpText();

const SKILL_TEXT = readFileSync(join(import.meta.dir, '..', 'skill', 'SKILL.md'), 'utf8');

function commandWordsDocumented(): string[] {
  const words = HELP_TEXT.split('\n')
    .map((line) => /^ {2}(\S+)/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]!);
  return [...new Set(words)].sort();
}

describe('the command reference', () => {
  test('its scan finds the entries at all, before anything is concluded from what it did not find', () => {
    // The floor: a change to the indentation would empty this list, and both tests below would pass by comparing nothing.
    expect(commandWordsDocumented().length).toBeGreaterThanOrEqual(COMMAND_NAMES.length);
  });

  test('every command in the table is documented', () => {
    const undocumented = COMMAND_NAMES.filter((name) => !commandWordsDocumented().includes(name));
    expect(undocumented, 'these commands exist and `agent-progress help` never mentions them').toEqual([]);
  });

  test('it documents no command the table does not have', () => {
    const invented = commandWordsDocumented().filter((word) => !(COMMAND_NAMES as readonly string[]).includes(word));
    expect(invented, 'the help offers these and the tool would refuse them').toEqual([]);
  });

  test('it says how to invoke the tool, since a reader arriving at the help has not managed to', () => {
    expect(HELP_TEXT).toContain('Usage: agent-progress <command> [options]');
  });

  test('the delivered state is offered on both the task and the ticket side', () => {
    expect(HELP_TEXT).toContain('task start|pause|finish|review|deliver <id>');
    expect(HELP_TEXT).toContain('ticket start|review|done|deliver|abandon|reopen <id>');
    expect(HELP_TEXT).toContain('in-review, done, delivered or abandoned');
  });

  /** `pause` is a task state with no ticket twin, so nothing else here would notice it going missing. */
  test('pause is offered on the task side and nowhere on the ticket side', () => {
    expect(HELP_TEXT).toContain('|pause|');
    expect(HELP_TEXT).not.toContain('ticket pause');
  });

  test('--tokens is offered on the task and ticket entries and its spellings are written out', () => {
    expect(HELP_TEXT).toContain('--tokens <n>');
    expect(HELP_TEXT).toContain('`12.3k`');
  });

  test('the two ways to reach the tracker from elsewhere are documented', () => {
    expect(HELP_TEXT).toContain('AGENT_PROGRESS_ROOT');
    expect(HELP_TEXT).toContain('`--help` works after a command word');
  });
});

/** Read off the help's own `ticket …` lines rather than listed here, so a subcommand added to that entry reaches this check unaided. */
function ticketSubcommandsDocumented(): string[] {
  const subcommands = [...HELP_TEXT.matchAll(/^ {2}ticket (\S+)/gm)]
    .flatMap((match) => match[1]!.split('|'))
    .filter((word) => /^[a-z-]+$/.test(word));
  return [...new Set(subcommands)].sort();
}

describe('the reference in the bundled skill', () => {
  test('the skill was read at all, so the claims below are about its contents', () => {
    // The floor: an empty file, or a listing that found no subcommands, would not fail the checks below.
    expect(SKILL_TEXT.length, 'characters read from `skill/SKILL.md`').toBeGreaterThan(2_000);
    expect(SKILL_TEXT).toContain('name: agent-progress');
    expect(ticketSubcommandsDocumented().length, 'ticket subcommands found in the help').toBeGreaterThanOrEqual(8);
    expect(SKILL_TEXT, 'the skill tells an orchestrator when to report a usage').toContain('--tokens');
  });

  test('every command in the table is written out in the skill as an agent would type it', () => {
    const missing = COMMAND_NAMES.filter((name) => !SKILL_TEXT.includes(`agent-progress ${name}`));
    expect(missing, 'the skill is the reference an agent works from; a command absent from it is a command it will not use').toEqual([]);
  });

  test('every ticket subcommand the help offers is in the skill too', () => {
    // The check above only sees `agent-progress ticket`, so it would pass with ten of the eleven subcommands missing.
    const missing = ticketSubcommandsDocumented().filter((subcommand) => !SKILL_TEXT.includes(`ticket ${subcommand}`));
    expect(missing, 'these are offered by `agent-progress help` and unknown to the skill').toEqual([]);
  });
});
