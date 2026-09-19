/** The ignore entry goes in before the tracker directory exists, so the tracker is never briefly visible to `git status`. */
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync
}                                  from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { CLAUDE_MANAGED_START }                       from '../../lib/constants/Statuses';
import { writeManagedBlock }                          from '../../lib/platform/ClaudeInstructions';
import { ensureIgnored }                              from '../../lib/platform/GitIgnore';
import { withLock }                                   from '../../lib/platform/Lock';
import { OperationRefusal }                           from '../../lib/platform/OperationRefusal';
import { discoverRepositoryRoot }                     from '../../lib/platform/RepositoryRoot';
import { findWorkspace, workspacePathsFor }           from '../../lib/platform/Workspace';
import { createEmptyProgressFile, writeProgressFile } from '../../lib/progress/ProgressStore';
import { TimeUtil }                                   from '../../lib/utils/TimeUtil';
import { renderDashboard }                            from '../CommandSupport';
import type { CommandHandler }                        from '../CommandTable';

const USAGE = 'agent-progress init [--project <name>] [--root <path>] [--no-claude-md]';

const KNOWN_OPTION_NAMES = ['project', 'root', 'no-claude-md'];

const CLAUDE_BLOCK_TEMPLATE_PATH = ['..', '..', 'templates', 'ClaudeInstructionsBlock.md'];

const CLAUDE_INSTRUCTIONS_FILE_NAME = 'CLAUDE.md';

const IGNORE_OUTCOME_WORDS: Record<string, string> = {
  'already-ignored':      'already ignored, so nothing was added',
  'appended':             'entry added',
  'no-gitignore-written': 'not written — this directory is not a git repository',
};

function claudeInstructionsBlockBody(): string {
  return readFileSync(join(import.meta.dir, ...CLAUDE_BLOCK_TEMPLATE_PATH), 'utf8').replace(/\n+$/, '');
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
    context.standardOutput(`agent-progress is already initialised in ${rootDirectory}; CLAUDE.md block refreshed.`);
    context.standardOutput(`  CLAUDE.md:   ${refreshOutcome}`);
    context.standardOutput(`  dashboard:   ${workspace.htmlFilePath}`);
    return;
  }

  const ignoreOutcome = ensureIgnored(rootDirectory);
  mkdirSync(workspace.ticketsDirectory, { recursive: true });

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

  context.standardOutput(`Initialised agent-progress for "${progress.project}" in ${rootDirectory}`);
  context.standardOutput(`  tracker:     ${workspace.trackerDirectory}`);
  context.standardOutput(`  dashboard:   ${workspace.htmlFilePath}`);
  context.standardOutput(`  .gitignore:  ${IGNORE_OUTCOME_WORDS[ignoreOutcome] ?? ignoreOutcome}`);
  context.standardOutput(`  CLAUDE.md:   ${claudeOutcome}`);
};
