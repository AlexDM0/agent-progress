/**
 * `init --host copilot-cli` and the `update` after it. What matters: exactly the Copilot files are written, the extension's folder is
 * git-ignored and the host recorded, so `update` reproduces them byte for byte; the worker names the Copilot model the dispatcher maps the
 * default tier to; every other host's leftover is refused by name and left in place, in either direction and by `update` too; and a missing
 * or too-old `copilot` is refused with the minimum named, before anything is written.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { createScratchGitRepository, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                           from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                                     from '../../Main.ts';
import { INSTALL_VERSION }                                    from '../../constants/InstallVersion.ts';
import { createCapturedCommandContext }                       from '../../testing/CapturedCommandContext.ts';
import { repositoryFileContentsOf }                           from '../../testing/RepositoryFileContents.ts';
import { AGENT_HOST_INSTALLS }                                from '../constants/AgentHostInstalls.ts';
import { MINIMUM_COPILOT_CLI_VERSION }                        from './CopilotVersionCheck.ts';

const TRACKER_STORE_PATHS = new Set([
  '.agent-progress/progress.json',
  '.agent-progress/progress.html',
  '.agent-progress/progress.stamp.js',
  '.agent-progress/log.jsonl',
]);

const COPILOT_WORKER_PATH = '.github/agents/agent-progress-worker.agent.md';

const COPILOT_EXTENSION_PATH = '.github/extensions/agent-progress/extension.mjs';

const CLAUDE_WORKER_PATH = '.claude/agents/agent-progress-worker.md';

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function scratchRepository(): string {
  const repositoryDirectory = createScratchGitRepository('copilot-host');
  scratchDirectories.push(repositoryDirectory);
  return repositoryDirectory;
}

/** Everything but the tracker's own store and the skill copies, which the Claude install spec already holds to their sources. */
function installedFilesIn(repositoryDirectory: string): Map<string, string> {
  const installedFiles = new Map<string, string>();
  for (const [relativePath, text] of repositoryFileContentsOf(repositoryDirectory)) {
    if (TRACKER_STORE_PATHS.has(relativePath) || relativePath.startsWith('.agent-progress/.lock/') || relativePath.startsWith('.claude/skills/')) continue;
    installedFiles.set(relativePath, text);
  }
  return installedFiles;
}

async function run(commandWords: readonly string[], repositoryDirectory: string, copilotVersionOutput?: string | null) {
  const context = createCapturedCommandContext({
    currentDirectory: repositoryDirectory,
    ...(copilotVersionOutput === undefined ? {} : { copilotVersionOutput }),
  });
  const exitCode = await runCommandLine([...commandWords], context);
  return { exitCode, output: context.outputText(), error: context.errorText() };
}

/** As the commands print it: the scratch root resolved, since the temporary folder is reached through a symlink on macOS. */
function printedPathOf(repositoryDirectory: string, relativePath: string): string {
  return join(realpathSync(repositoryDirectory), relativePath);
}

function writeRepositoryFile(repositoryDirectory: string, relativePath: string, text: string): void {
  mkdirSync(dirname(join(repositoryDirectory, relativePath)), { recursive: true });
  writeFileSync(join(repositoryDirectory, relativePath), text);
}

describeWhenGitIsPresent('a Copilot CLI install', () => {
  test('writes exactly the Copilot files, git-ignores the extension folder and records the host; update reproduces them', async () => {
    const repositoryDirectory = scratchRepository();

    const init = await run(['init', '--project', 'Example Agency', '--host', 'copilot-cli'], repositoryDirectory);
    expect(init.exitCode, init.error).toBe(0);
    const filesAfterInit = installedFilesIn(repositoryDirectory);

    expect([...filesAfterInit.keys()].sort()).toEqual([
      '.agent-progress/agent-brief.md',
      '.agent-progress/builder-brief.md',
      '.agent-progress/review-brief.md',
      '.agent-progress/version.json',
      COPILOT_WORKER_PATH,
      COPILOT_EXTENSION_PATH,
      '.gitignore',
      'CLAUDE.md',
    ]);
    expect(existsSync(join(repositoryDirectory, '.claude', 'skills', 'agent-progress', 'SKILL.md'))).toBe(true);
    expect(filesAfterInit.get('.gitignore')).toBe('.agent-progress/\n.github/extensions/agent-progress/\n.claude/skills/agent-progress/\n'
      + '.claude/skills/agent-progress-orchestrate/\n');
    expect(filesAfterInit.get('.agent-progress/version.json')).toBe(`{\n  "installVersion": ${INSTALL_VERSION},\n  "agentHost": "copilot-cli"\n}\n`);
    expect(init.output).toContain('Copilot CLI loads the extension only in a folder it trusts');

    const update = await run(['update'], repositoryDirectory);
    expect(update.exitCode, update.error).toBe(0);
    expect(installedFilesIn(repositoryDirectory)).toEqual(filesAfterInit);
    expect(update.output).toContain(`unchanged (${printedPathOf(repositoryDirectory, COPILOT_EXTENSION_PATH)})`);
    expect(update.output).not.toContain('hooks:');
  });

  test('the block and the worker carry Copilot\'s sentences, tools and model, and nothing of the Claude Code hook', async () => {
    const repositoryDirectory = scratchRepository();
    expect((await run(['init', '--host', 'copilot-cli'], repositoryDirectory)).exitCode).toBe(0);

    const block = readFileSync(join(repositoryDirectory, 'CLAUDE.md'), 'utf8');
    expect(block).toContain('Copilot CLI extension adds every token the agent processed');
    expect(block).toContain('`.github/extensions/agent-progress/`');
    expect(block).not.toContain('SubagentStop');
    expect(readFileSync(join(repositoryDirectory, '.agent-progress', 'agent-brief.md'), 'utf8')).toContain('agent-progress hook copilot-agent-settled --session');

    const worker = readFileSync(join(repositoryDirectory, COPILOT_WORKER_PATH), 'utf8');
    expect(worker).toStartWith('---\nname: agent-progress-worker\n');
    expect(worker).toContain('\nmodel: claude-opus-4.8\nreasoning-effort: medium\ntools: ["bash", ');
  });

  test('the worker\'s model is the one the dispatcher maps the default tier to', () => {
    const dispatcherSource = readFileSync(join(import.meta.dir, '..', '..', '..', 'dispatcher', 'DispatchFromCopilotWorkflow.ts'), 'utf8');
    expect(dispatcherSource).toContain(`opus:   { modelId: '${AGENT_HOST_INSTALLS['copilot-cli'].hostSentences['model'] ?? ''}'`);
  });

  test('an unknown --host is refused with exit 1 and writes nothing', async () => {
    const repositoryDirectory = scratchRepository();
    const refused = await run(['init', '--host', 'example-host'], repositoryDirectory);
    expect(refused.exitCode).toBe(1);
    expect(refused.error).toContain('--host takes claude-code or copilot-cli, not "example-host".');
    expect(repositoryFileContentsOf(repositoryDirectory).size).toBe(0);
  });
});

