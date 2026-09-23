/**
 * What the tool wrote into a repository and refreshes there: the managed CLAUDE.md block, the bundled
 * agent brief, the `SubagentStop` entry unless `--no-hooks`, and the dispatcher workflow script unless
 * `--no-workflow`. `init` and `update` are its two
 * callers. Each line says whether the file on disk actually changed, because an orchestrator that read
 * the brief at the start of its session has no other way to learn that the copy in its context is stale.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { AGENT_BRIEF_FILE_NAME, CLAUDE_MANAGED_START } from '../lib/constants/Statuses';
import { writeFileAtomically }                         from '../lib/platform/AtomicFile';
import { writeManagedBlock }                           from '../lib/platform/ClaudeInstructions';
import {
  claudeLocalSettingsFilePathFor,
  claudeSettingsFilePathFor,
  refreshSubagentStopHook,
  writeSubagentStopHook
}                                                      from '../lib/platform/ClaudeSettings';
import type { Workspace } from '../lib/platform/Workspace';

const CLAUDE_BLOCK_TEMPLATE_PATH = ['..', 'templates', 'ClaudeInstructionsBlock.md'];

const AGENT_BRIEF_TEMPLATE_PATH = ['..', 'templates', 'AgentBrief.md'];

const CLAUDE_INSTRUCTIONS_FILE_NAME = 'CLAUDE.md';

const DISPATCHER_WORKFLOW_TEMPLATE_PATH = ['..', 'templates', 'workflows', 'AgentProgressDispatch.js'];

/** The Workflow tool finds a script by the file name under `.claude/workflows/`, so the name is the one `meta.name` gives. */
const DISPATCHER_WORKFLOW_TARGET_PATH = ['.claude', 'workflows', 'agent-progress-dispatch.js'];

/**
 * The hook the tool installs. **The matcher is empty, so every subagent type is recorded**, and not
 * `general-purpose` alone: `agent-progress usage` reads every transcript the harness wrote, so a
 * matcher narrower than that would leave the log describing a smaller cohort than the report it is
 * read beside. The timeout is generous for what the command does — read a file and append a line —
 * because 20 seconds covers a tracker whose lock another command is holding.
 */
export const SUBAGENT_STOP_HOOK = {
  matcher:        '',
  command:        'agent-progress hook subagent-stop',
  timeoutSeconds: 20,
};

/**
 * Everything a refresh needs. `commandName` is the word the reader typed, so every line telling them to
 * run something again names it; `writesTheSubagentStopHook` is off only under `--no-hooks`, and
 * `writesTheDispatcherWorkflow` only under `--no-workflow`.
 */
export interface TrackerRefreshRequest {
  workspace:                   Workspace;
  commandName:                 string;
  writesClaudeInstructions:    boolean;
  writesTheSubagentStopHook:   boolean;
  writesTheDispatcherWorkflow: boolean;
  standardError:               (text: string) => void;
}

export interface TrackerRefreshReport {
  claudeInstructionsLine: string;
  briefFilePath:          string;
  briefLine:              string;
  hookLine:               string;
  workflowLine:           string;
}

function fileBytesOrNothing(filePath: string): Buffer | null {
  try {
    return readFileSync(filePath);
  } catch {
    // Fail closed: a file the machine cannot read reads as one this refresh changed, never as one it left alone.
    return null;
  }
}

function bytesDiffer(before: Buffer | null, after: Buffer | null): boolean {
  if (before === null || after === null) return true;
  return !before.equals(after);
}

function claudeInstructionsBlockBody(): string {
  return readFileSync(join(import.meta.dir, ...CLAUDE_BLOCK_TEMPLATE_PATH), 'utf8').replace(/\n+$/, '');
}

/**
 * Rewritten on every refresh: the brief is guidance shipped with the tool, so a repository that adopted
 * it a month ago gets the current wording from `agent-progress update` rather than by copying a file
 * across. Anything a project wants to keep belongs in its own `CLAUDE.md`, not here. The path is
 * derived rather than carried on `Workspace`, because nothing but a refresh touches this file and
 * `Workspace` is the set of paths every command shares.
 */
function refreshAgentBrief(workspace: Workspace): { briefFilePath: string; briefLine: string } {
  const briefFilePath = join(workspace.trackerDirectory, AGENT_BRIEF_FILE_NAME);
  const bytesBefore   = fileBytesOrNothing(briefFilePath);
  writeFileAtomically(briefFilePath, readFileSync(join(import.meta.dir, ...AGENT_BRIEF_TEMPLATE_PATH), 'utf8'));
  const briefLine = bytesDiffer(bytesBefore, fileBytesOrNothing(briefFilePath))
    ? `updated — re-read it before your next brief (${briefFilePath})`
    : `unchanged (${briefFilePath})`;
  return { briefFilePath, briefLine };
}

/**
 * The hook goes into `.claude/settings.local.json`, which is per-user and stays out of git, so an
 * accurate token figure costs nobody a commit into a file their colleagues share. An entry a repository
 * already keeps in the shared `.claude/settings.json` is left where its author put it and kept current
 * there instead — never moved, and never a second copy that would log every agent twice. A settings file
 * the writer will not touch is reported on standard error and the rest of the command continues: the
 * tracker is the point of it, and a document that will not parse is a problem only a person can settle.
 */
