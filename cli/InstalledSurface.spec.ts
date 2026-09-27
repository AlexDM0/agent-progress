/**
 * The surface of the CLI the installed files name, frozen per `INSTALL_VERSION` in `cli/FrozenInstalledSurface.json`: the commands and flags the
 * brief, the CLAUDE.md block, the worker definition, the skills and the dispatcher's sources name, and the `status --json` fields they read. A
 * version's surface only grows, since a file installed at that version may name any of it; so a frozen name the CLI no longer has means an
 * installed file became wrong, and fails until `INSTALL_VERSION` is bumped. Prose and numbers are not surface, so rewording a template or
 * changing a `DISPATCH_PROTOCOL` number trips nothing. The CLI's side is the help screen for commands and flags, and the keys of both
 * `status --json` documents over a board holding every kind of entry. To retake: add the names a failure lists under the current version, or,
 * after a bump, a new key holding the surface the failure prints; never delete a name from a version already frozen.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join }                      from 'node:path';

import {
  afterAll,
  beforeAll,
  expect,
  test
}                                                                             from 'bun:test';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                                           from '../src/testing/ToolGuard.ts';
import { helpText }                                                           from './HelpText.ts';
import { runCommandLine }                                                     from './Main.ts';
import { INSTALL_VERSION }                                                    from './constants/InstallVersion.ts';
import { createCapturedCommandContext }                                       from './testing/CapturedCommandContext.ts';

const SURFACE_KINDS = ['commands', 'flags', 'statusJsonFields'] as const;

type SurfaceKind = typeof SURFACE_KINDS[number];

type Surface = Readonly<Record<SurfaceKind, readonly string[]>>;

type FrozenSurfaceTable = Readonly<Record<string, Surface>>;

type CliSurface = Readonly<Record<SurfaceKind, ReadonlySet<string>>>;

const SURFACE_KIND_WORDS: Readonly<Record<SurfaceKind, string>> = {
  commands:         'command',
  flags:            'flag',
  statusJsonFields: '`status --json` field',
};

const REPOSITORY_ROOT = join(import.meta.dir, '..');

const FROZEN_TABLE_PATH = 'cli/FrozenInstalledSurface.json';

const INSTALLED_TEMPLATE_PATHS = ['resources/templates/AgentBrief.md', 'resources/templates/ClaudeInstructionsBlock.md', 'resources/templates/AgentProgressWorker.md'];

const INSTALLED_SKILL_FOLDERS = ['skill', 'skill-orchestrate'];

const DISPATCHER_FOLDER = 'dispatcher';

/** The dispatcher's reply schemas list the `status --json` fields the agents copy by name, not in backticks. */
const REPLY_SCHEMA_PATH = 'dispatcher/run/constants/AgentReplySchemas.ts';

/** Flags of the git commands the installed files spell out; exact both ways, and none of them is the CLI's. */
const FOREIGN_TOOL_FLAGS = ['--abort', '--continue', '--git-common-dir', '--stat'];

const FLAG_PATTERN = /--[a-z][a-z-]*[a-z]/g;

const NAMED_COMMAND_PATTERN = /agent-progress ([a-z]+)(?: ([a-z][a-z-]*))?/g;

const HELP_COMMAND_LINE_PATTERN = /^ {2}([a-z]+)(?: ([a-z][a-z|-]*))?/gm;

/** A backtick in markdown, or an escaped one inside a TypeScript template literal. */
const BACKTICKED_NAME_PATTERN = /\\?`([A-Za-z]+)\\?`/g;

