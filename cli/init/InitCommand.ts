/** The ignore entry goes in before the tracker directory exists, so the tracker is never briefly visible to `git status`. */
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync
}                                  from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { AGENT_BRIEF_FILE_NAME, CLAUDE_MANAGED_START }      from '../../lib/constants/Statuses';
import { writeFileAtomically }                              from '../../lib/platform/AtomicFile';
import { writeManagedBlock }                                from '../../lib/platform/ClaudeInstructions';
import { claudeSettingsFilePathFor, writeSubagentStopHook } from '../../lib/platform/ClaudeSettings';
import { ensureIgnored }                                    from '../../lib/platform/GitIgnore';
import { withLock }                                         from '../../lib/platform/Lock';
import { OperationRefusal }                                 from '../../lib/platform/OperationRefusal';
import { discoverRepositoryRoot }                           from '../../lib/platform/RepositoryRoot';
import type { Workspace }                                   from '../../lib/platform/Workspace';
import { findWorkspace, workspacePathsFor }                 from '../../lib/platform/Workspace';
import { createEmptyProgressFile, writeProgressFile }       from '../../lib/progress/ProgressStore';
import { TimeUtil }                                         from '../../lib/utils/TimeUtil';
import { renderDashboard }                                  from '../CommandSupport';
import type { CommandHandler }                              from '../CommandTable';

const USAGE = 'agent-progress init [--project <name>] [--root <path>] [--no-claude-md] [--hooks]';

const KNOWN_OPTION_NAMES = ['project', 'root', 'no-claude-md', 'hooks'];

const CLAUDE_BLOCK_TEMPLATE_PATH = ['..', '..', 'templates', 'ClaudeInstructionsBlock.md'];

const AGENT_BRIEF_TEMPLATE_PATH = ['..', '..', 'templates', 'AgentBrief.md'];

const CLAUDE_INSTRUCTIONS_FILE_NAME = 'CLAUDE.md';

const IGNORE_OUTCOME_WORDS: Record<string, string> = {
  'already-ignored':      'already ignored, so nothing was added',
  'appended':             'entry added',
  'no-gitignore-written': 'not written — this directory is not a git repository',
};

/**
 * The hook `--hooks` installs. **The matcher is empty, so every subagent type is recorded**, and not
 * `general-purpose` alone: `agent-progress usage` reads every transcript the harness wrote, so a
 * matcher narrower than that would leave the log describing a smaller cohort than the report it is
 * read beside. The timeout is generous for what the command does — read a file and append a line —
 * because 20 seconds covers a tracker whose lock another command is holding.
 */
const SUBAGENT_STOP_HOOK = {
  matcher:        '',
  command:        'agent-progress hook subagent-stop',
  timeoutSeconds: 20,
};

const HOOK_OUTCOME_WORDS: Record<string, string> = {
  'created':         'written',
  'added':           'added to the existing settings',
  'already-present': 'already there, so nothing was added',
};

/** The line printed when `--hooks` was not given: the flag is only useful to somebody who knows it exists, and nothing else would tell them. */
const HOOKS_NOT_REQUESTED = 'not written — `agent-progress init --hooks` records what each subagent costs';

function claudeInstructionsBlockBody(): string {
  return readFileSync(join(import.meta.dir, ...CLAUDE_BLOCK_TEMPLATE_PATH), 'utf8').replace(/\n+$/, '');
}

/**
 * Rewritten on every `init`, exactly like the managed CLAUDE.md block: the brief is guidance shipped
 * with the tool, so a repository that adopted it a month ago gets the current wording by re-running
 * `init` rather than by copying a file across. Anything a project wants to keep belongs in its own
 * `CLAUDE.md`, not here. The path is derived rather than carried on `Workspace`, because nothing but
 * `init` ever touches this file and `Workspace` is the set of paths every command shares.
 */
function writeAgentBrief(workspace: Workspace): string {
  const briefFilePath = join(workspace.trackerDirectory, AGENT_BRIEF_FILE_NAME);
  writeFileAtomically(briefFilePath, readFileSync(join(import.meta.dir, ...AGENT_BRIEF_TEMPLATE_PATH), 'utf8'));
  return briefFilePath;
}

/**
 * Written on every `init --hooks`, and reported in the same words whether it was created, merged or
 * already there. A settings file the writer will not touch is reported on standard error and the rest
 * of `init` continues: the tracker is the point of the command, and a repository whose
 * `.claude/settings.json` cannot be parsed is a problem only a person can settle.
 */
function writeSubagentStopHookInto(rootDirectory: string, standardError: (text: string) => void): string {
  const settingsFilePath = claudeSettingsFilePathFor(rootDirectory);
  const outcome          = writeSubagentStopHook(settingsFilePath, SUBAGENT_STOP_HOOK);

  if (outcome === 'refused-unreadable') {
    standardError(
      `${settingsFilePath} could not be read as a JSON object, so it was left exactly as it was and the hook was not added. `
      + `Fix or remove that file and run \`agent-progress init --hooks\` again, or add the \`${SUBAGENT_STOP_HOOK.command}\` hook to it by hand.`,
    );
    return 'refused (the settings file could not be read)';
  }
  return `${settingsFilePath} (${HOOK_OUTCOME_WORDS[outcome] ?? outcome})`;
}

function resolvedRealPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function writeClaudeInstructions(rootDirectory: string, standardError: (text: string) => void): string {
  const claudeFilePath = join(rootDirectory, CLAUDE_INSTRUCTIONS_FILE_NAME);
  const outcome        = writeManagedBlock(claudeFilePath, claudeInstructionsBlockBody());

  if (outcome === 'refused-start-without-end') {
    standardError(
      `${claudeFilePath} has an \`${CLAUDE_MANAGED_START}\` marker with no matching end marker, so the block was left alone. `
      + 'Close or remove that marker and run `agent-progress init` again.',
    );
    return 'refused (start marker without an end marker)';
  }

  if (outcome === 'replaced') {
    const pairCount = readFileSync(claudeFilePath, 'utf8').split(CLAUDE_MANAGED_START).length - 1;
    if (pairCount > 1) {
      standardError(`${claudeFilePath} holds ${pairCount} agent-progress blocks; only the first was refreshed and the others are now stale.`);
    }
  }
  return outcome;
}

/** A bare repository is refused: it has no working tree, and guessing a directory near it would write into somebody else's. */
function discoveredRootForInit(currentDirectory: string): string {
  const discovery = discoverRepositoryRoot(currentDirectory);
  if (discovery.source === 'bare-repository') {
    throw new OperationRefusal(
      'refused',
      `${discovery.rootDirectory} is inside a bare git repository, which has no working tree to track. `
      + 'Run `agent-progress init` in a checkout of it, or pass --root <path> to track a directory explicitly.',
    );
  }
  return discovery.rootDirectory;
}

/** `--root` must name an existing directory: `init` does not create one, or a mistyped path would make a tracker nobody looks at. */
function requiredExistingDirectory(candidatePath: string, asWritten: string): string {
  let isADirectory = false;
  try {
    isADirectory = statSync(candidatePath).isDirectory();
  } catch {
    // Fail closed: anything a `stat` cannot answer is not a directory to write a tracker into.
  }
  if (!isADirectory) {
    throw new OperationRefusal(
      'refused',
      `--root "${asWritten}" is not an existing directory (${candidatePath}). `
      + 'Create it first, or leave --root off to track the repository `agent-progress` discovers from here.',
    );
  }
  return candidatePath;
}

export const initCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const rootOption    = commandArguments.option('root');
  const rootDirectory = rootOption === undefined
    ? discoveredRootForInit(context.currentDirectory)
    : requiredExistingDirectory(resolvedRealPath(resolve(context.currentDirectory, rootOption)), rootOption);
  const workspace     = workspacePathsFor(rootDirectory);
  const writesClaudeInstructions = !commandArguments.flag('no-claude-md');
  const writesTheSubagentStopHook = commandArguments.flag('hooks');

  const existingWorkspace = findWorkspace(rootDirectory);
  if (existingWorkspace !== null) {
    if (existingWorkspace.rootDirectory !== workspace.rootDirectory) {
      throw new OperationRefusal(
        'refused',
        `A tracker already governs this directory: ${existingWorkspace.trackerDirectory}. `
        + `Run \`agent-progress init\` in ${existingWorkspace.rootDirectory} instead — there it only refreshes the CLAUDE.md block.`,
      );
    }
    const refreshOutcome = writesClaudeInstructions ? writeClaudeInstructions(rootDirectory, context.standardError) : 'left alone (--no-claude-md)';
    const refreshedBriefFilePath = writeAgentBrief(workspace);
    const refreshedHookOutcome   = writesTheSubagentStopHook ? writeSubagentStopHookInto(rootDirectory, context.standardError) : HOOKS_NOT_REQUESTED;
    context.standardOutput(`agent-progress is already initialised in ${rootDirectory}; CLAUDE.md block refreshed.`);
    context.standardOutput(`  CLAUDE.md:   ${refreshOutcome}`);
    context.standardOutput(`  brief:       ${refreshedBriefFilePath}`);
    context.standardOutput(`  hooks:       ${refreshedHookOutcome}`);
    context.standardOutput(`  dashboard:   ${workspace.htmlFilePath}`);
    return;
  }

  const ignoreOutcome = ensureIgnored(rootDirectory);
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
  const briefFilePath = writeAgentBrief(workspace);

  const progress = createEmptyProgressFile({
    project:   commandArguments.option('project') ?? basename(rootDirectory),
    startedAt: TimeUtil.formatLocalIso(context.now()),
    // The page's localStorage key: `file://` is one origin in Chrome, so two trackers would otherwise share a saved range.
    trackerId: randomUUID(),
  });

  await withLock(workspace, async () => {
    writeProgressFile(workspace, progress);
    await renderDashboard(context, workspace);
  }, context.now);

  const claudeOutcome = writesClaudeInstructions ? writeClaudeInstructions(rootDirectory, context.standardError) : 'left alone (--no-claude-md)';
  const hookOutcome   = writesTheSubagentStopHook ? writeSubagentStopHookInto(rootDirectory, context.standardError) : HOOKS_NOT_REQUESTED;

  context.standardOutput(`Initialised agent-progress for "${progress.project}" in ${rootDirectory}`);
  context.standardOutput(`  tracker:     ${workspace.trackerDirectory}`);
  context.standardOutput(`  brief:       ${briefFilePath}`);
  context.standardOutput(`  dashboard:   ${workspace.htmlFilePath}`);
  context.standardOutput(`  .gitignore:  ${IGNORE_OUTCOME_WORDS[ignoreOutcome] ?? ignoreOutcome}`);
  context.standardOutput(`  CLAUDE.md:   ${claudeOutcome}`);
  context.standardOutput(`  hooks:       ${hookOutcome}`);
};
