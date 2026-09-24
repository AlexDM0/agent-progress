/**
 * That every backticked repository path the documentation names exists: every `*.md`, every comment
 * under `cli/` and `lib/` and in `agent-progress.ts` (line, block and docblock), and the whole of `setup.sh`.
 *
 * The convention has a deliberate escape hatch — a module that no longer exists is named **without**
 * its extension — so a citation carrying no extension is judged only when it ends in `/` and is
 * therefore naming a directory.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync
} from 'node:fs';
import { join }                   from 'node:path';
import { describe, expect, test } from 'bun:test';
import { commentsIn }             from './tooling/dev/SourceComments';

const REPOSITORY_ROOT = join(import.meta.dir, '..');

const UNSCANNED_DIRECTORY_NAMES = new Set(['node_modules', '.git']);

/**
 * The root `progress/` is the predecessor kept for reference, so its paths are not this repository's.
 * Written and compared as a repo-relative path, because `lib/progress/` is a folder this guard must read.
 */
const UNSCANNED_ROOT_RELATIVE_PATH = 'progress';

/** A citation is judged only when it starts at one of these, so prose about `some/path` is left alone. */
const DOCUMENTED_PREFIXES = ['cli/', 'lib/', 'skill/', 'skill-orchestrate/', 'templates/', 'docs/'];

/** More than one dot is allowed, so a citation of `cli/HelpText.spec.ts` is judged like one of `cli/Main.ts`. */
const FILE_NAME_WITH_AN_EXTENSION = /^[^.\s][^\s]*\.[A-Za-z0-9]+$/;

const SINGLE_FILES_SCANNED_AS_DOCBLOCKS = ['agent-progress.ts'];
const SINGLE_FILES_SCANNED_WHOLE        = ['setup.sh'];

interface Citation {
  /** A trailing `/` means the claim is about a directory. */
  path:    string;
  citedIn: string;
}

function filesUnder(directory: string, matches: (fileName: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(REPOSITORY_ROOT, directory), { withFileTypes: true })) {
    if (UNSCANNED_DIRECTORY_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
    const entryPath = directory === '' ? entry.name : `${directory}/${entry.name}`;
    if (entryPath === UNSCANNED_ROOT_RELATIVE_PATH) continue;
    if (entry.isDirectory()) found.push(...filesUnder(entryPath, matches));
    else if (matches(entry.name)) found.push(entryPath);
  }
  return found;
}

/**
 * A trailing `:12` is stripped, and a candidate ending in `/` is kept and judged as a directory:
 * `lib/render/page/` is as much a promise as `lib/render/Template.ts`. A pattern is not a citation —
 * it is a claim about a shape, and `existsSync` on one is false however healthy the tree is.
 */
function citationsIn(text: string, citedIn: string): Citation[] {
  const citations: Citation[] = [];
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const candidate = match[1]!.split(':')[0]!;
    if (!DOCUMENTED_PREFIXES.some((prefix) => candidate.startsWith(prefix))) continue;
    if (/[*?<>]/.test(candidate)) continue;
    if (candidate.endsWith('/')) {
      citations.push({ path: candidate, citedIn });
      continue;
    }
    const lastSegment = candidate.split('/').at(-1) ?? '';
    if (!FILE_NAME_WITH_AN_EXTENSION.test(lastSegment)) continue;
    citations.push({ path: candidate, citedIn });
  }
  return citations;
}

/** A citation ending in `/` has to be a directory and not a file of that name; the two are different promises. */
function citedPathExists(citation: Citation): boolean {
  const absolutePath = join(REPOSITORY_ROOT, citation.path);
  if (!existsSync(absolutePath)) return false;
  return citation.path.endsWith('/') ? statSync(absolutePath).isDirectory() : true;
}

function allCitations(): Citation[] {
  const citations: Citation[] = [];
  for (const markdownFile of filesUnder('', (fileName) => fileName.endsWith('.md'))) {
    citations.push(...citationsIn(readFileSync(join(REPOSITORY_ROOT, markdownFile), 'utf8'), markdownFile));
  }
  const typeScriptFiles = ['cli', 'lib'].flatMap((tree) => filesUnder(tree, (fileName) => fileName.endsWith('.ts')));
  for (const sourceFile of [...typeScriptFiles, ...SINGLE_FILES_SCANNED_AS_DOCBLOCKS]) {
    const contents = readFileSync(join(REPOSITORY_ROOT, sourceFile), 'utf8');
    for (const comment of commentsIn(contents)) citations.push(...citationsIn(comment, sourceFile));
  }
  for (const scriptFile of SINGLE_FILES_SCANNED_WHOLE) {
    citations.push(...citationsIn(readFileSync(join(REPOSITORY_ROOT, scriptFile), 'utf8'), scriptFile));
  }
  return citations;
}

