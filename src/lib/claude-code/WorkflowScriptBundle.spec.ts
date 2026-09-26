/**
 * What the Workflow tool needs from a built script: the meta literal first with its key order kept, a body with no import or export, the runner's
 * call last, and the same bytes wherever the build ran from, since the bundler's path comments are relative to the working directory. Every
 * fixture sits outside the working directory in a folder whose name holds a space, the path a character-class strip would miss, and an
 * unstripped build shows the comment is there to remove. Each failure
 * reason has its own fixture except `no-output`, which a successful `Bun.build` of one entry never answers, so no fixture could provoke it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import { createScratchDirectory, removeScratchDirectory }  from '../../testing/ScratchWorkspace';
import { bundleWorkflowScript, type WorkflowScriptBundle } from './WorkflowScriptBundle';

const EXAMPLE_META = { name: 'example-workflow', description: 'An example workflow', args: { zeta: 'last in the alphabet', alpha: 'first' } };

const EXAMPLE_META_MODULE = `export const EXAMPLE_META = ${JSON.stringify(EXAMPLE_META)};\n`;

const EXAMPLE_HELPER_MODULE = 'export function helperText(): string {\n  return \'example helper\';\n}\n';

const EXAMPLE_ENTRY_MODULE = [
  'import { helperText } from \'./Helper.ts\';',
  '',
  'export async function runExampleWorkflow(): Promise<string> {',
  '  return helperText();',
  '}',
  '',
].join('\n');

const scratchDirectories: string[] = [];

let fixtureCount = 0;

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function fixtureDirectoryWith(moduleTextByFileName: Readonly<Record<string, string>>): string {
  const scratchDirectory = createScratchDirectory('workflow-script-bundle');
  scratchDirectories.push(scratchDirectory);
  fixtureCount += 1;
  const fixtureDirectory = join(scratchDirectory, `fixture ${fixtureCount} with a space`);
  mkdirSync(fixtureDirectory);
  for (const [fileName, moduleText] of Object.entries(moduleTextByFileName)) writeFileSync(join(fixtureDirectory, fileName), moduleText);
  return fixtureDirectory;
}

function bundleOfFixture(fixtureDirectory: string, request: { metaExportName?: string; plugins?: readonly Bun.BunPlugin[] } = {}): Promise<WorkflowScriptBundle> {
  return bundleWorkflowScript({
    entryPath:      join(fixtureDirectory, 'Entry.ts'),
    metaModulePath: join(fixtureDirectory, 'Meta.ts'),
    metaExportName: request.metaExportName ?? 'EXAMPLE_META',
    plugins:        request.plugins ?? [],
  });
}

function scriptTextOf(bundle: WorkflowScriptBundle): string {
  if (bundle.verdict === 'failed') throw new Error(`${bundle.reason}: ${bundle.detail}`);
  return bundle.scriptText;
}

function exampleFixtureDirectory(): string {
  return fixtureDirectoryWith({ 'Entry.ts': EXAMPLE_ENTRY_MODULE, 'Helper.ts': EXAMPLE_HELPER_MODULE, 'Meta.ts': EXAMPLE_META_MODULE });
}

function failureOf(bundle: WorkflowScriptBundle): { reason: string; detail: string } | null {
  return bundle.verdict === 'failed' ? { reason: bundle.reason, detail: bundle.detail } : null;
}

describe('a Workflow script built from a two-module entry', () => {
  test('starts with the meta literal in its key order, holds no import or export, and ends in the runner\'s call', async () => {
    const scriptText = scriptTextOf(await bundleOfFixture(exampleFixtureDirectory()));
    const metaStatement = `export const meta = ${JSON.stringify(EXAMPLE_META, null, 2)};\n`;
    const runnerCall = 'return await runExampleWorkflow();\n';
    expect(scriptText.startsWith(metaStatement)).toBe(true);
    expect(scriptText.endsWith(runnerCall)).toBe(true);
    const body = scriptText.slice(metaStatement.length, scriptText.length - runnerCall.length);
    const { imports, exports } = new Bun.Transpiler({ loader: 'js' }).scan(body);
    expect({ imports, exports }).toEqual({ imports: [], exports: [] });
    expect(body).toContain('example helper');
  });

  test('keeps no path-comment line and names no line of its directory, although that directory holds a space and lies outside the working directory', async () => {
    const fixtureDirectory = exampleFixtureDirectory();
    const scriptText = scriptTextOf(await bundleOfFixture(fixtureDirectory));
    expect(fixtureDirectory).toContain(' ');
    expect(fixtureDirectory.startsWith(process.cwd())).toBe(false);
    const unstrippedBuild = await Bun.build({ entrypoints: [join(fixtureDirectory, 'Entry.ts')], target: 'browser', format: 'esm' });
    expect(await unstrippedBuild.outputs[0]?.text()).toMatch(/^\/\/ .*with a space\/Entry\.ts$/m);
    expect(scriptText).not.toMatch(/^\/\/ /m);
    expect(scriptText).not.toContain(fixtureDirectory);
    expect(scriptText).not.toContain('with a space');
  });

  test('is the same text on a second build', async () => {
    const fixtureDirectory = exampleFixtureDirectory();
    const firstText = scriptTextOf(await bundleOfFixture(fixtureDirectory));
    expect(scriptTextOf(await bundleOfFixture(fixtureDirectory))).toBe(firstText);
  });

  test('carries a plugin\'s rewrite of a module it loads', async () => {
    const fixtureDirectory = exampleFixtureDirectory();
    const rewritingPlugin: Bun.BunPlugin = {
      name: 'example rewrite',
      setup(build) {
        build.onLoad({ filter: /Helper\.ts$/ }, () => ({ contents: EXAMPLE_HELPER_MODULE.replace('example helper', 'rewritten by the plugin'), loader: 'ts' }));
      },
    };
    const scriptText = scriptTextOf(await bundleOfFixture(fixtureDirectory, { plugins: [rewritingPlugin] }));
    expect(scriptText).toContain('rewritten by the plugin');
    expect(scriptText).not.toContain('example helper');
  });
});

describe('a Workflow script that cannot be built', () => {
  test('is build-failed on a syntax error, with the bundler\'s log as its detail', async () => {
    const fixtureDirectory = fixtureDirectoryWith({ 'Entry.ts': 'export async function runExampleWorkflow( {\n', 'Meta.ts': EXAMPLE_META_MODULE });
    const failure = failureOf(await bundleOfFixture(fixtureDirectory));
    expect(failure?.reason).toBe('build-failed');
    expect(failure?.detail).not.toBe('');
  });

  test.each([
    ['two exports', 'export function runExampleWorkflow(): string {\n  return \'one\';\n}\n\nexport function runAnotherWorkflow(): string {\n  return \'two\';\n}\n'],
    ['no export', 'console.log(\'example without a runner\');\n'],
  ])('is no-single-runner-export when the entry has %s', async (_description, entryModule) => {
    const fixtureDirectory = fixtureDirectoryWith({ 'Entry.ts': entryModule, 'Meta.ts': EXAMPLE_META_MODULE });
    expect(failureOf(await bundleOfFixture(fixtureDirectory))?.reason).toBe('no-single-runner-export');
  });

  test('is imports-or-exports-remain when the bundler leaves an import external, naming it', async () => {
    const entryModule = [
      'import { remoteValue } from \'https://example.invalid/remote.js\';',
      '',
      'export async function runExampleWorkflow(): Promise<string> {',
      '  return String(remoteValue);',
      '}',
      '',
    ].join('\n');
    const fixtureDirectory = fixtureDirectoryWith({ 'Entry.ts': entryModule, 'Meta.ts': EXAMPLE_META_MODULE });
    const failure = failureOf(await bundleOfFixture(fixtureDirectory));
    expect(failure?.reason).toBe('imports-or-exports-remain');
    expect(failure?.detail).toContain('https://example.invalid/remote.js');
  });

  test('is declares-top-level-meta when the body declares a meta of its own', async () => {
    const entryModule = 'const meta = { name: \'shadowing\' };\n\nexport async function runExampleWorkflow(): Promise<string> {\n  return meta.name;\n}\n';
    const fixtureDirectory = fixtureDirectoryWith({ 'Entry.ts': entryModule, 'Meta.ts': EXAMPLE_META_MODULE });
    expect(failureOf(await bundleOfFixture(fixtureDirectory))?.reason).toBe('declares-top-level-meta');
  });

  test('is meta-module-unloadable when the meta module throws on import, with the error\'s message as its detail', async () => {
    const metaModule = `throw new Error('example meta failure');\n${EXAMPLE_META_MODULE}`;
    const fixtureDirectory = fixtureDirectoryWith({ 'Entry.ts': EXAMPLE_ENTRY_MODULE, 'Helper.ts': EXAMPLE_HELPER_MODULE, 'Meta.ts': metaModule });
    expect(failureOf(await bundleOfFixture(fixtureDirectory))).toEqual({ reason: 'meta-module-unloadable', detail: 'example meta failure' });
  });

  test('is meta-export-missing when the meta module does not export the name asked for', async () => {
    const fixtureDirectory = exampleFixtureDirectory();
    expect(failureOf(await bundleOfFixture(fixtureDirectory, { metaExportName: 'MISSING_META' }))).toEqual({ reason: 'meta-export-missing', detail: 'MISSING_META' });
  });

  test('is names-a-local-path when a string in the body holds the entry\'s own directory', async () => {
    const fixtureDirectory = exampleFixtureDirectory();
    const entryModule = `export async function runExampleWorkflow(): Promise<string> {\n  return ${JSON.stringify(join(fixtureDirectory, 'example.json'))};\n}\n`;
    writeFileSync(join(fixtureDirectory, 'Entry.ts'), entryModule);
    const failure = failureOf(await bundleOfFixture(fixtureDirectory));
    expect(failure?.reason).toBe('names-a-local-path');
    expect(failure?.detail).toContain(fixtureDirectory);
  });
});
