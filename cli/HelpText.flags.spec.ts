/**
 * Every option a command's parser accepts is named in its `agent-progress help` entry and in its `docs/cli.md` row, and
 * neither names one the parser refuses. The accepted names are read off the handlers themselves: each runs with a parser
 * that stops at `rejectUnknownOptions` and keeps the list it was handed, so no list is copied here. `--json` is held
 * apart, against the one sentence in each text naming the commands that refuse it. The scans prove they found entries,
 * and the comparison is watched failing on a planted missing and a planted extra option in each text.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test
}                       from 'bun:test';

import { createScratchDirectory, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { COMMAND_NAMES, commandLoaderFor }                from './CommandTable.ts';
import { helpText }                                       from './HelpText.ts';
import { createArgumentParser, type ArgumentParser }      from './arguments/ArgumentParser.ts';
import { createCapturedCommandContext }                   from './testing/CapturedCommandContext.ts';

const HELP_TEXT      = helpText();
const REFERENCE_TEXT = readFileSync(join(import.meta.dir, '..', 'docs', 'cli.md'), 'utf8');

const COMMANDS_WITH_SUBCOMMANDS = new Set(['task', 'ticket', 'epic']);

const JSON_OPTION_NAME = 'json';

/** The help's prose starts at this column; a line indented less carries a signature, possibly followed by prose after a gap. */
const HELP_DESCRIPTION_COLUMN = 30;

const SIGNATURE_PROSE_GAP = /\s{2,}/;

