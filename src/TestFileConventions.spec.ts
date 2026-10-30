/**
 * Two Tests rules of the root `CLAUDE.md`: a suite is a `.spec.ts` file, never `.test.ts` or `.spec.tsx`, a Bridge component's suite a
 * `.dom.tsx` under `bridge/` alone, and no spec or test helper creates the real
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
const UNRUN_COMPONENT_SPEC_SUFFIX = '.spec.tsx';
const DOM_SPEC_SUFFIX = '.dom.tsx';
const DOM_SPEC_FOLDER = 'bridge/';
const MINIMUM_SPEC_FILE_COUNT = 100;

function isTestCode(path: string): boolean {
  return path.endsWith('.spec.ts') || path.endsWith(DOM_SPEC_SUFFIX) || path.includes('/testing/') || path.startsWith('testing/');
}

function namesTheProcessContextFactory(source: RepositorySource): boolean {
  const sourceFile = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): boolean => (ts.isIdentifier(node) && node.text === PROCESS_CONTEXT_FACTORY) || ts.forEachChild(node, visit) === true;
  return visit(sourceFile);
}

const RUNNER_START_WORD     = 'run';
const RUNNER_SUBCOMMANDS    = new Set(['stop', 'restart', 'pause', 'resume', 'status']);
const ANY_FREE_PORT_OPTION  = ['--port', '0'];

function stringElementOf(element: ts.Expression | undefined): string | null {
  return element !== undefined && ts.isStringLiteralLike(element) ? element.text : null;
}

/** An argument list that starts a runner, `['run', …]` with no subcommand, binds `--port 0`, so no spec takes a board's real port. */
function startsARunnerOnAFixedPort(array: ts.ArrayLiteralExpression): boolean {
  const elements = [...array.elements];
  if (stringElementOf(elements[0]) !== RUNNER_START_WORD) return false;
  if (RUNNER_SUBCOMMANDS.has(stringElementOf(elements[1]) ?? '')) return false;
  return !elements.some((element, index) => stringElementOf(element) === ANY_FREE_PORT_OPTION[0] && stringElementOf(elements[index + 1]) === ANY_FREE_PORT_OPTION[1]);
}

function runnerStartsOnAFixedPortIn(source: RepositorySource): number {
  const sourceFile = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isArrayLiteralExpression(node) && startsARunnerOnAFixedPort(node)) count++;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

function testFileViolationsOf(sources: readonly RepositorySource[]): string[] {
  return [
    ...sources.filter((source) => source.path.endsWith(RETIRED_TEST_SUFFIX)).map((source) => `${source.path} is a .test.ts file`),
    // `bun test` would run a `.spec.tsx` without a DOM; a component suite is a `.dom.tsx`, which only the Bridge's DOM runner finds.
    ...sources.filter((source) => source.path.endsWith(UNRUN_COMPONENT_SPEC_SUFFIX)).map((source) => `${source.path} is a .spec.tsx file`),
    ...sources.filter((source) => source.path.endsWith(DOM_SPEC_SUFFIX) && !source.path.startsWith(DOM_SPEC_FOLDER))
      .map((source) => `${source.path} is a DOM spec outside ${DOM_SPEC_FOLDER}`),
    ...sources.filter((source) => isTestCode(source.path) && namesTheProcessContextFactory(source))
      .map((source) => `${source.path} creates the real process context`),
    ...sources.filter((source) => isTestCode(source.path) && runnerStartsOnAFixedPortIn(source) > 0)
      .map((source) => `${source.path} starts a runner without --port 0`),
  ];
}

const SOURCES = repositoryTypeScriptSources(repositoryRootOfThisCheckout());

describe('suites are spec files that never create the real process context', () => {
  test('the scan sees the specs and the factory\'s real callers outside them', () => {
    expect(SOURCES.filter((source) => source.path.endsWith('.spec.ts')).length).toBeGreaterThan(MINIMUM_SPEC_FILE_COUNT);
    expect(SOURCES.filter(namesTheProcessContextFactory).map((source) => source.path)).toEqual(['agent-progress.ts', 'cli/CommandContext.ts']);
  });

  test('the scan sees the Bridge\'s DOM specs', () => {
    expect(SOURCES.filter((source) => source.path.endsWith(DOM_SPEC_SUFFIX)).map((source) => source.path)).toContain('bridge/shell/BridgeApp.dom.tsx');
  });

  test('no file in the tree breaks either rule', () => {
    expect(testFileViolationsOf(SOURCES)).toEqual([]);
  });

  const importingTheFactory = `import { ${PROCESS_CONTEXT_FACTORY} } from '../cli/CommandContext.ts';\nconst context = ${PROCESS_CONTEXT_FACTORY}();\n`;

  test.each([
    ['a `.test.ts` suite', { path: 'cli/Example.test.ts', text: 'export {};\n' }],
    ['a `.spec.tsx` suite', { path: 'bridge/shell/Example.spec.tsx', text: 'export {};\n' }],
    ['a DOM spec outside bridge/', { path: 'cli/Example.dom.tsx', text: 'export {};\n' }],
    ['a spec creating the context', { path: 'cli/Example.spec.ts', text: importingTheFactory }],
    ['a test helper creating the context', { path: 'cli/testing/ExampleHelper.ts', text: importingTheFactory }],
  ])('a planted %s is named', (_form, plantedSource) => {
    expect(testFileViolationsOf([plantedSource])).toEqual([expect.stringContaining(plantedSource.path)]);
  });

  test('the scan sees the specs that start a runner, all on --port 0', () => {
    const startingRunners = SOURCES.filter((source) => isTestCode(source.path) && source.text.includes(`'${ANY_FREE_PORT_OPTION[0]}', '${ANY_FREE_PORT_OPTION[1]}'`));
    expect(startingRunners.map((source) => source.path)).toContain('cli/runner/RunCommand.spec.ts');
  });

  test.each([
    ['a bare start', 'runAgentProgress([\'run\'], options);'],
    ['a detached start', 'runAgentProgress([\'run\', \'--detach\'], options);'],
    ['a start on a board\'s own port', 'startAgentProgress([\'run\', \'--port\', \'4930\'], options);'],
  ])('a spec planting %s is named', (_form, plantedLine) => {
    expect(testFileViolationsOf([{ path: 'cli/Example.spec.ts', text: plantedLine }])).toEqual(['cli/Example.spec.ts starts a runner without --port 0']);
  });

  test('a runner on --port 0, a run subcommand, and a shipping module starting a runner pass', () => {
    expect(testFileViolationsOf([
      { path: 'cli/Example.spec.ts', text: 'startAgentProgress([\'run\', \'--detach\', \'--port\', \'0\'], options);\nrunAgentProgress([\'run\', \'stop\'], options);\n' },
      { path: 'cli/Shipping.ts', text: 'spawn([\'run\']);\n' },
    ])).toEqual([]);
  });

  test('a spec that only names the factory in a sentence, and a shipping module calling it, pass', () => {
    expect(testFileViolationsOf([
      { path: 'cli/Example.spec.ts', text: `// never ${PROCESS_CONTEXT_FACTORY}\nconst note = '${PROCESS_CONTEXT_FACTORY}';\n` },
      { path: 'cli/Shipping.ts', text: importingTheFactory },
    ])).toEqual([]);
  });
});
