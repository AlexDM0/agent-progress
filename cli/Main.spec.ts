/**
 * What a command line does to the exit code: 0 for the reference, 1 for an unknown command or an actionable refusal, 2 for anything else.
 * The install version check runs here too: it refuses every command but the four it spares, before the command writes anything.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test
}                                                         from 'bun:test';
import { createInstallManifestWriter }                    from '../src/adapters/install/InstallManifestWriter.ts';
import { OperationRefusalWordingUtil }                    from '../src/adapters/utils/OperationRefusalWordingUtil.ts';
import { JOB_ID_VARIABLE, RELAY_DIRECTORY_VARIABLE }      from '../src/shared/Environment.ts';
import { OperationRefusal }                               from '../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                                  from '../src/shared/constants/ProductNames.ts';
import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS }        from '../src/testing/ChildProcessCaseTimeout.ts';
import { createScratchDirectory, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { COMMAND_NAMES }                                  from './CommandTable.ts';
import { installedFilePathsIn }                           from './InstalledFiles.ts';
import { runCommandLine }                                 from './Main.ts';
import { INSTALL_VERSION }                                from './constants/InstallVersion.ts';
import { createCapturedCommandContext }                   from './testing/CapturedCommandContext.ts';
import { runAgentProgress }                               from './testing/CliProcess.ts';
import * as realRenderCommandModule                       from './tracking/render/RenderCommand.ts';

let errorThrownByTheStubbedCommand: unknown = null;
// Holds no tracker, so a route that does reach a command is refused there instead of writing into the repository's own.
let untrackedDirectory = '';

beforeAll(() => {
  untrackedDirectory = createScratchDirectory('main');
});

afterAll(() => {
  removeScratchDirectory(untrackedDirectory);
});

function capturingContext(): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({ currentDirectory: untrackedDirectory });
}

describe('asking for the reference', () => {
  test('no command at all prints the help on standard output and exits 0', async () => {
    const context = capturingContext();
    expect(await runCommandLine([], context)).toBe(0);
    expect(context.outputText()).toContain(`${PRODUCT_NAMES.PROGRAM} — tasks, tickets and a Gantt dashboard`);
    expect(context.errorText()).toBe('');
  });

  test('`help`, `--help` and `-h` are the same route as each other', async () => {
    for (const word of ['help', '--help', '-h']) {
      const context = capturingContext();
      expect(await runCommandLine([word], context), `\`agent-progress ${word}\` exits 0`).toBe(0);
      expect(context.outputText(), `\`agent-progress ${word}\` prints the reference`).toContain(`Usage: ${PRODUCT_NAMES.PROGRAM} <command>`);
      expect(context.errorText()).toBe('');
    }
  });

  test('--help after a command word prints the reference and exits 0, without reaching the command', async () => {
    for (const line of [['ticket', '--help'], ['task', '-h'], ['task', 'add', '--help'], ['status', '-h'], ['log', 'remember', '--help']]) {
      const context = capturingContext();
      expect(await runCommandLine(line, context), line.join(' ')).toBe(0);
      expect(context.outputText(), line.join(' ')).toContain(`Usage: ${PRODUCT_NAMES.PROGRAM} <command>`);
      expect(context.errorText(), line.join(' ')).toBe('');
    }
  });

  test('a help alias after a bare -- is a positional, not a request for the reference', async () => {
    const context = capturingContext();
    expect(await runCommandLine(['ticket', 'add', '--type', 'ticket', '--', '--help'], context)).toBe(1);
    expect(context.outputText()).not.toContain(`Usage: ${PRODUCT_NAMES.PROGRAM} <command>`);
    expect(context.errorText(), 'the command itself ran, and found no tracker to file `--help` into').toContain(`No ${PRODUCT_NAMES.PROGRAM} tracker was found`);
  });
});

describe('-h that is not a request for the reference', () => {
  /** Help printed here would exit 0 having done nothing, which reads to a calling script as the step having run. */
  let trackedDirectory = '';

  beforeAll(async () => {
    trackedDirectory = createScratchDirectory('main-short-help');
    const initialisingContext = createCapturedCommandContext({ currentDirectory: trackedDirectory });
    expect(await runCommandLine(['init', '--project', 'Example Agency', '--no-hooks'], initialisingContext)).toBe(0);
    expect(await runCommandLine(['ticket', 'add', '--type', 'ticket', 'Example ticket'], createCapturedCommandContext({ currentDirectory: trackedDirectory }))).toBe(0);
  });

  afterAll(() => {
    removeScratchDirectory(trackedDirectory);
  });

  function trackedContext(): ReturnType<typeof createCapturedCommandContext> {
    return createCapturedCommandContext({ currentDirectory: trackedDirectory });
  }

  test('-h as an option\'s value is that value: ticket abandon --reason -h abandons the ticket', async () => {
    const abandoningContext = trackedContext();
    expect(await runCommandLine(['ticket', 'abandon', '1', '--reason', '-h'], abandoningContext), abandoningContext.errorText()).toBe(0);
    expect(abandoningContext.outputText()).not.toContain(`Usage: ${PRODUCT_NAMES.PROGRAM} <command>`);
    const showingContext = trackedContext();
    expect(await runCommandLine(['ticket', 'show', '1', '--json'], showingContext)).toBe(0);
    expect(JSON.parse(showingContext.outputText())).toMatchObject({ status: 'abandoned', reason: '-h' });
  });

  test('-h after free text is refused at exit 1 and logs nothing, rather than printing the help at exit 0', async () => {
    const loggingContext = trackedContext();
    expect(await runCommandLine(['log', 'remember', '-h'], loggingContext)).toBe(1);
    expect(loggingContext.outputText()).toBe('');
    expect(loggingContext.errorText()).toContain('nothing was done');
    const statusContext = trackedContext();
    expect(await runCommandLine(['status', '--json', '--full'], statusContext)).toBe(0);
    expect(statusContext.outputText()).not.toContain('remember');
  });

  test('-h behind a bare -- is text: log -- remember -h logs the line', async () => {
    const loggingContext = trackedContext();
    expect(await runCommandLine(['log', '--', 'remember', '-h'], loggingContext), loggingContext.errorText()).toBe(0);
    const statusContext = trackedContext();
    expect(await runCommandLine(['status', '--json', '--full'], statusContext)).toBe(0);
    expect(statusContext.outputText()).toContain('remember -h');
  });
});

