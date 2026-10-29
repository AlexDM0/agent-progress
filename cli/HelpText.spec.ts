/**
 * The help held against `cli/CommandTable.ts` in both directions: a command it omits, and a command it
 * offers that the table would refuse. Then the bundled skills, whose one job here is to stay out of the
 * help's way — they point at it, they carry no copy of it, and the one every agent loads has a ceiling.
 */
import { readFileSync }           from 'node:fs';
import { join }                   from 'node:path';
import { describe, expect, test } from 'bun:test';
import { ROOT_OVERRIDE_VARIABLE } from '../src/shared/Environment.ts';
import { PRODUCT_NAMES }          from '../src/shared/constants/ProductNames.ts';

import { COMMAND_NAMES } from './CommandTable.ts';
import { helpText }      from './HelpText.ts';

const HELP_TEXT = helpText();

const FILING_SKILL_TEXT = readFileSync(join(import.meta.dir, '..', 'skills', 'agent-po', 'SKILL.md'), 'utf8');
const REFERENCE_TEXT    = readFileSync(join(import.meta.dir, '..', 'resources', 'templates', 'Reference.md'), 'utf8');
const ORCHESTRATE_TEXT  = readFileSync(join(import.meta.dir, '..', 'skills', 'agent-progress-orchestrate', 'SKILL.md'), 'utf8');

/**
 * What `skills/agent-po/SKILL.md` may grow to. Its trigger fires in every session asked to file a ticket, and each
 * of that session's API calls re-reads it, so orchestrator or agent material creeping into it is paid for by every
 * filing. Raise this only with the same argument.
 */
const FILING_SKILL_LIMIT_CHARACTERS = 9_300;

function commandWordsDocumented(): string[] {
  const words = HELP_TEXT.split('\n')
    .map((line) => /^ {2}(\S+)/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1] ?? '');
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

  test('status documents --tickets-only and the per-owner token total', () => {
    expect(HELP_TEXT).toContain('[--tickets-only]');
    expect(HELP_TEXT).toContain('no ticket\'s own row and no review bar');
    expect(HELP_TEXT).toContain('`tokensByOwner`');
  });

  test('it says how to invoke the tool, since a reader arriving at the help has not managed to', () => {
    expect(HELP_TEXT).toContain(`Usage: ${PRODUCT_NAMES.PROGRAM} <command> [options]`);
  });

  test('it names the install version refusal, the commands it spares and the command that lifts it', () => {
    const flattenedHelp = HELP_TEXT.replaceAll(/\s+/g, ' ');
    expect(flattenedHelp).toContain(
      'Every command but init, update, help and status refuses, with exit 1, while the files installed here are of another install version',
    );
    expect(flattenedHelp).toContain(`update rewrites them, and it and \`init\` refuse files a newer ${PRODUCT_NAMES.PROGRAM} installed`);
  });

  test('the delivered state is offered on both the task and the ticket side', () => {
    expect(HELP_TEXT).toContain('task start|pause|finish|approve|rereview|deliver <id>');
    expect(HELP_TEXT).toContain('ticket start|finish|approve|deliver|abandon|reopen <id>');
    expect(HELP_TEXT).toContain('in-review, reviewed, delivered or abandoned');
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

  /** `init` reads as destructive, so a reader refreshing a repository that already has a tracker has to be sent to `update` here. */
  test('refreshing an adopted repository is offered as its own command, and the init entry points at it', () => {
    expect(HELP_TEXT).toContain('  update ');
    expect(HELP_TEXT).toContain('`update` is the command to reach for there');
    expect(HELP_TEXT, 'the one line that says what is refreshed').toContain('three files beside the tracker, guidance shipped with the tool');
    expect(HELP_TEXT.replaceAll(/\s+/g, ' '), 'a tracker in an older format is sent to an earlier release\'s update')
      .toContain('saying to run `update` with a release that still reads it');
  });

  test('the two ways to reach the tracker from elsewhere are documented', () => {
    expect(HELP_TEXT).toContain(ROOT_OVERRIDE_VARIABLE);
    expect(HELP_TEXT).toContain('`--help` works after a command word');
  });
});

