/**
 * That the environment is read in `lib/platform/Environment.ts` and nowhere else, so that every
 * override this tool honours is documented in one place and a second reader cannot make the same
 * variable decide two things.
 *
 * It is a scan for the text rather than the behaviour, in six spellings of the same door; every
 * needle is assembled from parts, because this file is inside the tree it scans. Comments are blanked
 * out first, so a docblock may name the object while explaining the rule.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join }                      from 'node:path';
import { describe, expect, test }    from 'bun:test';

const REPOSITORY_ROOT = join(import.meta.dir, '..');
const SCANNED_TREES   = ['cli', 'lib'];
const BINARY_ENTRY_POINT = 'agent-progress.ts';

/**
 * `lib/platform/Environment.spec.ts` is on the list because only an assignment made in this process,
 * after the import, can tell a getter from a value captured at load — a child process's environment
 * is complete before its first import runs. The list is exact in both directions.
 */
const FILES_ALLOWED_TO_READ_THE_ENVIRONMENT = ['lib/platform/Environment.ts', 'lib/platform/Environment.spec.ts'];

/** The pieces every needle is built from, so that no spelling appears in this file. */
const PROCESS_OBJECT        = 'process';
const BUN_OBJECT            = 'Bun';
const ENVIRONMENT_PROPERTY  = 'env';
/** A dot with any whitespace on either side, so a line-broken access is one pattern rather than two. */
const DOT_WITH_ANY_SPACING  = '\\s*\\.\\s*';

/** `process`, `node:process` and `bun`: the modules whose named `env` export is the same door as the global. */
const MODULE_EXPORTING_THE_ENVIRONMENT = `(?:(?:node:)?${PROCESS_OBJECT}|${BUN_OBJECT.toLowerCase()})`;

/**
 * Most are forms nothing here uses, which is the argument for having them: a read that breaks this
 * rule is likeliest to be written in whichever form the guard was not looking for.
 */
const ENVIRONMENT_ACCESS_PATTERNS = [
  new RegExp(`\\b${[PROCESS_OBJECT, ENVIRONMENT_PROPERTY].join(DOT_WITH_ANY_SPACING)}`, 'g'),
  new RegExp(`\\b${[BUN_OBJECT, ENVIRONMENT_PROPERTY].join(DOT_WITH_ANY_SPACING)}`, 'g'),
  new RegExp(`\\b${PROCESS_OBJECT}\\s*\\[\\s*['"]${ENVIRONMENT_PROPERTY}['"]\\s*\\]`, 'g'),
  new RegExp(`\\{[^{}]*\\b${ENVIRONMENT_PROPERTY}\\b[^{}]*\\}\\s*=\\s*(?:${PROCESS_OBJECT}|${BUN_OBJECT})\\b`, 'g'),
  new RegExp(`\\b${['import', 'meta', ENVIRONMENT_PROPERTY].join(DOT_WITH_ANY_SPACING)}`, 'g'),
  new RegExp(`\\bimport\\s[^;]*?\\{[^{}]*\\b${ENVIRONMENT_PROPERTY}\\b[^{}]*\\}\\s*from\\s*['"]${MODULE_EXPORTING_THE_ENVIRONMENT}['"]`, 'g'),
];

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

const SCANNED_FILES = [...SCANNED_TREES.flatMap((tree) => typeScriptFilesUnder(tree)), BINARY_ENTRY_POINT];

/** Blanked character for character rather than removed, so a match's line number is still its own. */
function codeWithCommentsBlanked(fileContents: string): string {
  return fileContents.replace(/\/\*[\s\S]*?\*\/|^[ \t]*\/\/.*$/gm, (comment) => comment.replace(/[^\n]/g, ' '));
}

function environmentAccessSites(): string[] {
  const sites: string[] = [];
  for (const file of SCANNED_FILES) {
    const code = codeWithCommentsBlanked(readFileSync(join(REPOSITORY_ROOT, file), 'utf8'));
    for (const pattern of ENVIRONMENT_ACCESS_PATTERNS) {
      for (const match of code.matchAll(pattern)) {
        const line = code.slice(0, match.index).split('\n').length;
        sites.push(`${file}:${line}`);
      }
    }
  }
  return sites.sort();
}

