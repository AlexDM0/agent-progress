/**
 * The help held against `cli/CommandTable.ts` in both directions: a command it omits, and a command it
 * offers that the table would refuse. Then the bundled skills, whose one job here is to stay out of the
 * help's way — they point at it, they carry no copy of it, and the one every agent loads has a ceiling.
 */
import { readFileSync }           from 'node:fs';
import { join }                   from 'node:path';
import { describe, expect, test } from 'bun:test';

import { COMMAND_NAMES } from './CommandTable';
import { helpText }      from './HelpText';

const HELP_TEXT = helpText();

const SKILL_TEXT       = readFileSync(join(import.meta.dir, '..', 'skill', 'SKILL.md'), 'utf8');
const REFERENCE_TEXT   = readFileSync(join(import.meta.dir, '..', 'skill', 'Reference.md'), 'utf8');
const ORCHESTRATE_TEXT = readFileSync(join(import.meta.dir, '..', 'skill-orchestrate', 'SKILL.md'), 'utf8');

/**
 * What `skill/SKILL.md` may grow to. Its trigger fires in every session in a tracked repository,
 * including every implementing subagent, and each of their API calls re-reads it — so orchestrator
 * material creeping back into it is paid for by all of them. Raise this only with the same argument.
 */
const SESSION_SKILL_LIMIT_CHARACTERS = 9_000;

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
    expect(HELP_TEXT).toContain('task start|pause|finish|review|rereview|deliver <id>');
    expect(HELP_TEXT).toContain('ticket start|review|done|deliver|abandon|reopen <id>');
    expect(HELP_TEXT).toContain('in-review, done, delivered or abandoned');
  });

  /** `pause` is a task state with no ticket twin, so nothing else here would notice it going missing. */
  test('pause is offered on the task side and nowhere on the ticket side', () => {
    expect(HELP_TEXT).toContain('|pause|');
    expect(HELP_TEXT).not.toContain('ticket pause');
  });

  /** The one move legal on the status a ticket already holds, which every other verb refuses: a reader is told so here or nowhere. */
  test('the repeat review is offered on both sides, and the help says it is the exception', () => {
    expect(HELP_TEXT).toContain('|rereview|');
    expect(HELP_TEXT).toContain('ticket rereview <id>');
    expect(HELP_TEXT).toContain('the one verb that may be run on the status the ticket already');
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

/**
 * Every bundled skill file, so a check below judges all of them rather than the two it was written for.
 * A copy of the command reference is as wrong in a file added next year as it is in these.
 */
const BUNDLED_SKILL_FILES = [
  { path: 'skill/SKILL.md',              text: SKILL_TEXT },
  { path: 'skill/Reference.md',          text: REFERENCE_TEXT },
  { path: 'skill-orchestrate/SKILL.md',  text: ORCHESTRATE_TEXT }
] as const;

describe('the bundled skills leave the command reference to the tool', () => {
  test('the skills were read at all, so the claims below are about their contents', () => {
    // The floor: empty files would pass every "does not contain" check below by containing nothing.
    for (const { path, text } of BUNDLED_SKILL_FILES) {
      expect(text.length, `characters read from \`${path}\``).toBeGreaterThan(2_000);
    }
    expect(SKILL_TEXT).toContain('name: agent-progress');
    expect(ORCHESTRATE_TEXT).toContain('name: agent-progress-orchestrate');
    expect(ticketSubcommandsDocumented().length, 'ticket subcommands found in the help').toBeGreaterThanOrEqual(8);
  });

  /**
   * `agent-progress help` is the reference, and a skill that lists the commands itself is a second
   * copy of it that nothing holds against `cli/CommandTable.ts`. A file naming a handful of commands
   * in prose is not that; a table of them is, so the table's own header is what this looks for.
   */
  test('no skill file carries a command table of its own', () => {
    const carryingOne = BUNDLED_SKILL_FILES.filter(({ text }) => text.includes('| command | what it does |'));
    expect(carryingOne.map(({ path }) => path), 'the reference `agent-progress help` prints may not be duplicated into a skill').toEqual([]);
  });

  test('the session skill sends its reader to the help for a flag, since nothing else does', () => {
    expect(SKILL_TEXT, 'an agent that is not told to run it will guess the flag instead').toContain('`agent-progress help` is the command reference');
  });

  test('the session skill names the file beside it, since nothing else points at that one either', () => {
    expect(SKILL_TEXT, 'a reference no skill mentions is a file no agent opens').toContain('Reference.md');
  });

  test('what the help does not print is in the file that does', () => {
    // The division of labour between the two: these four are the reason `skill/Reference.md` exists at all.
    expect(HELP_TEXT, 'the help stays a command reference; the formats live beside the skill').not.toContain('abandonedAt');
    expect(REFERENCE_TEXT).toContain('abandonedAt');
    expect(REFERENCE_TEXT).toContain('## Exit codes');
    expect(REFERENCE_TEXT).toContain('## The time axis');
    expect(REFERENCE_TEXT).toContain('## What each move does to the Gantt row');
  });
});

describe('the two skills stay split by audience', () => {
  test('the session skill stays under what every agent in a tracked repository can afford', () => {
    expect(SKILL_TEXT.length, `\`skill/SKILL.md\` is loaded by every session in a tracked repository and may not exceed ${SESSION_SKILL_LIMIT_CHARACTERS} characters`)
      .toBeLessThanOrEqual(SESSION_SKILL_LIMIT_CHARACTERS);
  });

  test('the orchestrator skill loads the session one rather than restating it', () => {
    expect(ORCHESTRATE_TEXT).toContain('`agent-progress` skill');
  });

  test('the orchestrator skill is the one that tells its reader to record what an agent cost', () => {
    expect(ORCHESTRATE_TEXT).toContain('--tokens');
    expect(ORCHESTRATE_TEXT).toContain('subagent_tokens');
  });
});