function refreshSubagentStopHookIn(
  rootDirectory: string,
  commandName: string,
  writesTheSubagentStopHook: boolean,
  standardError: (text: string) => void,
): string {

  function refusedUnreadableSettings(settingsFilePath: string): string {
    standardError(
      `${settingsFilePath} could not be read as a JSON object, so it was left exactly as it was and the hook was not written. `
      + `Fix or remove that file and run \`agent-progress ${commandName}\` again, or add the \`${SUBAGENT_STOP_HOOK.command}\` hook to it by hand.`,
    );
    return 'refused (the settings file could not be read)';
  }

  // Opting out comes first, or refreshing an entry the shared file already holds would write into a file
  // colleagues share on behalf of a reader who asked for no settings file to be touched at all.
  if (!writesTheSubagentStopHook) return 'left alone (--no-hooks)';

  const sharedSettingsFilePath = claudeSettingsFilePathFor(rootDirectory);
  const sharedOutcome          = refreshSubagentStopHook(sharedSettingsFilePath, SUBAGENT_STOP_HOOK);
  if (sharedOutcome === 'refused-unreadable') return refusedUnreadableSettings(sharedSettingsFilePath);
  if (sharedOutcome !== 'absent') return `${sharedSettingsFilePath} (${sharedOutcome})`;

  const localSettingsFilePath = claudeLocalSettingsFilePathFor(rootDirectory);
  const localOutcome          = refreshSubagentStopHook(localSettingsFilePath, SUBAGENT_STOP_HOOK);
  if (localOutcome === 'refused-unreadable') return refusedUnreadableSettings(localSettingsFilePath);
  if (localOutcome !== 'absent') return `${localSettingsFilePath} (${localOutcome})`;

  const installOutcome = writeSubagentStopHook(localSettingsFilePath, SUBAGENT_STOP_HOOK);
  if (installOutcome === 'refused-unreadable') return refusedUnreadableSettings(localSettingsFilePath);
  return `${localSettingsFilePath} (installed)`;
}

/** Rewritten on every refresh like the brief: the script is the tool's, and a hand edit to the installed copy is undone. */
function refreshDispatcherWorkflow(rootDirectory: string, writesTheDispatcherWorkflow: boolean): string {
  if (!writesTheDispatcherWorkflow) return 'left alone (--no-workflow)';

  const workflowFilePath = join(rootDirectory, ...DISPATCHER_WORKFLOW_TARGET_PATH);
  const bytesBefore      = fileBytesOrNothing(workflowFilePath);
  writeFileAtomically(workflowFilePath, readFileSync(join(import.meta.dir, ...DISPATCHER_WORKFLOW_TEMPLATE_PATH), 'utf8'));
  return bytesDiffer(bytesBefore, fileBytesOrNothing(workflowFilePath))
    ? `updated (${workflowFilePath})`
    : `unchanged (${workflowFilePath})`;
}

function refreshClaudeInstructions(rootDirectory: string, commandName: string, standardError: (text: string) => void): string {
  const claudeFilePath = join(rootDirectory, CLAUDE_INSTRUCTIONS_FILE_NAME);
  const bytesBefore    = fileBytesOrNothing(claudeFilePath);
  const outcome        = writeManagedBlock(claudeFilePath, claudeInstructionsBlockBody());

  if (outcome === 'refused-start-without-end') {
    standardError(
      `${claudeFilePath} has an \`${CLAUDE_MANAGED_START}\` marker with no matching end marker, so the block was left alone. `
      + `Close or remove that marker and run \`agent-progress ${commandName}\` again.`,
    );
    return 'refused (start marker without an end marker)';
  }

  if (outcome === 'replaced') {
    const pairCount = readFileSync(claudeFilePath, 'utf8').split(CLAUDE_MANAGED_START).length - 1;
    if (pairCount > 1) {
      standardError(`${claudeFilePath} holds ${pairCount} agent-progress blocks; only the first was refreshed and the others are now stale.`);
    }
  }
  // The outcome names the write that was attempted, which only says something once the bytes moved:
  // `unchanged (replaced)` contradicted itself.
  if (!bytesDiffer(bytesBefore, fileBytesOrNothing(claudeFilePath))) return 'unchanged';
  return `updated (${outcome})`;
}

/** Touches nothing the tracker holds: not `progress.json`, not a ticket, not the log. */
export function refreshTrackedRepository(request: TrackerRefreshRequest): TrackerRefreshReport {
  const {
    workspace,
    commandName,
    writesClaudeInstructions,
    writesTheSubagentStopHook,
    writesTheDispatcherWorkflow,
    standardError,
  } = request;

  const claudeInstructionsLine = writesClaudeInstructions
    ? refreshClaudeInstructions(workspace.rootDirectory, commandName, standardError)
    : 'left alone (--no-claude-md)';
  const { briefFilePath, briefLine } = refreshAgentBrief(workspace);
  const hookLine = refreshSubagentStopHookIn(workspace.rootDirectory, commandName, writesTheSubagentStopHook, standardError);
  const workflowLine = refreshDispatcherWorkflow(workspace.rootDirectory, writesTheDispatcherWorkflow);

  return {
    claudeInstructionsLine,
    briefFilePath,
    briefLine,
    hookLine,
    workflowLine,
  };
}