const CITATIONS = allCitations();

describe('the paths the documentation names', () => {
  test('the scan found citations in the markdown, the docblocks and the setup script', () => {
    expect(CITATIONS.length, 'backticked repository paths; 408 measured on 2026-09-19, so a count near 300 means a tree went unread').toBeGreaterThanOrEqual(300);
    expect(CITATIONS.some((citation) => citation.citedIn.endsWith('.md')), 'the walk read the markdown').toBe(true);
    expect(CITATIONS.some((citation) => citation.citedIn.endsWith('.ts')), 'the walk read the docblocks').toBe(true);
    expect(CITATIONS.some((citation) => citation.citedIn === 'setup.sh'), 'the walk read setup.sh').toBe(true);
    expect(CITATIONS.some((citation) => citation.path.endsWith('/')), 'the walk judged directory citations too').toBe(true);
  });

  /** Named rather than left to the floor: losing one folder's docblocks would not move a round number far enough to fail. */
  test('lib/progress/ is read, and only the repository-root progress/ is skipped', () => {
    const filesRead = filesUnder('lib', (fileName) => fileName.endsWith('.ts'));
    expect(filesRead, 'the store every command writes through').toContain('lib/progress/ProgressStore.ts');
    expect(filesRead.some((file) => file.startsWith('progress/')), 'the root tracker is not this repository').toBe(false);
  });

  test('it still recognises a citation and still ignores a bare module name', () => {
    expect(citationsIn('see `cli/Main.ts` for the dispatch', 'a constructed line').map((citation) => citation.path)).toEqual(['cli/Main.ts']);
    expect(citationsIn('the page project lives in `lib/render/page/`', 'a constructed line').map((citation) => citation.path)).toEqual(['lib/render/page/']);
    // The escape hatch: a module that no longer exists is named without its extension, on purpose.
    expect(citationsIn('the old `cli/ArgumentParser` was folded in', 'a constructed line')).toEqual([]);
    expect(citationsIn('run `bun test` first', 'a constructed line')).toEqual([]);
    expect(citationsIn('the exemption covers `lib/tooling/dev/**/*.ts`', 'a constructed line')).toEqual([]);
    expect(citationsIn('a file under `cli/<name>/` may not reach a sibling', 'a constructed line')).toEqual([]);
  });

  test('it reads a path named in a line comment and in a plain block comment, and not one in a string', () => {
    const source = [
      ['// see `lib/', 'LineComment.ts`\n'].join(''),
      ['const value = 1; /* and `lib/', 'BlockComment.ts` */\n'].join(''),
      ['/** the `lib/', 'Docblock.ts` */\n'].join(''),
      ['const text = \'`lib/', 'InAString.ts`\';\n'].join(''),
    ].join('');
    const cited = commentsIn(source).flatMap((comment) => citationsIn(comment, 'a constructed source')).map((citation) => citation.path);
    expect(cited).toEqual(['lib/LineComment.ts', 'lib/BlockComment.ts', 'lib/Docblock.ts']);
  });

  test('a directory citation is kept only when the path is a directory', () => {
    expect(citedPathExists({ path: 'lib/render/page/', citedIn: 'a constructed line' })).toBe(true);
    expect(citedPathExists({ path: 'cli/Main.ts/', citedIn: 'a constructed line' })).toBe(false);
    expect(citedPathExists({ path: 'lib/NotAFolder/', citedIn: 'a constructed line' })).toBe(false);
  });

  test('every path named in the documentation exists', () => {
    const missing = [...new Set(
      CITATIONS
        .filter((citation) => !citedPathExists(citation))
        .map((citation) => `${citation.path}   (named in ${citation.citedIn})`),
    )].sort();
    expect(missing, 'a citation with an extension promises the file is there, one ending in / that the directory is; drop the extension to name a module that is gone').toEqual([]);
  });
});