/** A signature ends on a bracket, a placeholder or a quoted argument, or is bare words; anything else is prose run into it. */
const SIGNATURE_ENDING = /(?:[\]>"]|^[a-z |-]+)$/;

const REFERENCE_COMMAND_TABLE_HEADER = '| command | what it does |';

/** `ticket status` documents its options as "the same options" as the named moves rather than listing them. */
const ENTRIES_DOCUMENTED_AS_ANOTHER = new Map([['ticket status', 'ticket start']]);

/** The one command whose handler never checks its options: it prints the reference whatever follows it. */
const COMMAND_IGNORING_ITS_OPTIONS = 'help';

type OptionNamesByEntry = Map<string, Set<string>>;

class OptionListRecorded extends Error {
  constructor(readonly optionNames: readonly string[]) {
    super('the option list was recorded');
  }
}

function signatureLineIndentationOf(line: string): number | null {
  const indentation = line.length - line.trimStart().length;
  if (line.trim() === '' || indentation === 0 || indentation >= HELP_DESCRIPTION_COLUMN) return null;
  return indentation;
}

/** Prose begins after a gap, or at the prose column right after one space when a signature fills the column before it. */
function signaturePartOf(line: string): string {
  const proseStartsAtItsColumn = line[HELP_DESCRIPTION_COLUMN - 1] === ' ' && /[A-Za-z`]/.test(line[HELP_DESCRIPTION_COLUMN] ?? '');
  const signatureText          = proseStartsAtItsColumn ? line.slice(0, HELP_DESCRIPTION_COLUMN) : line;
  return signatureText.trimStart().split(SIGNATURE_PROSE_GAP)[0]?.trimEnd() ?? '';
}

function signatureLinePartsOf(text: string): string[] {
  return text.split('\n')
    .filter((line) => signatureLineIndentationOf(line) !== null)
    .map(signaturePartOf);
}

/** An entry starts at column 2; its continuation signature lines are indented further, short of the prose column. */
function helpSignaturesOf(text: string): string[] {
  const signatures: string[] = [];
  for (const line of text.split('\n')) {
    const indentation = signatureLineIndentationOf(line);
    if (indentation === null) continue;
    const signaturePart = signaturePartOf(line);
    if (indentation === 2 || signatures.length === 0) signatures.push(signaturePart);
    else signatures[signatures.length - 1] = `${signatures.at(-1) ?? ''} ${signaturePart}`;
  }
  return signatures;
}

function referenceSignaturesOf(text: string): string[] {
  const signatures: string[] = [];
  let insideCommandTable = false;
  for (const line of text.split('\n')) {
    if (line === REFERENCE_COMMAND_TABLE_HEADER) {
      insideCommandTable = true;
      continue;
    }
    if (!line.startsWith('|')) insideCommandTable = false;
    if (!insideCommandTable) continue;
    const signature = /^\| `(.+?)` \|/.exec(line)?.[1];
    if (signature !== undefined) signatures.push(signature.replaceAll('\\|', '|'));
  }
  return signatures;
}

function entryKeysOf(signature: string): string[] {
  const [commandWord = '', secondWord = ''] = signature.trim().split(/\s+/);
  if (!COMMANDS_WITH_SUBCOMMANDS.has(commandWord)) return [commandWord];
  return secondWord.split('|').map((subcommand) => `${commandWord} ${subcommand}`);
}

function documentedOptionNamesOf(signatures: readonly string[]): OptionNamesByEntry {
  const documented: OptionNamesByEntry = new Map();
  for (const signature of signatures) {
    const optionNames = [...signature.matchAll(/--([a-z][a-z-]*)/g)].map((match) => match[1] ?? '');
    for (const entryKey of entryKeysOf(signature)) {
      documented.set(entryKey, new Set([...documented.get(entryKey) ?? [], ...optionNames]));
    }
  }
  for (const [entryKey, documentedAs] of ENTRIES_DOCUMENTED_AS_ANOTHER) {
    if (documented.has(entryKey)) documented.set(entryKey, new Set([...documented.get(entryKey) ?? [], ...documented.get(documentedAs) ?? []]));
  }
  return documented;
}

/** The commands a text says refuse `--json`, read from its "accepted by every command but …" sentence. */
function commandsRefusingJsonIn(text: string): string[] {
  const flattened = text.replaceAll(/\s+/g, ' ');
  const listed    = /ccepted by every command but (.+?),? (?:and )?prints/.exec(flattened)?.[1] ?? '';
  return listed.split(/,\s*|\s+and\s+/).map((word) => word.replaceAll('`', '').trim()).filter((word) => word !== '');
}

function optionMismatchesBetween(accepted: OptionNamesByEntry, documented: OptionNamesByEntry, textName: string): string[] {
  const mismatches: string[] = [];
  for (const [entryKey, acceptedNames] of accepted) {
    const documentedNames = documented.get(entryKey) ?? new Set<string>();
    for (const name of acceptedNames) {
      if (name !== JSON_OPTION_NAME && !documentedNames.has(name)) mismatches.push(`${textName}: \`${entryKey}\` accepts --${name} and does not name it`);
    }
    for (const name of documentedNames) {
      if (!acceptedNames.has(name)) mismatches.push(`${textName}: \`${entryKey}\` names --${name}, which it refuses`);
    }
  }
  return mismatches;
}

/** Null when the handler finished without ever checking its options. */
async function acceptedOptionNamesOf(entryKey: string, scratchDirectory: string): Promise<Set<string> | null> {
  const [commandWord = '', subcommand] = entryKey.split(' ');
  const loadCommand = commandLoaderFor(commandWord);
  if (loadCommand === undefined) throw new Error(`\`${commandWord}\` is documented and is no command`);
  const runCommand = await loadCommand();

  const parser = createArgumentParser(subcommand === undefined ? [] : [subcommand]);
  const recordingParser: ArgumentParser = {
    ...parser,
    rejectUnknownOptions: (knownOptionNames) => {
      throw new OptionListRecorded(knownOptionNames);
    },
  };
  try {
    await runCommand(recordingParser, createCapturedCommandContext({ currentDirectory: scratchDirectory }));
  } catch (error) {
    if (error instanceof OptionListRecorded) return new Set(error.optionNames);
    throw error;
  }
  return null;
}

const HELP_DOCUMENTED      = documentedOptionNamesOf(helpSignaturesOf(HELP_TEXT));
const REFERENCE_DOCUMENTED = documentedOptionNamesOf(referenceSignaturesOf(REFERENCE_TEXT));
const ENTRY_KEYS           = [...new Set([...HELP_DOCUMENTED.keys(), ...REFERENCE_DOCUMENTED.keys()])].sort();

const accepted: OptionNamesByEntry = new Map();
const entriesNeverCheckingOptions: string[] = [];
let scratchDirectory = '';

beforeAll(async () => {
  scratchDirectory = createScratchDirectory('help-flags');
  for (const entryKey of ENTRY_KEYS) {
    const optionNames = await acceptedOptionNamesOf(entryKey, scratchDirectory);
    if (optionNames === null) entriesNeverCheckingOptions.push(entryKey);
    accepted.set(entryKey, optionNames ?? new Set());
  }
});

afterAll(() => {
  removeScratchDirectory(scratchDirectory);
});

describe('the scans', () => {
  test('find an entry for every command in both texts, before anything is concluded from what they did not find', () => {
    const helpCommands      = new Set([...HELP_DOCUMENTED.keys()].map((entryKey) => entryKey.split(' ')[0]));
    const referenceCommands = new Set([...REFERENCE_DOCUMENTED.keys()].map((entryKey) => entryKey.split(' ')[0]));
    expect(COMMAND_NAMES.filter((name) => !helpCommands.has(name)), 'commands with no help entry').toEqual([]);
    expect(COMMAND_NAMES.filter((name) => !referenceCommands.has(name)), 'commands with no docs/cli.md row').toEqual([]);
    expect(ENTRY_KEYS.length, 'commands and subcommands documented').toBeGreaterThanOrEqual(45);
    expect([...accepted.values()].reduce((count, names) => count + names.size, 0), 'accepted options read off the handlers').toBeGreaterThanOrEqual(100);
  });

  test('the help and docs/cli.md document the same commands and subcommands', () => {
    expect([...HELP_DOCUMENTED.keys()].sort()).toEqual([...REFERENCE_DOCUMENTED.keys()].sort());
  });

  test('every help signature line ends where its prose begins, so no option is read out of prose', () => {
    expect(signatureLinePartsOf(HELP_TEXT).filter((part) => !SIGNATURE_ENDING.test(part))).toEqual([]);
  });

  test('a signature line run into its prose is caught', () => {
    const planted = HELP_TEXT.replace('      [--rebased-from <old tip>]\n', '      [--rebased-from <old tip>] removed lines, never blank lines\n');
    expect(planted).not.toBe(HELP_TEXT);
    expect(signatureLinePartsOf(planted).filter((part) => !SIGNATURE_ENDING.test(part))).not.toEqual([]);
  });

  test('every handler but help checks its options before it does anything', () => {
    expect(entriesNeverCheckingOptions).toEqual([COMMAND_IGNORING_ITS_OPTIONS]);
  });
});

describe('the options each command accepts', () => {
  test('are exactly the ones its help entry names', () => {
    expect(optionMismatchesBetween(accepted, HELP_DOCUMENTED, 'help')).toEqual([]);
  });

  test('are exactly the ones its docs/cli.md row names', () => {
    expect(optionMismatchesBetween(accepted, REFERENCE_DOCUMENTED, 'docs/cli.md')).toEqual([]);
  });

  test('include --json on every command but the ones each text says refuse it', () => {
    const refusingInHelp      = commandsRefusingJsonIn(HELP_TEXT);
    const refusingInReference = commandsRefusingJsonIn(REFERENCE_TEXT);
    expect(refusingInHelp, 'the help\'s --json sentence').toEqual(['init', 'update', 'render', 'open', 'hook', 'help']);
    expect(refusingInReference, 'docs/cli.md\'s --json convention').toEqual(refusingInHelp);
    const contradicting = [...accepted].filter(([entryKey, names]) => names.has(JSON_OPTION_NAME) === refusingInHelp.includes(entryKey.split(' ')[0] ?? ''));
    expect(contradicting.map(([entryKey]) => entryKey)).toEqual([]);
  });

  test('a flag deleted from either text is caught', () => {
    const helpWithout      = documentedOptionNamesOf(helpSignaturesOf(HELP_TEXT.replace('[--tickets-only]', ' '.repeat('[--tickets-only]'.length))));
    const referenceWithout = documentedOptionNamesOf(referenceSignaturesOf(REFERENCE_TEXT.replace('[--tickets-only]', '')));
    expect(optionMismatchesBetween(accepted, helpWithout, 'help')).toEqual(['help: `status` accepts --tickets-only and does not name it']);
    expect(optionMismatchesBetween(accepted, referenceWithout, 'docs/cli.md')).toEqual(['docs/cli.md: `status` accepts --tickets-only and does not name it']);
  });

  test('a flag either text offers and the parser refuses is caught', () => {
    const helpWith      = documentedOptionNamesOf(helpSignaturesOf(HELP_TEXT.replace('clear [--all] [--yes]', 'clear [--all] [--yes] [--force]')));
    const referenceWith = documentedOptionNamesOf(referenceSignaturesOf(REFERENCE_TEXT.replace('`clear [--all] [--yes]`', '`clear [--all] [--yes] [--force]`')));
    expect(optionMismatchesBetween(accepted, helpWith, 'help')).toEqual(['help: `clear` names --force, which it refuses']);
    expect(optionMismatchesBetween(accepted, referenceWith, 'docs/cli.md')).toEqual(['docs/cli.md: `clear` names --force, which it refuses']);
  });
});
