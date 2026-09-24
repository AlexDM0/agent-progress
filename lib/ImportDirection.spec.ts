/**
 * That imports run up the folder tree only. The eight claims are the test names below and the rule
 * they come from is stated in `lib/CLAUDE.md`.
 *
 * Every category is empty in a tree that obeys the rules, so the scan asserts a floor on the edges it
 * saw before judging anything, and the classifier is additionally handed a constructed edge of each
 * forbidden shape together with the legal edge it must not mistake for that shape.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative }   from 'node:path';
import { describe, expect, test }    from 'bun:test';

const REPOSITORY_ROOT = join(import.meta.dir, '..');
const SCANNED_TREES   = ['cli', 'lib'];
const BINARY_ENTRY_POINT = 'agent-progress.ts';

const FEATURE_FOLDERS               = ['lib/progress', 'lib/tickets', 'lib/render'];
const SUPPORT_FOLDERS_FOR_A_FEATURE = ['lib/platform', 'lib/utils', 'lib/constants'];
/** `lib/platform/` is itself support, so its own ceiling is lower than a feature's. */
const SUPPORT_FOLDERS_FOR_PLATFORM = ['lib/constants', 'lib/utils'];
const TOOLING_FOLDER               = 'lib/tooling';
const TEST_HARNESS_FOLDER          = `${TOOLING_FOLDER}/dev`;

/** A folder on disk that appears in none of the lists above is a layer nobody has decided on yet. */
const CLASSIFIED_LIB_FOLDERS = [...FEATURE_FOLDERS, ...SUPPORT_FOLDERS_FOR_A_FEATURE, TOOLING_FOLDER];

/** `cli/arguments/` is the shared parser: support that happens to live one level down, not a command. */
const SHARED_COMMAND_SUPPORT_FOLDER = 'cli/arguments';

const TEST_RUNNER_SPECIFIER = 'bun:test';

interface ModuleReference {
  /** Repository-relative, forward slashes, e.g. `cli/Main.ts`. */
  file:      string;
  line:      number;
  specifier: string;
}

type LayeringVerdict =
  | 'library-imports-the-command-surface'
  | 'shipped-code-imports-the-test-harness'
  | 'constants-imports-something'
  | 'utils-imports-beyond-constants'
  | 'feature-imports-a-sibling-feature'
  | 'command-imports-a-sibling-command'
  | 'binary-imports-beyond-the-command-surface'
  | null;

function typeScriptFilesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(REPOSITORY_ROOT, directory), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const entryPath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...typeScriptFilesUnder(entryPath));
    else if (entry.name.endsWith('.ts')) found.push(entryPath);
  }
  return found;
}

/**
 * Four forms, including the dynamic `import('…')` every entry of `cli/CommandTable.ts` is written as
 * and the `require('…')` nothing here uses yet: an edge that breaks a rule is likeliest to be written
 * in the form the guard was not looking for.
 */
function moduleReferencesOf(fileContents: string, file: string): ModuleReference[] {
  const references: ModuleReference[] = [];
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of fileContents.matchAll(pattern)) {
      const line = fileContents.slice(0, match.index).split('\n').length;
      references.push({ file, line, specifier: match[1]! });
    }
  }
  return references;
}

function resolveLocalSpecifier(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  return relative(REPOSITORY_ROOT, join(REPOSITORY_ROOT, dirname(file), specifier)).split('\\').join('/');
}

function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/**
 * A package or builtin (`node:fs`, `bun`, `marked`) resolves nowhere in this repository, so the folder rules cannot judge it;
 * the two lowest layers import none, bar the test runner a spec beside them needs.
 */
function bareSpecifierVerdictFor(fromFile: string, specifier: string): LayeringVerdict {
  if (fromFile.endsWith('.spec.ts') && specifier === TEST_RUNNER_SPECIFIER) return null;
  if (isInside(fromFile, 'lib/constants')) return 'constants-imports-something';
  if (isInside(fromFile, 'lib/utils')) return 'utils-imports-beyond-constants';
  return null;
}

/**
 * `null` for the flat level of `cli/` and for `cli/arguments/`, load-bearing in opposite directions:
 * the flat level as a source so the dispatch may name every command, `cli/arguments/` as a target so
 * every command may reach the shared parser.
 */
function commandFolderOf(path: string): string | null {
  const segments = path.split('/');
  if (segments.length < 3 || segments[0] !== 'cli') return null;
  const folder = `cli/${segments[1]!}`;
  return folder === SHARED_COMMAND_SUPPORT_FOLDER ? null : folder;
}