describe('reading the environment', () => {
  test('the scan opened the trees it is about, and the binary', () => {
    expect(SCANNED_FILES.length, 'TypeScript files under cli/ and lib/, plus the binary').toBeGreaterThanOrEqual(10);
    expect(SCANNED_FILES.some((file) => file.startsWith('lib/')), 'the walk reached lib/').toBe(true);
    expect(SCANNED_FILES.some((file) => file.startsWith('cli/')), 'the walk reached cli/').toBe(true);
    expect(SCANNED_FILES, 'the one module whose import is an invocation').toContain(BINARY_ENTRY_POINT);
  });

  /** A pattern that never matches is indistinguishable, from the outside, from a repository that obeys the rule. */
  test('it can still see an environment read where one exists, in every spelling', () => {
    const readsTheEnvironment = (line: string): boolean => ENVIRONMENT_ACCESS_PATTERNS.some((pattern) => new RegExp(pattern.source).test(line));
    expect(readsTheEnvironment(['const root = process', '.env[\'AGENT_PROGRESS_ROOT\'];'].join(''))).toBe(true);
    expect(readsTheEnvironment(['const root = Bun', '.env[\'AGENT_PROGRESS_ROOT\'];'].join(''))).toBe(true);
    expect(readsTheEnvironment(['const root = process', '[\'env\'][\'AGENT_PROGRESS_ROOT\'];'].join(''))).toBe(true);
    expect(readsTheEnvironment(['const root = process', '["env"]["AGENT_PROGRESS_ROOT"];'].join(''))).toBe(true);
    expect(readsTheEnvironment(['const { ', 'env', ' } = ', 'process', ';'].join(''))).toBe(true);
    expect(readsTheEnvironment(['const { ', 'env, argv', ' } = ', 'process', ';'].join(''))).toBe(true);
    expect(readsTheEnvironment(['const root = import', '.meta', '.env[\'AGENT_PROGRESS_ROOT\'];'].join(''))).toBe(true);
    expect(readsTheEnvironment(['const root = process', '\n  .env[\'AGENT_PROGRESS_ROOT\'];'].join(''))).toBe(true);
    expect(readsTheEnvironment(['const code = process', '.exitCode;'].join(''))).toBe(false);
    expect(readsTheEnvironment(['const here = import', '.meta', '.dir;'].join(''))).toBe(false);
    expect(readsTheEnvironment(['const { ', 'cwd', ' } = ', 'process', ';'].join(''))).toBe(false);
  });

  /** The module forms of the global: `import { env }` from a module leaves no `process.` in front of the read. */
  test('it sees a named environment import from process, node:process or bun, and no other named import', () => {
    const readsTheEnvironment = (line: string): boolean => ENVIRONMENT_ACCESS_PATTERNS.some((pattern) => new RegExp(pattern.source).test(line));
    expect(readsTheEnvironment(['import { ', 'env', ' } from \'node:', 'process\';'].join(''))).toBe(true);
    expect(readsTheEnvironment(['import { ', 'env', ' } from "', 'process";'].join(''))).toBe(true);
    expect(readsTheEnvironment(['import { ', 'env', ' } from \'', 'bun\';'].join(''))).toBe(true);
    expect(readsTheEnvironment(['import { argv, ', 'env', ' as environment } from \'node:', 'process\';'].join(''))).toBe(true);
    expect(readsTheEnvironment(['import {\n  cwd,\n  ', 'env', ',\n} from \'node:', 'process\';'].join(''))).toBe(true);
    expect(readsTheEnvironment(['import type { ', 'env', ' } from \'node:', 'process\';'].join(''))).toBe(true);
    expect(readsTheEnvironment(['const { ', 'env', ' } = ', 'Bun', ';'].join(''))).toBe(true);
    expect(readsTheEnvironment(['import { argv } from \'node:', 'process\';'].join(''))).toBe(false);
    expect(readsTheEnvironment(['import { ', 'env', ' } from \'./', 'Environment\';'].join(''))).toBe(false);
    expect(readsTheEnvironment(['import { environmentOf } from \'', 'bun\';'].join(''))).toBe(false);
  });

  test('no file outside the two allowed ones touches the environment', () => {
    const offenders = environmentAccessSites()
      .filter((site) => !FILES_ALLOWED_TO_READ_THE_ENVIRONMENT.some((allowed) => site.startsWith(`${allowed}:`)));
    expect(offenders, 'an override read here is one lib/platform/Environment.ts cannot document; ask it for a getter instead').toEqual([]);
  });

  test('both allowed files still touch it, so neither entry is a record of what the code used to do', () => {
    const sites = environmentAccessSites();
    for (const allowed of FILES_ALLOWED_TO_READ_THE_ENVIRONMENT) {
      expect(sites.some((site) => site.startsWith(`${allowed}:`)), `${allowed} no longer reads the environment; drop it from the list`).toBe(true);
    }
  });

  test('a comment naming the environment is not an offence, and a line of code is', () => {
    const commented = ['/** A docblock that mentions process', '.env and explains why. */'].join('');
    expect(ENVIRONMENT_ACCESS_PATTERNS.some((pattern) => new RegExp(pattern.source).test(codeWithCommentsBlanked(commented)))).toBe(false);
    const code = ['const root = process', '.env[\'AGENT_PROGRESS_ROOT\'];'].join('');
    expect(ENVIRONMENT_ACCESS_PATTERNS.some((pattern) => new RegExp(pattern.source).test(codeWithCommentsBlanked(code)))).toBe(true);
  });
});
