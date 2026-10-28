/**
 * The rules of the root `CLAUDE.md` that `eslint.config.js` holds, each watched failing: every form a rule claims is planted at a path
 * it governs and must be reported by that rule, and each exact exception (the one module allowed a reach, a spec, a constants folder, an
 * arithmetic identity) is planted too and must pass. `bun run lint` is what proves the tree itself passes.
 */
import { describe, expect, test } from 'bun:test';
import { ESLint }                 from 'eslint';

import { repositoryRootOfThisCheckout } from './testing/ImportGraph.ts';

interface PlantedViolation {
  readonly path:   string;
  readonly text:   string;
  readonly ruleId: string;
}

const MECHANISED_RULE_IDS = [
  'no-restricted-properties',
  'no-restricted-globals',
  'no-restricted-imports',
  'no-restricted-syntax',
  '@typescript-eslint/no-non-null-assertion',
  'no-warning-comments',
  '@typescript-eslint/consistent-type-imports',
  'id-length',
  '@typescript-eslint/no-magic-numbers',
];

const LINTER = new ESLint({ cwd: repositoryRootOfThisCheckout() });

async function ruleIdsReportedFor(path: string, text: string): Promise<string[]> {
  const [result] = await LINTER.lintText(text, { filePath: path });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'parse-error');
}

const HOME_DIRECTORY_IMPORT = 'import { homedir } from \'node:os\';\n\nexport const home = homedir();\n';

const PLANTED_VIOLATIONS: readonly PlantedViolation[] = [
  { path: 'cli/Planted.ts', text: 'export const home = process.env[\'HOME\'];\n', ruleId: 'no-restricted-properties' },
  { path: 'cli/Planted.ts', text: 'process.exit(1);\n', ruleId: 'no-restricted-properties' },
  { path: 'cli/CommandContext.ts', text: 'process.chdir(\'/\');\n', ruleId: 'no-restricted-properties' },
  { path: 'src/Planted.ts', text: 'export const here = process.cwd();\n', ruleId: 'no-restricted-properties' },
  { path: 'cli/Planted.ts', text: HOME_DIRECTORY_IMPORT, ruleId: 'no-restricted-imports' },
  { path: 'page/Planted.ts', text: 'export const storage = window.localStorage;\n', ruleId: 'no-restricted-properties' },
  { path: 'page/Planted.ts', text: 'export const storage = window.sessionStorage;\n', ruleId: 'no-restricted-properties' },
  { path: 'page/Planted.ts', text: 'export const stored = sessionStorage.getItem(\'key\');\n', ruleId: 'no-restricted-globals' },
  { path: 'page/Planted.ts', text: 'export const stored = localStorage.getItem(\'key\');\n', ruleId: 'no-restricted-globals' },
  {
    path:   'page/preferences/ViewerPreferences.ts',
    text:   'export const storage = (): Storage => window.localStorage;\n',
    ruleId: 'no-restricted-properties',
  },
  { path: 'cli/Planted.ts', text: 'export const now = Date.now();\n', ruleId: 'no-restricted-syntax' },
  { path: 'src/Planted.ts', text: 'export const now = new Date();\n', ruleId: 'no-restricted-syntax' },
  { path: 'cli/Planted.ts', text: 'export const firstOf = (list: string[]): string => list[0]!;\n', ruleId: '@typescript-eslint/no-non-null-assertion' },
  ...['TODO', 'FIXME', 'XXX', 'HACK'].map((term) => ({ path: 'cli/Planted.ts', text: `// ${term}: name the value\nexport const value = 1;\n`, ruleId: 'no-warning-comments' })),
  {
    path:   'cli/Planted.ts',
    text:   'import { CommandContext } from \'./CommandContext.ts\';\n\nexport type Alias = CommandContext;\n',
    ruleId: '@typescript-eslint/consistent-type-imports',
  },
  { path: 'cli/Planted.ts', text: 'export const x = \'value\';\n', ruleId: 'id-length' },
  { path: 'page/Planted.ts', text: 'export const scaled = (side: number): number => side * 7;\n', ruleId: '@typescript-eslint/no-magic-numbers' },
];

const PLANTED_EXCEPTIONS: readonly (readonly [string, string, string])[] = [
  ['the environment module reading the environment', 'src/shared/Environment.ts', 'export const home = process.env[\'HOME\'];\n'],
  ['the binary exiting', 'agent-progress.ts', 'process.exit(1);\n'],
  ['the host binary exiting', 'agent-host.ts', 'process.exit(1);\n'],
  ['the command context reading the directory', 'cli/CommandContext.ts', 'export const here = process.cwd();\n'],
  ['the command context reading the home directory', 'cli/CommandContext.ts', HOME_DIRECTORY_IMPORT],
  ['the preference store reaching storage', 'page/preferences/PreferenceStore.ts', 'export const storage = (): Storage => window.sessionStorage;\n'],
  ['the command context reading the clock', 'cli/CommandContext.ts', 'export const now = (): Date => new Date();\n'],
  ['the page reading the clock', 'page/Planted.ts', 'export const now = Date.now();\n'],
  ['a spec reading the clock', 'cli/Planted.spec.ts', 'export const now = Date.now();\n'],
  ['a dated Date', 'cli/Planted.ts', 'export const epoch = new Date(0);\n'],
  ['a loop index and a comparator pair', 'cli/Planted.ts', 'export const sorted = [\'b\', \'a\'].sort((a, b) => a.localeCompare(b)).map((value, i) => `${value}${i}`);\n'],
  ['arithmetic identities', 'page/Planted.ts', 'export const share = (part: number): string => (part * 100 / 2 - 1).toString(16);\n'],
  ['a number in a constants folder', 'page/constants/Planted.ts', 'export const scaled = (side: number): number => side * 7;\n'],
  ['a number in a spec', 'page/Planted.spec.ts', 'export const scaled = (side: number): number => side * 7;\n'],
];

describe('the mechanised CLAUDE.md rules in eslint.config.js', () => {
  test.each(PLANTED_VIOLATIONS.map((planted) => [`${planted.ruleId} in ${planted.path}: ${planted.text.trim()}`, planted] as const))(
    'reports %s',
    async (_title, planted) => {
      expect(await ruleIdsReportedFor(planted.path, planted.text)).toContain(planted.ruleId);
    },
  );

  test.each(PLANTED_EXCEPTIONS)('lets through %s', async (_title, path, text) => {
    const reported = await ruleIdsReportedFor(path, text);
    expect(reported.filter((ruleId) => MECHANISED_RULE_IDS.includes(ruleId) || ruleId === 'parse-error')).toEqual([]);
  });
});