/** Both arguments are repository-relative paths and nothing else, so a test can hand it edges the tree does not have. */
function layeringVerdictFor(fromFile: string, toFile: string): LayeringVerdict {
  // A file may always import its own folder: a module and its spec live beside each other.
  if (dirname(fromFile) === dirname(toFile)) return null;
  if (isInside(fromFile, 'lib') && isInside(toFile, 'cli')) return 'library-imports-the-command-surface';
  // Checked before the binary and command rules on purpose: it is the stricter claim about the same
  // edge, and a shim reaching the harness should be reported as that rather than as a layering slip.
  if (isInside(toFile, TEST_HARNESS_FOLDER)) {
    if (isInside(fromFile, TEST_HARNESS_FOLDER) || fromFile.endsWith('.spec.ts')) return null;
    return 'shipped-code-imports-the-test-harness';
  }
  if (fromFile === BINARY_ENTRY_POINT) {
    return isInside(toFile, 'cli') ? null : 'binary-imports-beyond-the-command-surface';
  }
  const fromCommandFolder = commandFolderOf(fromFile);
  if (fromCommandFolder !== null) {
    const toCommandFolder = commandFolderOf(toFile);
    if (toCommandFolder !== null && toCommandFolder !== fromCommandFolder) return 'command-imports-a-sibling-command';
  }
  if (isInside(fromFile, 'lib/constants')) return 'constants-imports-something';
  if (isInside(fromFile, 'lib/utils')) {
    return isInside(toFile, 'lib/constants') ? null : 'utils-imports-beyond-constants';
  }
  if (!isInside(toFile, 'lib')) return null;
  const featureFolder = FEATURE_FOLDERS.find((folder) => isInside(fromFile, folder));
  if (featureFolder !== undefined) {
    const permitted = [featureFolder, ...SUPPORT_FOLDERS_FOR_A_FEATURE];
    return permitted.some((folder) => isInside(toFile, folder)) ? null : 'feature-imports-a-sibling-feature';
  }
  if (isInside(fromFile, 'lib/platform')) {
    const permitted = ['lib/platform', ...SUPPORT_FOLDERS_FOR_PLATFORM];
    return permitted.some((folder) => isInside(toFile, folder)) ? null : 'feature-imports-a-sibling-feature';
  }
  return null;
}

const SCANNED_FILES = [...SCANNED_TREES.flatMap((tree) => typeScriptFilesUnder(tree)), BINARY_ENTRY_POINT];

const ALL_REFERENCES  = SCANNED_FILES.flatMap((file) => moduleReferencesOf(readFileSync(join(REPOSITORY_ROOT, file), 'utf8'), file));
const LOCAL_REFERENCES = ALL_REFERENCES.flatMap((reference) => {
  const target = resolveLocalSpecifier(reference.file, reference.specifier);
  return target === null ? [] : [{ ...reference, target }];
});
const BARE_REFERENCES = ALL_REFERENCES.filter((reference) => resolveLocalSpecifier(reference.file, reference.specifier) === null);

function complaintsFor(verdict: LayeringVerdict): string[] {
  const localComplaints = LOCAL_REFERENCES
    .filter((reference) => layeringVerdictFor(reference.file, reference.target) === verdict)
    .map((reference) => `${reference.file}:${reference.line} imports ${reference.target}`);
  const bareComplaints = BARE_REFERENCES
    .filter((reference) => bareSpecifierVerdictFor(reference.file, reference.specifier) === verdict)
    .map((reference) => `${reference.file}:${reference.line} imports ${reference.specifier}`);
  return [...localComplaints, ...bareComplaints].sort();
}

