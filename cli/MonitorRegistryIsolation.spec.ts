/**
 * No spec reaches the real home's `~/.agent-progress-monitor`. Three doors lead there: a spawned CLI inheriting `HOME`, an in-process context
 * given the real home, and a spec reading `homedir()` itself. The spawned home is observed through `usage --json`, which prints a folder under
 * the home without writing anything; the in-process doors are refused by the context helper; and the `homedir` scan first proves it finds
 * its one allowed reader, then names a planted one.
 */
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';
import ts from 'typescript';

import { repositoryRootOfThisCheckout }                       from '../src/testing/ImportGraph.ts';
import { repositoryTypeScriptSources, type RepositorySource } from '../src/testing/RepositorySources.ts';
import { createScratchGitRepository, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { testWhenGitIsPresent }                               from '../src/testing/ToolGuard.ts';
import { trackerIsolationVerdictFor }                         from '../src/testing/TrackerIsolation.ts';
import { runCommandLine }                                     from './Main.ts';
import { createCapturedCommandContext }                       from './testing/CapturedCommandContext.ts';
import { runAgentProgress }                                   from './testing/CliProcess.ts';

const HOME_DIRECTORY_FUNCTION = 'homedir';

/** The live Copilot run must hand Copilot the real home; it keeps its CLI off the registry through `TMPDIR` instead. */
const SPECS_ALLOWED_THE_REAL_HOME = ['cli/CopilotHostEndToEnd.spec.ts'];

const SPAWNED_CASE_TIMEOUT_MILLISECONDS = 60_000;

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function isTestCode(path: string): boolean {
  return path.endsWith('.spec.ts') || path.includes('/testing/') || path.startsWith('testing/');
}

function namesTheHomeDirectoryFunction(source: RepositorySource): boolean {
  const sourceFile = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): boolean => (ts.isIdentifier(node) && node.text === HOME_DIRECTORY_FUNCTION) || ts.forEachChild(node, visit) === true;
  return visit(sourceFile);
}

function testCodeReadingTheRealHome(sources: readonly RepositorySource[]): string[] {
  return sources.filter((source) => isTestCode(source.path) && namesTheHomeDirectoryFunction(source)).map((source) => source.path);
}

async function initializedScratchRepository(): Promise<string> {
  const repositoryDirectory = createScratchGitRepository('monitor-isolation');
  scratchDirectories.push(repositoryDirectory);
  expect(await runCommandLine(['init', '--project', 'Example Agency'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);
  return repositoryDirectory;
}

async function transcriptFolderSeenByAChildProcess(repositoryDirectory: string, environment?: Record<string, string>): Promise<string> {
  const result = await runAgentProgress(['usage', '--json'], { currentDirectory: repositoryDirectory, ...(environment === undefined ? {} : { environment }) });
  expect(result.exitCode, result.standardError).toBe(0);
  return (JSON.parse(result.standardOutput) as { transcriptFolder: string }).transcriptFolder;
}

describe('a spawned CLI gets a scratch home', () => {
  testWhenGitIsPresent('inheriting this process\'s environment, its home lies in the scratch root', async () => {
    const repositoryDirectory = await initializedScratchRepository();
    expect(trackerIsolationVerdictFor(await transcriptFolderSeenByAChildProcess(repositoryDirectory))).toBe('isolated');
  }, SPAWNED_CASE_TIMEOUT_MILLISECONDS);

  testWhenGitIsPresent('given an environment naming another HOME, its home still lies in the scratch root', async () => {
    const repositoryDirectory = await initializedScratchRepository();
    const transcriptFolder    = await transcriptFolderSeenByAChildProcess(repositoryDirectory, { HOME: '/', TMPDIR: tmpdir() });
    expect(trackerIsolationVerdictFor(transcriptFolder)).toBe('isolated');
  }, SPAWNED_CASE_TIMEOUT_MILLISECONDS);

  test('a home outside the scratch root is refused before anything is spawned', async () => {
    expect(runAgentProgress(['status'], { currentDirectory: tmpdir(), homeDirectory: '/' })).rejects.toThrow('is not isolated');
  });
});

describe('an in-process command never registers in a home it was not given', () => {
  test('a context given a home outside the scratch root is refused', () => {
    expect(() => createCapturedCommandContext({ currentDirectory: join(tmpdir(), 'example'), homeDirectory: '/' })).toThrow('is not isolated');
  });

  testWhenGitIsPresent('a mutating command under the default context leaves even its scratch home without a registry', async () => {
    const repositoryDirectory = await initializedScratchRepository();
    const context             = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['log', 'Example milestone'], context)).toBe(0);
    expect(await Bun.file(join(context.homeDirectory, '.agent-progress-monitor', 'projects.json')).exists()).toBe(false);
  });
});

describe('only the allowed specs read the real home', () => {
  const sources = repositoryTypeScriptSources(repositoryRootOfThisCheckout());

  test('the scan finds exactly the allowed readers', () => {
    expect(testCodeReadingTheRealHome(sources)).toEqual(SPECS_ALLOWED_THE_REAL_HOME);
  });

  test('a planted spec or helper calling homedir is named, and one naming it only in a sentence is not', () => {
    const importingIt = `import { ${HOME_DIRECTORY_FUNCTION} } from 'node:os';\nconst home = ${HOME_DIRECTORY_FUNCTION}();\n`;
    expect(testCodeReadingTheRealHome([
      { path: 'cli/Example.spec.ts', text: importingIt },
      { path: 'cli/testing/ExampleHelper.ts', text: importingIt },
      { path: 'cli/Sentence.spec.ts', text: `// never ${HOME_DIRECTORY_FUNCTION}\nconst note = '${HOME_DIRECTORY_FUNCTION}';\n` },
    ])).toEqual(['cli/Example.spec.ts', 'cli/testing/ExampleHelper.ts']);
  });
});