/** Read off the help's own `ticket …` lines rather than listed here, so a subcommand added to that entry reaches this check unaided. */
function ticketSubcommandsDocumented(): string[] {
  const subcommands = [...HELP_TEXT.matchAll(/^ {2}ticket (\S+)/gm)]
    .flatMap((match) => (match[1] ?? '').split('|'))
    .filter((word) => /^[a-z-]+$/.test(word));
  return [...new Set(subcommands)].sort();
}

/**
 * Every bundled skill file, so a check below judges all of them rather than the two it was written for.
 * A copy of the command reference is as wrong in a file added next year as it is in these.
 */
const BUNDLED_SKILL_FILES = [
  { path: 'skills/agent-po/SKILL.md',                    text: FILING_SKILL_TEXT },
  { path: 'resources/templates/Reference.md',            text: REFERENCE_TEXT },
  { path: 'skills/agent-progress-orchestrate/SKILL.md',  text: ORCHESTRATE_TEXT }
] as const;

describe('the bundled skills leave the command reference to the tool', () => {
  test('the skills were read at all, so the claims below are about their contents', () => {
    // The floor: empty files would pass every "does not contain" check below by containing nothing.
    for (const { path, text } of BUNDLED_SKILL_FILES) {
      expect(text.length, `characters read from \`${path}\``).toBeGreaterThan(2_000);
    }
    expect(FILING_SKILL_TEXT).toContain('name: {{skillName}}');
    expect(ORCHESTRATE_TEXT).toContain('name: {{skillName}}');
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

  test('both skills send their reader to the help for a flag and to the installed reference for the formats', () => {
    for (const { path, text } of [BUNDLED_SKILL_FILES[0], BUNDLED_SKILL_FILES[2]]) {
      expect(text, `${path}: an agent that is not told to run it will guess the flag instead`).toContain('`{{program}} help` prints every command and flag');
      expect(text, `${path}: a reference nothing mentions is a file no agent opens`).toContain('`{{dataFolder}}/reference.md`');
    }
  });

  test('what the help does not print is in the file that does', () => {
    // The division of labour between the two: these four are the reason `resources/templates/Reference.md` exists at all.
    expect(HELP_TEXT, 'the help stays a command reference; the formats live beside the skill').not.toContain('abandonedAt');
    expect(REFERENCE_TEXT).toContain('abandonedAt');
    expect(REFERENCE_TEXT).toContain('## Exit codes');
    expect(REFERENCE_TEXT).toContain('## The time axis');
    expect(REFERENCE_TEXT).toContain('## What each move does to the Gantt row');
  });
});

describe('the two skills stay split by audience', () => {
  test('the filing skill stays under what every filing session can afford', () => {
    expect(FILING_SKILL_TEXT.length, `\`skills/agent-po/SKILL.md\` is loaded by every filing session and may not exceed ${FILING_SKILL_LIMIT_CHARACTERS} characters`)
      .toBeLessThanOrEqual(FILING_SKILL_LIMIT_CHARACTERS);
  });

  /** A sentence of the filing procedure found in the orchestrator skill is a second copy that drifts from the first. */
  test('the orchestrator skill loads the filing one rather than restating it, and loads the retired one nowhere', () => {
    expect(ORCHESTRATE_TEXT).toContain('the `{{productOwnerSkill}}` skill says');
    for (const filingSentence of ['Split a large request by mechanism', 'Read the Acceptance back against itself', 'File into an epic']) {
      expect(FILING_SKILL_TEXT, filingSentence).toContain(filingSentence);
      expect(ORCHESTRATE_TEXT, filingSentence).not.toContain(filingSentence);
    }
    expect(ORCHESTRATE_TEXT).not.toContain('`agent-progress` skill');
  });

  test('the filing skill files and stops: it loads no other skill and dispatches nothing', () => {
    expect(FILING_SKILL_TEXT).toContain('you never load `{{orchestrateSkill}}`');
    expect(FILING_SKILL_TEXT).not.toContain('`agent-progress` skill');
    expect(FILING_SKILL_TEXT).not.toContain('dispatcher running');
  });

  /** The runner credits every job's tokens and the brief carrying the Orchestrator checklist is no longer installed. */
  test('neither skill tells its reader to record what an agent cost or reads the retired agent brief', () => {
    for (const text of [FILING_SKILL_TEXT, ORCHESTRATE_TEXT]) {
      expect(text).not.toContain('--tokens');
      expect(text).not.toContain('agent-brief.md');
    }
  });

  test('the filing skill files drafts, each with a Brief, and readies them only on the user\'s yes in their own session', () => {
    expect(FILING_SKILL_TEXT).toContain('"Ready these to build?"');
    expect(FILING_SKILL_TEXT).toContain('`{{program}} ticket ready <ids>`');
    expect(FILING_SKILL_TEXT).toContain('**Under the runner** (your prompt names your job), never ready');
    expect(FILING_SKILL_TEXT).toContain('Every ticket carries a numbered Acceptance and a non-empty `## Brief`');
    expect(FILING_SKILL_TEXT).toContain('never a chain built to order them');
    for (const retired of ['--hold', 'build-when-filed', 'starts now or is queued']) expect(FILING_SKILL_TEXT, retired).not.toContain(retired);
  });

  test('the orchestrator skill wraps a running runner: it reads its state, starts it on the go and never drives it', () => {
    expect(ORCHESTRATE_TEXT).toContain('`{{program}} run status --json`');
    expect(ORCHESTRATE_TEXT).toContain('`{{program}} status --json`');
    expect(ORCHESTRATE_TEXT).toContain('`{{program}} run --detach`');
    expect(ORCHESTRATE_TEXT).toContain('`{{program}} await --json`');
    expect(ORCHESTRATE_TEXT).toContain('never drive the\nlifecycle yourself and never handle an incident');
    for (const retired of ['dispatcher', 'Workflow', '`ask`', 'Host mechanics']) expect(ORCHESTRATE_TEXT, retired).not.toContain(retired);
  });
});

const SESSION_INSTRUCTIONS_TEXT = readFileSync(join(import.meta.dir, '..', 'resources', 'templates', 'SessionInstructions.md'), 'utf8');

/** The runner owns the lifecycle, so the guidance a session reads names only `ticket deliver --by-hand` for work done outside it. */
const BY_HAND_LIFECYCLE_VERB_PATTERNS = [
  /`release[ `]/,
  /\brelease <id>/,
  /ticket (?:start|finish|approve|claim)\b/,
  /review record/,
  /\brework\b/,
] as const;

describe('the installed guidance names no by-hand lifecycle verb', () => {
  const guidanceFiles = [
    ...BUNDLED_SKILL_FILES,
    { path: 'resources/templates/SessionInstructions.md', text: SESSION_INSTRUCTIONS_TEXT },
  ];

  test('each pattern finds the verb it means, so a clean scan is a finding', () => {
    const plantedLines = ['run `release 5 --branch b`', 'release <id> --branch', 'ticket finish 5', 'review record 5', 'rework --since x'];
    for (const [i, pattern] of BY_HAND_LIFECYCLE_VERB_PATTERNS.entries()) expect(pattern.test(plantedLines[i] ?? ''), String(pattern)).toBe(true);
    expect(SESSION_INSTRUCTIONS_TEXT).toContain('ticket deliver <id> --by-hand');
  });

  test('none of the files names one', () => {
    const namings = guidanceFiles.flatMap(({ path, text }) =>
      BY_HAND_LIFECYCLE_VERB_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => `${path} ${String(pattern)}`));
    expect(namings).toEqual([]);
  });

  test('a planted by-hand verb is caught', () => {
    const planted = `${SESSION_INSTRUCTIONS_TEXT}\nRun \`ticket approve 5\` by hand.`;
    expect(BY_HAND_LIFECYCLE_VERB_PATTERNS.some((pattern) => pattern.test(planted))).toBe(true);
  });
});