describe('a command that does not exist', () => {
  test('names the word, prints the help on standard error, and exits 1', async () => {
    const context = capturingContext();
    expect(await runCommandLine(['taks', 'add', 'Review pass'], context)).toBe(1);
    expect(context.errorText()).toContain('Unknown command: "taks".');
    expect(context.errorText()).toContain(`Usage: ${PRODUCT_NAMES.PROGRAM} <command>`);
    expect(context.outputText()).toBe('');
  });
});

describe('a command run where no tracker is', () => {
  test('prints the no-tracker refusal byte for byte on standard error and exits 1', async () => {
    const context = capturingContext();
    expect(await runCommandLine(['status'], context)).toBe(1);
    expect(context.errorText()).toBe(
      `No ${PRODUCT_NAMES.PROGRAM} tracker was found in ${resolve(untrackedDirectory)} or any directory above it. `
      + `Run \`${PRODUCT_NAMES.PROGRAM} init\` in the repository you want tracked.`,
    );
    expect(context.outputText()).toBe('');
  });
});

describe('a tracker whose installed files are of another install version', () => {
  const COMMANDS_THAT_RUN_OR_CHECK_ON_THEIR_OWN = new Set(['init', 'update', 'help', 'status', 'version', 'hook', 'release']);
  const CHECKED_COMMAND_NAMES = COMMAND_NAMES.filter((commandName) => !COMMANDS_THAT_RUN_OR_CHECK_ON_THEIR_OWN.has(commandName));

  /** A tracker made by `init` and then stripped of its manifest is exactly a tracker installed by an agent-progress from before versioning. */
  let trackedDirectory = '';

  beforeEach(async () => {
    trackedDirectory = realpathSync(createScratchDirectory('main-install-version'));
    const initialisingContext = createCapturedCommandContext({ currentDirectory: trackedDirectory });
    expect(await runCommandLine(['init', '--project', 'Example Agency', '--no-hooks'], initialisingContext)).toBe(0);
    rmSync(installedFilePathsIn(trackedDirectory).installManifest);
  });

  afterEach(() => {
    removeScratchDirectory(trackedDirectory);
  });

  function trackedContext(): ReturnType<typeof createCapturedCommandContext> {
    return createCapturedCommandContext({ currentDirectory: trackedDirectory });
  }

  function unversionedParagraph(): string {
    return OperationRefusalWordingUtil.installVersionMismatchMessageOf({
      kind:             'install-version-mismatch',
      rootDirectory:    trackedDirectory,
      manifestFilePath: installedFilePathsIn(trackedDirectory).installManifest,
      installVersion:   INSTALL_VERSION,
      mismatch:         { reason: 'unversioned' },
    });
  }

  test('every checked command exits 1 with the one paragraph on standard error and leaves progress.json byte for byte', async () => {
    const progressFilePath   = join(trackedDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.json');
    const progressFileBefore = readFileSync(progressFilePath);
    expect(CHECKED_COMMAND_NAMES).toHaveLength(COMMAND_NAMES.length - COMMANDS_THAT_RUN_OR_CHECK_ON_THEIR_OWN.size);
    for (const commandName of CHECKED_COMMAND_NAMES) {
      const context = trackedContext();
      expect(await runCommandLine([commandName], context), commandName).toBe(1);
      expect(context.errorText(), commandName).toBe(unversionedParagraph());
      expect(context.outputText(), commandName).toBe('');
    }
    expect(readFileSync(progressFilePath).equals(progressFileBefore)).toBe(true);
    expect(existsSync(installedFilePathsIn(trackedDirectory).installManifest)).toBe(false);
  });

  test('version runs and prints the code and install versions, so a runner can read the code on disk whatever was installed', async () => {
    const context = trackedContext();
    expect(await runCommandLine(['version', '--json'], context), context.errorText()).toBe(0);
    expect(JSON.parse(context.outputText())).toEqual({ codeVersion: expect.stringMatching(/^[0-9a-f]{12}$/), installVersion: INSTALL_VERSION });
  });

  test('run status runs and reports the runner down, so a runner whose install changed can still be inspected', async () => {
    const context = trackedContext();
    expect(await runCommandLine(['run', 'status', '--json'], context), context.errorText()).toBe(0);
    expect(JSON.parse(context.outputText())).toMatchObject({
      state: 'down', paused: true, url: null, lease: null, codeVersionInMemory: null
    });
  });

  test('run pause is checked like every mutating verb', async () => {
    const context = trackedContext();
    expect(await runCommandLine(['run', 'pause'], context)).toBe(1);
    expect(context.errorText()).toBe(unversionedParagraph());
  });

  test('help, --help after a command word and status run, and status prints what it printed before the manifest went', async () => {
    for (const line of [['help'], ['task', '--help']]) {
      const context = trackedContext();
      expect(await runCommandLine(line, context), line.join(' ')).toBe(0);
      expect(context.outputText(), line.join(' ')).toContain(`Usage: ${PRODUCT_NAMES.PROGRAM} <command>`);
    }
    const statusWithoutTheManifest = trackedContext();
    expect(await runCommandLine(['status', '--json', '--full'], statusWithoutTheManifest)).toBe(0);
    expect(statusWithoutTheManifest.errorText()).toBe('');
    createInstallManifestWriter(installedFilePathsIn(trackedDirectory).installManifest).write({ installVersion: INSTALL_VERSION });
    const statusWithTheManifest = trackedContext();
    expect(await runCommandLine(['status', '--json', '--full'], statusWithTheManifest)).toBe(0);
    expect(statusWithoutTheManifest.outputText()).toBe(statusWithTheManifest.outputText());
  });

  test('under a job a mutating verb relays before the install check, writing a versioned request, and prints queued at exit 0', async () => {
    const relayFolder = createScratchDirectory('main-relay');
    try {
      const result = await runAgentProgress(['ticket', 'add', 'Found beside the work', '--type', 'bug', '--priority', 'low'], {
        currentDirectory: trackedDirectory,
        environment:      { [JOB_ID_VARIABLE]: 'J7', [RELAY_DIRECTORY_VARIABLE]: relayFolder },
      });
      const [requestFileName, ...otherFileNames] = readdirSync(join(relayFolder, 'requests'));
      const request = JSON.parse(readFileSync(join(relayFolder, 'requests', requestFileName ?? ''), 'utf8')) as { relayFormatVersion: number; requestId: string };

      expect(result.exitCode, result.standardError).toBe(0);
      expect(otherFileNames).toEqual([]);
      expect(request.relayFormatVersion).toBe(1);
      expect(result.standardOutput.trim()).toBe(`queued ${request.requestId}`);
      expect(existsSync(installedFilePathsIn(trackedDirectory).installManifest)).toBe(false);
    } finally {
      removeScratchDirectory(relayFolder);
    }
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('hook bash-domains skips the install check: under a job it still answers deny through its JSON at exit 0', async () => {
    const relayFolder = createScratchDirectory('main-bash-domains');
    try {
      const webFetch = { hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url: 'https://example.net/' } };
      const result = await runAgentProgress(['hook', 'bash-domains', '--allow', 'registry.example.com'], {
        currentDirectory: trackedDirectory,
        environment:      { [JOB_ID_VARIABLE]: 'J7', [RELAY_DIRECTORY_VARIABLE]: relayFolder },
        standardInput:    JSON.stringify(webFetch),
      });
      expect(result.exitCode, result.standardError).toBe(0);
      expect(result.standardError).toBe('');
      expect(JSON.parse(result.standardOutput)).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } });
      expect(existsSync(installedFilePathsIn(trackedDirectory).installManifest)).toBe(false);
    } finally {
      removeScratchDirectory(relayFolder);
    }
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('hook session-start skips the install check: it prints the session instructions at exit 0, and nothing under a job', async () => {
    const relayFolder = createScratchDirectory('main-session-start');
    try {
      const instructions = readFileSync(installedFilePathsIn(trackedDirectory).sessionInstructions, 'utf8');
      const session = await runAgentProgress(['hook', 'session-start'], { currentDirectory: trackedDirectory, standardInput: '{}' });
      expect(session.exitCode, session.standardError).toBe(0);
      expect(session.standardOutput).toBe(instructions);
      expect(session.standardError).toBe('');

      const underAJob = await runAgentProgress(['hook', 'session-start'], {
        currentDirectory: trackedDirectory,
        environment:      { [JOB_ID_VARIABLE]: 'J7', [RELAY_DIRECTORY_VARIABLE]: relayFolder },
        standardInput:    '{}',
      });
      expect(underAJob.exitCode, underAJob.standardError).toBe(0);
      expect(underAJob.standardOutput).toBe('');

      rmSync(installedFilePathsIn(trackedDirectory).sessionInstructions);
      const unreadable = await runAgentProgress(['hook', 'session-start', '--unknown'], { currentDirectory: trackedDirectory, standardInput: '' });
      expect(unreadable.exitCode, 'whatever goes wrong, the hook exits 0 and prints nothing').toBe(0);
      expect(unreadable.standardOutput).toBe('');
      expect(unreadable.standardError).toBe('');
      expect(existsSync(installedFilePathsIn(trackedDirectory).installManifest)).toBe(false);
    } finally {
      removeScratchDirectory(relayFolder);
    }
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('init runs and records the install version, after which a refused command runs', async () => {
    expect(await runCommandLine(['init', '--no-hooks'], trackedContext())).toBe(0);
    expect(existsSync(installedFilePathsIn(trackedDirectory).installManifest)).toBe(true);
    const addingContext = trackedContext();
    expect(await runCommandLine(['task', 'add', 'Example row'], addingContext), addingContext.errorText()).toBe(0);
  });

  test('update runs and records the install version, after which a refused command runs', async () => {
    const refusedContext = trackedContext();
    expect(await runCommandLine(['task', 'add', 'Example row'], refusedContext)).toBe(1);
    expect(await runCommandLine(['update', '--no-hooks'], trackedContext())).toBe(0);
    const addingContext = trackedContext();
    expect(await runCommandLine(['task', 'add', 'Example row'], addingContext), addingContext.errorText()).toBe(0);
  });

  test('a tracker with neither a brief nor a manifest counts as current, so its commands run', async () => {
    rmSync(installedFilePathsIn(trackedDirectory).sessionInstructions);
    const addingContext = trackedContext();
    expect(await runCommandLine(['task', 'add', 'Example row'], addingContext), addingContext.errorText()).toBe(0);
  });

  test('a checked command where no tracker is keeps the no-tracker refusal', async () => {
    const context = capturingContext();
    expect(await runCommandLine(['task', 'add', 'Example row'], context)).toBe(1);
    expect(context.errorText()).toBe(
      `No ${PRODUCT_NAMES.PROGRAM} tracker was found in ${resolve(untrackedDirectory)} or any directory above it. `
      + `Run \`${PRODUCT_NAMES.PROGRAM} init\` in the repository you want tracked.`,
    );
  });
});

describe('a command that throws', () => {
  /** Stubbing `cli/tracking/render/RenderCommand.ts` reaches all three shapes with the real dispatch, catch and status-to-code mapping. */
  let realRenderCommandExports: Record<string, unknown> = {};

  // Bun keeps a module mock for the rest of the process and `mock.restore()` leaves it standing, so the real exports are copied before the stub
  // goes in and mocked back afterwards; the copy has to precede the stub, because Bun patches the live namespace in place.
  beforeAll(() => {
    realRenderCommandExports = { ...realRenderCommandModule };
    mock.module('./tracking/render/RenderCommand.ts', () => ({ renderCommand: () => Promise.reject(errorThrownByTheStubbedCommand), }));
  });

  afterAll(() => {
    mock.module('./tracking/render/RenderCommand.ts', () => realRenderCommandExports);
  });

  test('an unrepaired refusal exits 2 with its own message and no stack trace', async () => {
    errorThrownByTheStubbedCommand = new OperationRefusal('unrepaired', 'Another agent-progress command is holding the lock');
    const context = capturingContext();
    expect(await runCommandLine(['render'], context)).toBe(2);
    expect(context.errorText()).toContain('is holding the lock');
    expect(context.errorText()).not.toContain('at <anonymous>');
    expect(context.outputText()).toBe('');
  });

  test('a refusal the caller can act on exits 1, with the refusal\'s own message', async () => {
    errorThrownByTheStubbedCommand = new OperationRefusal('refused', 'agent-progress init: this repository already has a tracker');
    const context = capturingContext();
    expect(await runCommandLine(['render'], context)).toBe(1);
    expect(context.errorText()).toContain('this repository already has a tracker');
  });

  test('an error that is not a refusal exits 2, because the tool cannot say the caller can fix it', async () => {
    errorThrownByTheStubbedCommand = new Error('EACCES: permission denied, open \'.agent-progress/progress.json\'');
    const context = capturingContext();
    expect(await runCommandLine(['render'], context)).toBe(2);
    expect(context.errorText()).toContain('EACCES: permission denied');
  });

  test('something thrown that is not an Error at all is still reported and still exits 2', async () => {
    errorThrownByTheStubbedCommand = 'a bare string, which a dependency is entitled to throw';
    const context = capturingContext();
    expect(await runCommandLine(['render'], context)).toBe(2);
    expect(context.errorText()).toContain('a bare string');
  });
});

describe('after the stubbed cases', () => {
  /** Bun keeps a module mock for the rest of the process, so every later spec file that runs `render` would get the stub instead. */
  test('the real render command is back, and renders a tracker at exit 0', async () => {
    const trackedDirectory = createScratchDirectory('main-render');
    try {
      const initialisingContext = createCapturedCommandContext({ currentDirectory: trackedDirectory });
      expect(await runCommandLine(['init', '--project', 'Example Agency', '--no-hooks'], initialisingContext)).toBe(0);
      const renderingContext = createCapturedCommandContext({ currentDirectory: trackedDirectory });
      expect(await runCommandLine(['render'], renderingContext), renderingContext.errorText()).toBe(0);
      expect(renderingContext.errorText()).toBe('');
    } finally {
      removeScratchDirectory(trackedDirectory);
    }
  });
});
