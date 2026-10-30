/**
 * Every command text the CLI prints (a refusal, a usage line, a suggested command, the help, a hook command) names the program through
 * `PRODUCT_NAMES.PROGRAM`, so a build named beside the released program never tells an agent to run the other one. The scan reads the
 * string and template literals of every non-spec source under `src/`, `cli/` and `bridge/` (`.tsx` included) from the syntax
 * tree, so a comment is never
 * command text; a brief's `agent-progress row:`, `ticket:` or `review:` line is a marker the dispatcher writes and the hook reads, not a
 * command. What remains must be in the allowlist, exact both ways. The scan first proves it read the sources, and each form is planted.
 */
import { describe, expect, test } from 'bun:test';
import ts                         from 'typescript';

import { repositoryRootOfThisCheckout } from './testing/ImportGraph.ts';
import { repositoryTypeScriptSources }  from './testing/RepositorySources.ts';

interface LiteralFinding {
  readonly path:    string;
  readonly literal: string;
}

const SCANNED_FOLDERS = ['src/', 'cli/', 'bridge/'];

const PRODUCT_NAMES_PATH = 'src/shared/constants/ProductNames.ts';

const REPOSITORY_SOURCES = repositoryTypeScriptSources(repositoryRootOfThisCheckout());

/** Read from the constant's source, since a guard at the repository root imports nothing of the tree; the released name comes first. */
const PROGRAM_NAMES = [...(REPOSITORY_SOURCES.find(({ path }) => path === PRODUCT_NAMES_PATH)?.text ?? '').matchAll(/\bPROGRAM: +'([^']+)'/g)]
  .map(([, name = '']) => name);

const [RELEASED_PROGRAM = ''] = PROGRAM_NAMES;

/** Each one a literal the program's name must stay written in, with why. */
const ALLOWED_LITERALS: readonly LiteralFinding[] = [
  // The names themselves.
  ...PROGRAM_NAMES.map((name) => ({ path: PRODUCT_NAMES_PATH, literal: name })),
];

/** The name standing alone, longest first: not inside a path, a folder, a file name, a longer name or a storage key. */
const LITERAL_PROGRAM_PATTERN = new RegExp(`(?<![\\w./-])(?:${[...PROGRAM_NAMES].sort((a, b) => b.length - a.length).map((name) => RegExp.escape(name))
  .join('|')})(?![\\w.:/-])`);

const BRIEF_MARKER_PATTERN = new RegExp(`${RegExp.escape(RELEASED_PROGRAM)} (?:row|ticket|review):`, 'g');

/** Comfortably under today's counts, so a scan that read the wrong folder fails rather than passing on nothing. */
const SMALLEST_SCANNED_FILE_COUNT = 300;
const SMALLEST_SCANNED_LITERAL_COUNT = 5_000;

function isScannedPath(path: string): boolean {
  return SCANNED_FOLDERS.some((folder) => path.startsWith(folder)) && !path.endsWith('.spec.ts') && !path.endsWith('.dom.tsx')
    && !path.split('/').includes('testing');
}

/** The cooked text of every string and template literal part, in source order. */
function literalTextsOf(path: string, sourceText: string): string[] {
  const sourceFile = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      texts.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return texts;
}

function namesTheProgramLiterally(literal: string): boolean {
  return LITERAL_PROGRAM_PATTERN.test(literal.replaceAll(BRIEF_MARKER_PATTERN, ''));
}

function literalFindingsOf(sources: readonly { path: string; text: string }[]): LiteralFinding[] {
  return sources.flatMap(({ path, text }) => literalTextsOf(path, text).filter(namesTheProgramLiterally).map((literal) => ({ path, literal })));
}

function findingKey({ path, literal }: LiteralFinding): string {
  return `${path}: ${JSON.stringify(literal)}`;
}

const SCANNED_SOURCES = REPOSITORY_SOURCES.filter(({ path }) => isScannedPath(path));

describe('the scan itself', () => {
  test('it reads both program names from the constant, the released one first', () => {
    expect(PROGRAM_NAMES).toEqual(['agent-progress', 'agent-progress-v2']);
  });

  test('it reads the non-spec sources of src/, cli/ and bridge/, a component among them, and the literals in them', () => {
    expect(SCANNED_SOURCES.map(({ path }) => path)).toContain('bridge/shell/ConnectionBanners.tsx');
    expect(SCANNED_SOURCES.length).toBeGreaterThan(SMALLEST_SCANNED_FILE_COUNT);
    for (const folder of SCANNED_FOLDERS) expect(SCANNED_SOURCES.some(({ path }) => path.startsWith(folder)), folder).toBe(true);
    expect(SCANNED_SOURCES.some(({ path }) => path.endsWith('.spec.ts') || path.endsWith('.dom.tsx') || path.includes('/testing/'))).toBe(false);
    const literalCount = SCANNED_SOURCES.reduce((count, { path, text }) => count + literalTextsOf(path, text).length, 0);
    expect(literalCount).toBeGreaterThan(SMALLEST_SCANNED_LITERAL_COUNT);
  });
});

describe('the guard, planted in memory', () => {
  const findingsIn = (sourceText: string): string[] => literalFindingsOf([{ path: 'cli/Example.ts', text: sourceText }]).map(({ literal }) => literal);

  test('a usage line, a suggested command in a template and a bare name in prose are each found', () => {
    expect(findingsIn('const USAGE = \'agent-progress status [--json]\';')).toEqual(['agent-progress status [--json]']);
    expect(findingsIn('const advice = `Run \\`agent-progress ticket list\\` to see ${what}.`;')).toEqual(['Run `agent-progress ticket list` to see ']);
    expect(findingsIn('const text = `the files agent-progress installed in ${root}`;')).toEqual(['the files agent-progress installed in ']);
    expect(findingsIn('const usage = \'agent-progress-v2 epic list\';')).toEqual(['agent-progress-v2 epic list']);
  });

  test('a comment, a brief marker, a path, a file name, a longer name and the routed constant are not command text', () => {
    expect(findingsIn([
      '// Run `agent-progress status` first.',
      '/** `agent-progress ticket claim` takes a ticket. */',
      'const marker = /^agent-progress row: (\\d+)$/;',
      'const markerLine = `agent-progress ticket: ${ticketId}`;',
      'const folder = \'.agent-progress/tickets\';',
      'const script = \'agent-progress-dispatch.js\';',
      'const entry = \'agent-progress.ts\';',
      'const key = \'agent-progress:managed\';',
      'const usage = `${PRODUCT_NAMES.PROGRAM} status`;',
    ].join('\n'))).toEqual([]);
  });
});

describe('the sources', () => {
  test('name the program literally only where the allowlist says, and the allowlist names only what the scan finds', () => {
    const found = new Set(literalFindingsOf(SCANNED_SOURCES).map(findingKey));
    const allowed = new Set(ALLOWED_LITERALS.map(findingKey));
    expect([...found].filter((key) => !allowed.has(key)), 'route these through PRODUCT_NAMES.PROGRAM').toEqual([]);
    expect([...allowed].filter((key) => !found.has(key)), 'allowlisted literals the scan no longer finds').toEqual([]);
  });
});