describeWhenGitIsPresent('another host\'s leftovers', () => {
  test('a Copilot init over the Claude Code worker and SubagentStop hook is refused, naming both, and leaves them and no tracker', async () => {
    const repositoryDirectory = scratchRepository();
    writeRepositoryFile(repositoryDirectory, CLAUDE_WORKER_PATH, 'Example worker\n');
    const settingsText = '{"hooks":{"SubagentStop":[{"matcher":"","hooks":[{"type":"command","command":"agent-progress hook subagent-stop"}]}]}}';
    writeRepositoryFile(repositoryDirectory, '.claude/settings.local.json', settingsText);
    const filesBefore = repositoryFileContentsOf(repositoryDirectory);

    const refused = await run(['init', '--host', 'copilot-cli'], repositoryDirectory);

    expect(refused.exitCode).toBe(1);
    expect(refused.error).toContain(printedPathOf(repositoryDirectory, CLAUDE_WORKER_PATH));
    expect(refused.error).toContain(`the SubagentStop hook \`agent-progress hook subagent-stop\` in ${printedPathOf(repositoryDirectory, '.claude/settings.local.json')}`);
    expect(refused.error).toContain('nothing was written and nothing was removed');
    expect(repositoryFileContentsOf(repositoryDirectory)).toEqual(filesBefore);
  });

  test('a Claude Code init over the Copilot worker and extension is refused, naming both, and leaves them', async () => {
    const repositoryDirectory = scratchRepository();
    writeRepositoryFile(repositoryDirectory, COPILOT_WORKER_PATH, 'Example worker\n');
    writeRepositoryFile(repositoryDirectory, COPILOT_EXTENSION_PATH, '// Example extension\n');
    const filesBefore = repositoryFileContentsOf(repositoryDirectory);

    const refused = await run(['init'], repositoryDirectory);

    expect(refused.exitCode).toBe(1);
    expect(refused.error).toContain(`${printedPathOf(repositoryDirectory, COPILOT_WORKER_PATH)}; ${printedPathOf(repositoryDirectory, COPILOT_EXTENSION_PATH)}`);
    expect(repositoryFileContentsOf(repositoryDirectory)).toEqual(filesBefore);
  });

  test('update on a Copilot install refuses a Claude Code worker added since, and leaves it', async () => {
    const repositoryDirectory = scratchRepository();
    expect((await run(['init', '--host', 'copilot-cli'], repositoryDirectory)).exitCode).toBe(0);
    writeRepositoryFile(repositoryDirectory, CLAUDE_WORKER_PATH, 'Example worker\n');
    const filesBefore = repositoryFileContentsOf(repositoryDirectory);

    const refused = await run(['update'], repositoryDirectory);

    expect(refused.exitCode).toBe(1);
    expect(refused.error).toContain('agent-progress update would install for copilot-cli, but this repository still holds what agent-progress installed for '
      + `claude-code: ${printedPathOf(repositoryDirectory, CLAUDE_WORKER_PATH)}.`);
    expect(repositoryFileContentsOf(repositoryDirectory)).toEqual(filesBefore);
  });
});

describeWhenGitIsPresent('the Copilot CLI version', () => {
  test('a missing or too-old copilot, or one printing no version, is refused with the minimum named, and nothing is written', async () => {
    for (const versionOutput of [null, 'GitHub Copilot CLI 1.0.91.\n', 'GitHub Copilot CLI 0.9.200.\n', 'Example output\n']) {
      const repositoryDirectory = scratchRepository();
      const refused = await run(['init', '--host', 'copilot-cli'], repositoryDirectory, versionOutput);
      expect(refused.exitCode, String(versionOutput)).toBe(1);
      expect(refused.error, String(versionOutput)).toContain(`needs Copilot CLI ${MINIMUM_COPILOT_CLI_VERSION} or newer`);
      expect(repositoryFileContentsOf(repositoryDirectory).size, String(versionOutput)).toBe(0);
    }
  });

  test('a newer copilot is taken, and a Claude Code init never asks for one', async () => {
    const newer = scratchRepository();
    expect((await run(['init', '--host', 'copilot-cli'], newer, 'GitHub Copilot CLI 1.1.0.\n')).exitCode).toBe(0);
    const claude = scratchRepository();
    expect((await run(['init'], claude, null)).exitCode).toBe(0);
  });
});
