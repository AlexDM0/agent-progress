/**
 * That no spec reaches a command around `lib/tooling/dev/TrackerIsolation.ts`: the captured context and `lib/tooling/dev/CliProcess.ts` both check
 * the directory first, and the two doors past them are the real process context and a spawn of the binary a spec wrote itself.
 *
 * A scan for the text in every spec file, with comments blanked out first so a docblock may name either door. Every needle is assembled from
 * parts, because this file is one of the specs it scans.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join }                      from 'node:path';
import { describe, expect, test }    from 'bun:test';

const REPOSITORY_ROOT = join(import.meta.dir, '..');
const SPEC_SUFFIX     = '.spec.ts';

/** The pieces every needle is built from, so that neither door is spelled out in this file. */
const PROCESS_CONTEXT_FACTORY = ['create', 'Process', 'Context'].join('');
const BINARY_NAME             = ['agent', 'progress'].join('-');

type IsolationBypass = 'creates-the-process-context' | 'spawns-the-binary-directly';

const PROCESS_CONTEXT_PATTERN = new RegExp(`\\b${PROCESS_CONTEXT_FACTORY}\\b`);

/** Every way a spec can start a process: Bun's two spawns and its shell, `node:child_process` by name, and that module's functions called bare. */
const PROCESS_START_PATTERNS = [
  /\bBun\s*\.\s*(?:spawn|spawnSync|\$)/,
  /(?<![\w.$])(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/,
  /['"](?:node:)?child_process['"]/,
  /(?<![\w$])\$\s*`/,
];

/** The entry point by its file name anywhere, or the linked bin as the program of an argument list or of a shell line. */
const BINARY_REFERENCE_PATTERNS = [
  new RegExp(`\\b${BINARY_NAME}\\.ts\\b`),
  new RegExp(`[\\[,]\\s*['"\`]${BINARY_NAME}['"\`]`),
  new RegExp(`\\$\\s*\`\\s*${BINARY_NAME}\\b`),
];

function specFilesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(REPOSITORY_ROOT, directory), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const entryPath = directory === '' ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...specFilesUnder(entryPath));
    else if (entry.name.endsWith(SPEC_SUFFIX)) found.push(entryPath);
  }
  return found;
}

/** Blanked character for character rather than removed, so what is left is still the file's own code. */
function codeWithCommentsBlanked(fileContents: string): string {
  return fileContents.replace(/\/\*[\s\S]*?\*\/|^[ \t]*\/\/.*$/gm, (comment) => comment.replace(/[^\n]/g, ' '));
}

/** A spec that starts a process and names the binary is judged by the pair, since a spawn of git beside a read of the entry point is harmless. */
function isolationBypassesIn(fileContents: string): IsolationBypass[] {
  const code = codeWithCommentsBlanked(fileContents);
  const bypasses: IsolationBypass[] = [];
  if (PROCESS_CONTEXT_PATTERN.test(code)) bypasses.push('creates-the-process-context');
  const startsAProcess = PROCESS_START_PATTERNS.some((pattern) => pattern.test(code));
  const namesTheBinary = BINARY_REFERENCE_PATTERNS.some((pattern) => pattern.test(code));
  if (startsAProcess && namesTheBinary) bypasses.push('spawns-the-binary-directly');
  return bypasses;
}

const SCANNED_SPEC_FILES = specFilesUnder('');

describe('the scan itself', () => {
  /** The floor is a round number well under the current count, to fail a walk that reached the wrong directory. */
  test('it opened the spec files of both trees', () => {
    expect(SCANNED_SPEC_FILES.length, 'spec files in the repository').toBeGreaterThanOrEqual(40);
    expect(SCANNED_SPEC_FILES.some((file) => file.startsWith('lib/')), 'the walk reached lib/').toBe(true);
    expect(SCANNED_SPEC_FILES.some((file) => file.startsWith('cli/')), 'the walk reached cli/').toBe(true);
    // Named rather than left to the count: the one suite that legitimately spawns the binary must be among the files judged.
    expect(SCANNED_SPEC_FILES, 'the suite that spawns through lib/tooling/dev/CliProcess.ts').toContain('cli/BinarySmoke.spec.ts');
  });

  /** A pattern that never matches is indistinguishable, from the outside, from a tree that obeys the rule. */
  test('it sees the process context created in a spec, in code or in a child process\'s source, and not in a comment', () => {
    expect(isolationBypassesIn(['const context = ', PROCESS_CONTEXT_FACTORY, '();'].join(''))).toEqual(['creates-the-process-context']);
    expect(isolationBypassesIn(['import { ', PROCESS_CONTEXT_FACTORY, ' } from \'./CommandContext\';'].join(''))).toEqual(['creates-the-process-context']);
    expect(isolationBypassesIn(['const source = \'runCommandLine(argv, ', PROCESS_CONTEXT_FACTORY, '())\';'].join(''))).toEqual(['creates-the-process-context']);
    expect(isolationBypassesIn(['/** Never call ', PROCESS_CONTEXT_FACTORY, ' here. */'].join(''))).toEqual([]);
  });

  test('it sees the binary spawned in every spelling, and not a spawn of something else beside a mention of the entry point', () => {
    const entryPoint = `${BINARY_NAME}.ts`;
    expect(isolationBypassesIn(['Bun', `.spawn(['bun', join(root, '${entryPoint}'), 'status']);`].join(''))).toEqual(['spawns-the-binary-directly']);
    expect(isolationBypassesIn(['Bun', `.spawnSync([process.execPath, '${entryPoint}']);`].join(''))).toEqual(['spawns-the-binary-directly']);
    expect(isolationBypassesIn(['Bun', `.spawnSync(['${BINARY_NAME}', 'status'], { cwd });`].join(''))).toEqual(['spawns-the-binary-directly']);
    const childProcessSpawn = ['import { execFileSync } from \'node:child', `_process';\nexecFileSync('bun', ['${entryPoint}']);`].join('');
    expect(isolationBypassesIn(childProcessSpawn)).toEqual(['spawns-the-binary-directly']);
    expect(isolationBypassesIn(['await ', '$', `\`${BINARY_NAME} status\`;`].join(''))).toEqual(['spawns-the-binary-directly']);
    expect(isolationBypassesIn(['Bun', `.spawnSync(['git', 'init']);\nconst BINARY_ENTRY_POINT = '${entryPoint}';`].join(''))).toEqual(['spawns-the-binary-directly']);
    expect(isolationBypassesIn(['Bun', `.spawnSync(['git', 'init']);\nexpect(text).toContain('${BINARY_NAME}');`].join(''))).toEqual([]);
    expect(isolationBypassesIn([`const BINARY_ENTRY_POINT = '${entryPoint}';\nconst match = pattern.exec(line);`].join(''))).toEqual([]);
    expect(isolationBypassesIn(['/** ', 'Bun', `.spawn(['bun', '${entryPoint}']) is what CliProcess does. */`].join(''))).toEqual([]);
  });
});

describe('the isolation check', () => {
  test('no spec creates the real process context, which would hand a command the test runner\'s own directory', () => {
    const offenders = SCANNED_SPEC_FILES
      .filter((file) => isolationBypassesIn(readFileSync(join(REPOSITORY_ROOT, file), 'utf8')).includes('creates-the-process-context'));
    expect(offenders, 'drive runCommandLine with lib/tooling/dev/CapturedCommandContext.ts instead').toEqual([]);
  });

  test('no spec spawns the binary itself, since only lib/tooling/dev/CliProcess.ts checks the directory before it does', () => {
    const offenders = SCANNED_SPEC_FILES
      .filter((file) => isolationBypassesIn(readFileSync(join(REPOSITORY_ROOT, file), 'utf8')).includes('spawns-the-binary-directly'));
    expect(offenders, 'spawn it through runAgentProgress in lib/tooling/dev/CliProcess.ts instead').toEqual([]);
  });
});
