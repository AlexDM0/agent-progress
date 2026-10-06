/**
 * Two Tests rules of the root `CLAUDE.md`: a suite is a `.spec.ts` file, never `.test.ts`, and no spec or test helper creates the real
 * process context, whose working directory, clock and home are the live ones. The context is found by its factory's name as an identifier
 * in the syntax tree, so a sentence naming it is not a use. The scan first proves it saw the specs and the factory's real callers, and
 * each form is planted to prove the guard names it.
 */
import { describe, expect, test } from 'bun:test';
import ts                         from 'typescript';

import { repositoryRootOfThisCheckout } from './testing/ImportGraph.ts';
import type { RepositorySource }        from './testing/RepositorySources.ts';
import { repositoryTypeScriptSources }  from './testing/RepositorySources.ts';

const PROCESS_CONTEXT_FACTORY = 'createProcessContext';
const RETIRED_TEST_SUFFIX = '.test.ts';
const MINIMUM_SPEC_FILE_COUNT = 100;

function isTestCode(path: string): boolean {
  return path.endsWith('.spec.ts') || path.includes('/testing/') || path.startsWith('testing/');
}

function namesTheProcessContextFactory(source: RepositorySource): boolean {
  const sourceFile = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): boolean => (ts.isIdentifier(node) && node.text === PROCESS_CONTEXT_FACTORY) || ts.forEachChild(node, visit) === true;
  return visit(sourceFile);
}

function testFileViolationsOf(sources: readonly RepositorySource[]): string[] {
  return [
    ...sources.filter((source) => source.path.endsWith(RETIRED_TEST_SUFFIX)).map((source) => `${source.path} is a .test.ts file`),
    ...sources.filter((source) => isTestCode(source.path) && namesTheProcessContextFactory(source))
      .map((source) => `${source.path} creates the real process context`),
  ];
}

const SOURCES = repositoryTypeScriptSources(repositoryRootOfThisCheckout());

describe('suites are spec files that never create the real process context', () => {
  test('the scan sees the specs and the factory\'s real callers outside them', () => {
    expect(SOURCES.filter((source) => source.path.endsWith('.spec.ts')).length).toBeGreaterThan(MINIMUM_SPEC_FILE_COUNT);
    expect(SOURCES.filter(namesTheProcessContextFactory).map((source) => source.path)).toEqual(['agent-progress.ts', 'cli/CommandContext.ts']);
  });

  test('no file in the tree breaks either rule', () => {
    expect(testFileViolationsOf(SOURCES)).toEqual([]);
  });

  const importingTheFactory = `import { ${PROCESS_CONTEXT_FACTORY} } from '../cli/CommandContext.ts';\nconst context = ${PROCESS_CONTEXT_FACTORY}();\n`;

  test.each([
    ['a `.test.ts` suite', { path: 'cli/Example.test.ts', text: 'export {};\n' }],
    ['a spec creating the context', { path: 'cli/Example.spec.ts', text: importingTheFactory }],
    ['a test helper creating the context', { path: 'cli/testing/ExampleHelper.ts', text: importingTheFactory }],
  ])('a planted %s is named', (_form, plantedSource) => {
    expect(testFileViolationsOf([plantedSource])).toEqual([expect.stringContaining(plantedSource.path)]);
  });

  test('a spec that only names the factory in a sentence, and a shipping module calling it, pass', () => {
    expect(testFileViolationsOf([
      { path: 'cli/Example.spec.ts', text: `// never ${PROCESS_CONTEXT_FACTORY}\nconst note = '${PROCESS_CONTEXT_FACTORY}';\n` },
      { path: 'cli/Shipping.ts', text: importingTheFactory },
    ])).toEqual([]);
  });
});