describe('the scan itself', () => {
  /** The floors are round numbers well under the current counts, to fail a walk that reached the wrong directory. */
  test('it opened both trees and the binary, and found imports crossing folders in them', () => {
    expect(SCANNED_FILES.length, 'TypeScript files under cli/ and lib/, plus the binary').toBeGreaterThanOrEqual(20);
    expect(LOCAL_REFERENCES.length, 'imports resolving inside this repository').toBeGreaterThanOrEqual(10);
    expect(SCANNED_FILES.some((file) => file.startsWith('lib/')), 'the walk reached lib/').toBe(true);
    expect(SCANNED_FILES.some((file) => file.startsWith('cli/')), 'the walk reached cli/').toBe(true);
    // Named rather than left to the count: one file cannot move a floor.
    expect(LOCAL_REFERENCES.filter((reference) => reference.file === BINARY_ENTRY_POINT).length, 'imports found in agent-progress.ts').toBeGreaterThanOrEqual(2);
  });

  /** The specs beside the two lowest layers import the test runner, so a scan that dropped bare specifiers there finds none. */
  test('it sees package and builtin imports too, including in the two lowest layers', () => {
    expect(BARE_REFERENCES.length, 'imports of a package or builtin').toBeGreaterThanOrEqual(20);
    expect(BARE_REFERENCES.some((reference) => isInside(reference.file, 'lib/utils')), 'a bare import under lib/utils/').toBe(true);
    expect(BARE_REFERENCES.some((reference) => isInside(reference.file, 'lib/constants')), 'a bare import under lib/constants/').toBe(true);
  });

  test('the classifier judges a package or builtin import by the layer it is made from', () => {
    expect(bareSpecifierVerdictFor('lib/utils/ExampleUtil.ts', 'node:fs')).toBe('utils-imports-beyond-constants');
    expect(bareSpecifierVerdictFor('lib/utils/ExampleUtil.ts', 'marked')).toBe('utils-imports-beyond-constants');
    expect(bareSpecifierVerdictFor('lib/utils/ExampleUtil.ts', TEST_RUNNER_SPECIFIER)).toBe('utils-imports-beyond-constants');
    expect(bareSpecifierVerdictFor('lib/utils/ExampleUtil.spec.ts', 'node:fs')).toBe('utils-imports-beyond-constants');
    expect(bareSpecifierVerdictFor('lib/utils/ExampleUtil.spec.ts', TEST_RUNNER_SPECIFIER)).toBe(null);
    expect(bareSpecifierVerdictFor('lib/constants/Example.ts', 'bun')).toBe('constants-imports-something');
    expect(bareSpecifierVerdictFor('lib/constants/Example.ts', 'node:path')).toBe('constants-imports-something');
    expect(bareSpecifierVerdictFor('lib/constants/Example.spec.ts', TEST_RUNNER_SPECIFIER)).toBe(null);
    expect(bareSpecifierVerdictFor('lib/platform/Example.ts', 'node:fs')).toBe(null);
    expect(bareSpecifierVerdictFor('lib/render/Example.ts', 'marked')).toBe(null);
  });

  test('it sees the dynamic imports the command table is written as, not only the static ones', () => {
    const fromTheCommandTable = LOCAL_REFERENCES.filter((reference) => reference.file === 'cli/CommandTable.ts');
    expect(fromTheCommandTable.length, 'module specifiers found in cli/CommandTable.ts').toBeGreaterThanOrEqual(9);
  });

  /** The needle is assembled from parts: written out, it would be the first thing the scan found. */
  test('it sees a require() call, the one form nothing in the tree uses yet', () => {
    const constructed = ['const store = ', 'require', '(\'../progress/ProgressStore\');'].join('');
    const seen = moduleReferencesOf(constructed, 'lib/render/Html.ts');
    expect(seen.map((reference) => reference.specifier)).toEqual(['../progress/ProgressStore']);
  });

  /** Until a new folder is placed in a layer, every edge out of it falls through the classifier to `null`. */
  test('every folder under lib/ is classified, so a new one fails until it is placed in a layer', () => {
    const foldersOnDisk = readdirSync(join(REPOSITORY_ROOT, 'lib'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map((entry) => `lib/${entry.name}`)
      .sort();
    expect(foldersOnDisk, 'a folder here that no rule names is a layer nobody has decided on; add it to a list above').toEqual([...CLASSIFIED_LIB_FOLDERS].sort());
  });

  test('the classifier still recognises each forbidden shape, and each legal one', () => {
    expect(layeringVerdictFor('lib/progress/ProgressStore.ts', 'cli/Main.ts')).toBe('library-imports-the-command-surface');
    expect(layeringVerdictFor('cli/Main.ts', 'lib/progress/ProgressStore.ts')).toBe(null);

    expect(layeringVerdictFor('lib/render/Html.ts', 'lib/tooling/dev/ScratchWorkspace.ts')).toBe('shipped-code-imports-the-test-harness');
    expect(layeringVerdictFor('lib/render/Html.spec.ts', 'lib/tooling/dev/ScratchWorkspace.ts')).toBe(null);

    expect(layeringVerdictFor('lib/constants/Statuses.ts', 'lib/utils/TimeUtil.ts')).toBe('constants-imports-something');
    expect(layeringVerdictFor('lib/constants/Statuses.spec.ts', 'lib/constants/Statuses.ts')).toBe(null);

    expect(layeringVerdictFor('lib/utils/TimeUtil.ts', 'lib/platform/Environment.ts')).toBe('utils-imports-beyond-constants');
    expect(layeringVerdictFor('lib/utils/TimeUtil.ts', 'lib/constants/Limits.ts')).toBe(null);

    expect(layeringVerdictFor('lib/tickets/TicketStore.ts', 'lib/progress/ProgressStore.ts')).toBe('feature-imports-a-sibling-feature');
    expect(layeringVerdictFor('lib/render/page/GanttGeometry.ts', 'lib/tickets/TicketStore.ts')).toBe('feature-imports-a-sibling-feature');
    expect(layeringVerdictFor('lib/platform/Workspace.ts', 'lib/tickets/TicketStore.ts')).toBe('feature-imports-a-sibling-feature');
    expect(layeringVerdictFor('lib/tickets/TicketStore.ts', 'lib/platform/Workspace.ts')).toBe(null);
    expect(layeringVerdictFor('lib/render/page/GanttGeometry.ts', 'lib/constants/Types.ts')).toBe(null);
    expect(layeringVerdictFor('lib/platform/Workspace.ts', 'lib/constants/Statuses.ts')).toBe(null);
  });

  test('rule 6: the classifier tells a sibling command from the dispatch, the shared parser and the flat level', () => {
    expect(layeringVerdictFor('cli/task/TaskCommand.ts', 'cli/ticket/TicketCommand.ts')).toBe('command-imports-a-sibling-command');
    expect(layeringVerdictFor('cli/ticket/TicketCommand.ts', 'cli/task/TaskCommand.ts')).toBe('command-imports-a-sibling-command');
    expect(layeringVerdictFor('cli/task/TaskCommand.ts', 'cli/arguments/ArgumentParser.ts')).toBe(null);
    expect(layeringVerdictFor('cli/task/TaskCommand.ts', 'cli/CommandSupport.ts')).toBe(null);
    expect(layeringVerdictFor('cli/CommandTable.ts', 'cli/task/TaskCommand.ts')).toBe(null);
    expect(layeringVerdictFor('cli/task/TaskCommand.ts', 'lib/progress/ProgressStore.ts')).toBe(null);
    expect(layeringVerdictFor('cli/task/TaskCommand.spec.ts', 'cli/task/TaskCommand.ts')).toBe(null);
  });

  test('rule 7: the classifier lets the binary reach cli/ and nothing else', () => {
    expect(layeringVerdictFor(BINARY_ENTRY_POINT, 'cli/Main.ts')).toBe(null);
    expect(layeringVerdictFor(BINARY_ENTRY_POINT, 'cli/CommandContext.ts')).toBe(null);
    expect(layeringVerdictFor(BINARY_ENTRY_POINT, 'lib/progress/ProgressStore.ts')).toBe('binary-imports-beyond-the-command-surface');
    expect(layeringVerdictFor(BINARY_ENTRY_POINT, 'lib/constants/Limits.ts')).toBe('binary-imports-beyond-the-command-surface');
    expect(layeringVerdictFor(BINARY_ENTRY_POINT, 'lib/tooling/dev/CliProcess.ts')).toBe('shipped-code-imports-the-test-harness');
  });
});

describe('the import direction', () => {
  test('rule 1: nothing under lib/ imports cli/', () => {
    expect(complaintsFor('library-imports-the-command-surface')).toEqual([]);
  });

  test('rule 2: nothing that ships imports the test harness', () => {
    expect(complaintsFor('shipped-code-imports-the-test-harness')).toEqual([]);
  });

  test('rule 3: lib/constants/ imports nothing outside itself', () => {
    expect(complaintsFor('constants-imports-something')).toEqual([]);
  });

  test('rule 4: lib/utils/ imports only lib/constants/', () => {
    expect(complaintsFor('utils-imports-beyond-constants')).toEqual([]);
  });

  test('rule 5: a feature imports no sibling feature', () => {
    expect(complaintsFor('feature-imports-a-sibling-feature')).toEqual([]);
  });

  test('rule 6: a command folder imports no sibling command folder', () => {
    expect(complaintsFor('command-imports-a-sibling-command')).toEqual([]);
  });

  test('rule 7: agent-progress.ts imports cli/ and nothing else', () => {
    expect(complaintsFor('binary-imports-beyond-the-command-surface')).toEqual([]);
  });
});

describe('the shape of a module', () => {
  /** A barrel makes one specifier stand for an unknown set of modules, so no import block could be read as a dependency list. */
  test('rule 8: no file re-exports another, because there are no barrels', () => {
    const reExports: string[] = [];
    for (const file of SCANNED_FILES) {
      const contents = readFileSync(join(REPOSITORY_ROOT, file), 'utf8');
      for (const match of contents.matchAll(/(?:^|\n)\s*export\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/g)) {
        reExports.push(`${file} re-exports ${match[1]!}`);
      }
    }
    expect(reExports).toEqual([]);
  });
});