const REPLY_SCHEMA_PROPERTY_PATTERN = /(\w+):\s+\{\s*type:/g;

function repositoryFileText(path: string): string {
  return readFileSync(join(REPOSITORY_ROOT, path), 'utf8');
}

function installedTextsByPath(): Readonly<Record<string, string>> {
  const skillPaths = INSTALLED_SKILL_FOLDERS.flatMap((folder) => readdirSync(join(REPOSITORY_ROOT, folder))
    .filter((fileName) => fileName.endsWith('.md'))
    .map((fileName) => `${folder}/${fileName}`));
  const dispatcherPaths = readdirSync(join(REPOSITORY_ROOT, DISPATCHER_FOLDER), { recursive: true, encoding: 'utf8' })
    .map((relativePath) => `${DISPATCHER_FOLDER}/${relativePath.split('\\').join('/')}`)
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.spec.ts') && !path.split('/').includes('testing'));
  return Object.fromEntries([...INSTALLED_TEMPLATE_PATHS, ...skillPaths, ...dispatcherPaths].sort().map((path) => [path, repositoryFileText(path)]));
}

function cliSurfaceOf(help: string, statusDocumentKeys: ReadonlySet<string>): CliSurface {
  const commands = new Set<string>();
  for (const [, command = '', subcommands] of help.matchAll(HELP_COMMAND_LINE_PATTERN)) {
    commands.add(command);
    for (const subcommand of subcommands?.split('|') ?? []) commands.add(`${command} ${subcommand}`);
  }
  return { commands, flags: new Set(help.match(FLAG_PATTERN) ?? []), statusJsonFields: statusDocumentKeys };
}

/** Commands and fields are kept only where the CLI has them, since prose says `agent-progress itself` too; a frozen name the CLI drops still fails. */
function namedSurfaceOf(installedTexts: Readonly<Record<string, string>>, cliSurface: CliSurface): Surface {
  const texts = Object.values(installedTexts);
  const commands = new Set<string>();
  for (const [, command = '', subcommand] of texts.flatMap((text) => [...text.matchAll(NAMED_COMMAND_PATTERN)])) {
    const withSubcommand = `${command} ${subcommand ?? ''}`;
    if (cliSurface.commands.has(withSubcommand)) commands.add(withSubcommand);
    else if (cliSurface.commands.has(command)) commands.add(command);
  }
  const flags = new Set(texts.flatMap((text) => text.match(FLAG_PATTERN) ?? []).filter((flag) => !FOREIGN_TOOL_FLAGS.includes(flag)));
  const backtickedNames = texts.flatMap((text) => [...text.matchAll(BACKTICKED_NAME_PATTERN)].map(([, name = '']) => name));
  const replySchemaNames = [...(installedTexts[REPLY_SCHEMA_PATH] ?? '').matchAll(REPLY_SCHEMA_PROPERTY_PATTERN)].map(([, name = '']) => name);
  const statusJsonFields = new Set([...backtickedNames, ...replySchemaNames].filter((name) => cliSurface.statusJsonFields.has(name)));
  return { commands: [...commands].sort(), flags: [...flags].sort(), statusJsonFields: [...statusJsonFields].sort() };
}

function surfaceSentencesOf(namedSurface: Surface, cliSurface: CliSurface, frozenTable: FrozenSurfaceTable, installVersion: number): readonly string[] {
  const versionKey = String(installVersion);
  if (!Object.hasOwn(frozenTable, versionKey)) {
    return [`${FROZEN_TABLE_PATH} has no surface for INSTALL_VERSION ${versionKey}: add "${versionKey}": ${JSON.stringify(namedSurface)}`];
  }
  const frozenSurface = frozenTable[versionKey] ?? namedSurface;
  return SURFACE_KINDS.flatMap((kind) => [
    ...frozenSurface[kind].filter((name) => !cliSurface[kind].has(name)).map((name) => `the files installed at INSTALL_VERSION ${versionKey} name the `
      + `${SURFACE_KIND_WORDS[kind]} ${name}, which the CLI no longer has: an installed file became wrong, so bump INSTALL_VERSION in `
      + 'cli/constants/InstallVersion.ts (CLAUDE.md, Generated and installed files) and freeze the new version\'s surface'),
    ...namedSurface[kind].filter((name) => !frozenSurface[kind].includes(name)).map((name) => 'the installed files now name the '
      + `${SURFACE_KIND_WORDS[kind]} ${name}, which INSTALL_VERSION ${versionKey}'s frozen surface lacks: add it under "${versionKey}" in ${FROZEN_TABLE_PATH}`),
  ]);
}

function keysOf(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
}

/** Every kind of entry both documents can hold: ready, held, in progress, paused, waiting on a review, under one, settled, and a running dispatcher. */
async function statusDocumentKeysOfAFullBoard(repositoryDirectory: string): Promise<ReadonlySet<string>> {
  const run = async (commandLineArguments: readonly string[]): Promise<string> => {
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    const exitCode = await runCommandLine(commandLineArguments, context);
    if (exitCode !== 0) throw new Error(`\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`);
    return context.outputText();
  };
  await run(['init', '--project', 'Example Agency', '--no-claude-md', '--no-hooks', '--no-workflow', '--no-agent-definition']);
  await run(['concurrency', '10']);
  for (const title of ['Example build', 'Example review', 'Example waiting review', 'Example paused build', 'Example held', 'Example ready', 'Example settled']) {
    await run(['ticket', 'add', title]);
  }
  await run(['ticket', 'claim', '1', '--owner', 'opus', '--note', 'Example note']);
  await run(['ticket', 'claim', '2']);
  await run(['ticket', 'finish', '2', '--start-review', '--owner', 'opus']);
  await run(['ticket', 'claim', '3']);
  await run(['ticket', 'finish', '3']);
  await run(['ticket', 'claim', '4', '--note', 'Example paused note']);
  const pausedRowId = (JSON.parse(await run(['ticket', 'show', '4', '--json'])) as { task?: string | number }).task ?? '';
  await run(['task', 'pause', String(pausedRowId)]);
  await run(['ticket', 'hold', '5', '--reason', 'Example reason']);
  await run(['ticket', 'claim', '7']);
  await run(['ticket', 'finish', '7']);
  await run(['ticket', 'approve', '7']);
  await run(['ticket', 'deliver', '7']);
  await run(['dispatcher', 'running', '--run', 'example-run']);
  await run(['log', 'Example milestone']);
  const documents = [await run(['status', '--json']), await run(['status', '--json', '--full'])].map((text) => JSON.parse(text) as unknown);
  return new Set(documents.flatMap(keysOf));
}

const FROZEN_TABLE = JSON.parse(repositoryFileText(FROZEN_TABLE_PATH)) as FrozenSurfaceTable;

const INSTALLED_TEXTS = installedTextsByPath();

let repositoryDirectory = '';

let cliSurface: CliSurface = { commands: new Set(), flags: new Set(), statusJsonFields: new Set() };

beforeAll(async () => {
  if (!gitIsAvailable()) return;
  repositoryDirectory = createScratchGitRepository('installed-surface');
  cliSurface = cliSurfaceOf(helpText(), await statusDocumentKeysOfAFullBoard(repositoryDirectory));
});

afterAll(() => {
  if (repositoryDirectory !== '') removeScratchDirectory(repositoryDirectory);
});

function withTextReplaced(texts: Readonly<Record<string, string>>, path: string, searched: string, replacement: string): Readonly<Record<string, string>> {
  const text = texts[path] ?? '';
  expect(text.includes(searched), `${path} holds ${searched}`).toBe(true);
  return { ...texts, [path]: text.replaceAll(searched, replacement) };
}

function cliSurfaceWithHelpReplaced(searched: string, replacement: string): CliSurface {
  expect(helpText().includes(searched), `the help holds ${searched}`).toBe(true);
  return cliSurfaceOf(helpText().replaceAll(searched, replacement), cliSurface.statusJsonFields);
}

describeWhenGitIsPresent('the scan itself', () => {
  /** Floors well under today's counts, to fail a scan that read the wrong files or a help screen it could not parse. */
  test('it reads the installed files and finds commands, flags and status fields in them and in the CLI', () => {
    expect(Object.keys(INSTALLED_TEXTS)).toEqual(expect.arrayContaining([...INSTALLED_TEMPLATE_PATHS, 'skill/SKILL.md', 'skill-orchestrate/SKILL.md', REPLY_SCHEMA_PATH]));
    const namedSurface = namedSurfaceOf(INSTALLED_TEXTS, cliSurface);
    expect(namedSurface.commands.length, 'commands named').toBeGreaterThanOrEqual(10);
    expect(namedSurface.flags.length, 'flags named').toBeGreaterThanOrEqual(15);
    expect(namedSurface.statusJsonFields.length, 'status fields named').toBeGreaterThanOrEqual(10);
    expect(cliSurface.commands).toContain('ticket claim');
    expect(cliSurface.statusJsonFields).toContain('dispatcherRunId');
  });

  test('every foreign flag is named by an installed file and is not the CLI\'s', () => {
    const allFlags = new Set(Object.values(INSTALLED_TEXTS).flatMap((text) => text.match(FLAG_PATTERN) ?? []));
    expect(FOREIGN_TOOL_FLAGS.filter((flag) => !allFlags.has(flag) || cliSurface.flags.has(flag))).toEqual([]);
  });
});

describeWhenGitIsPresent('the frozen surface', () => {
  test(`holds for INSTALL_VERSION ${INSTALL_VERSION}: the CLI still has every name frozen, and every name installed is frozen`, () => {
    expect(surfaceSentencesOf(namedSurfaceOf(INSTALLED_TEXTS, cliSurface), cliSurface, FROZEN_TABLE, INSTALL_VERSION)).toEqual([]);
  });
});

describeWhenGitIsPresent('the guard, planted in memory', () => {
  const sentencesWith = (installedTexts: Readonly<Record<string, string>>, plantedCliSurface: CliSurface, installVersion = INSTALL_VERSION): readonly string[] => (
    surfaceSentencesOf(namedSurfaceOf(installedTexts, plantedCliSurface), plantedCliSurface, FROZEN_TABLE, installVersion)
  );

  test('a flag the brief names, renamed in the CLI and the brief without a bump, fails naming the rule', () => {
    const renamedCli = cliSurfaceWithHelpReplaced('--owner', '--assignee');
    const renamedTexts = withTextReplaced(INSTALLED_TEXTS, 'resources/templates/AgentBrief.md', '--owner', '--assignee');
    expect(sentencesWith(renamedTexts, renamedCli)).toContain(`the files installed at INSTALL_VERSION ${INSTALL_VERSION} name the flag --owner, which the CLI `
      + 'no longer has: an installed file became wrong, so bump INSTALL_VERSION in cli/constants/InstallVersion.ts (CLAUDE.md, Generated and installed files) '
      + 'and freeze the new version\'s surface');
  });

  test('a command and a status field the installed files name, removed from the CLI, fail the same way', () => {
    const withoutRework = cliSurfaceWithHelpReplaced('\n  rework', '\n  recount');
    expect(sentencesWith(INSTALLED_TEXTS, withoutRework).some((sentence) => sentence.includes('name the command rework, which the CLI no longer has'))).toBe(true);
    const withoutTicketRows = { ...cliSurface, statusJsonFields: new Set([...cliSurface.statusJsonFields].filter((field) => field !== 'ticketRows')) };
    expect(sentencesWith(INSTALLED_TEXTS, withoutTicketRows)).toEqual([`the files installed at INSTALL_VERSION ${INSTALL_VERSION} name the \`status --json\` field `
      + 'ticketRows, which the CLI no longer has: an installed file became wrong, so bump INSTALL_VERSION in cli/constants/InstallVersion.ts '
      + '(CLAUDE.md, Generated and installed files) and freeze the new version\'s surface']);
  });

  test('a reworded template or prompt sentence and a changed number trip nothing', () => {
    const rewordedBrief = withTextReplaced(INSTALLED_TEXTS, 'resources/templates/AgentBrief.md', 'Every section below', 'Each section that follows');
    const rewordedPrompt = withTextReplaced(rewordedBrief, 'dispatcher/run/utils/AgentPromptUtil.ts', 'As your very last act', 'As the last thing you do');
    const renumbered = withTextReplaced(rewordedPrompt, 'resources/templates/AgentBrief.md', 'Report under 150 words', 'Report under 180 words');
    expect(sentencesWith(renumbered, cliSurface)).toEqual([]);
  });

  test('a name newly installed is asked for under the current version', () => {
    const naming = withTextReplaced(INSTALLED_TEXTS, 'skill/SKILL.md', 'agent-progress help', 'agent-progress help and `agent-progress usage`');
    expect(sentencesWith(naming, cliSurface)).toEqual([
      `the installed files now name the command usage, which INSTALL_VERSION ${INSTALL_VERSION}'s frozen surface lacks: add it under "${INSTALL_VERSION}" in ${FROZEN_TABLE_PATH}`,
    ]);
  });

  test('a bump without a frozen surface for the new version fails and prints the surface to freeze', () => {
    const [sentence = ''] = sentencesWith(INSTALLED_TEXTS, cliSurface, INSTALL_VERSION + 1);
    expect(sentence).toStartWith(`${FROZEN_TABLE_PATH} has no surface for INSTALL_VERSION ${INSTALL_VERSION + 1}: add "${INSTALL_VERSION + 1}": {"commands":[`);
  });
});
