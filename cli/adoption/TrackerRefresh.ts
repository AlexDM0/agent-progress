/**
 * What the tool wrote into a repository and refreshes there: the managed CLAUDE.md block, the agent brief, the `SubagentStop` entry unless
 * `--no-hooks`, the dispatcher script generated from `dispatcher/` unless `--no-workflow`, and the worker agent definition unless
 * `--no-agent-definition`; then, last, the install version. `init` and `update` are its two callers, and hand it every text already
 * computed. Each line says whether the file
 * on disk actually changed, because an orchestrator that read the brief at the start of its session has no other way to learn that the copy in
 * its context is stale.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';

import { createInstallManifestWriter } from '../../src/adapters/install/InstallManifestWriter';
import { writeFileAtomically }         from '../../src/lib/atomic-file/AtomicFile';
import { writeManagedBlock }           from '../../src/lib/claude-code/ClaudeInstructions';
import {
  claudeLocalSettingsFilePathFor,
  claudeSettingsFilePathFor,
  refreshSubagentStopHook,
  writeSubagentStopHook
}                                                             from '../../src/lib/claude-code/ClaudeSettings';
import type { Workspace }                                     from '../../src/services/tracker/Workspace';
import { CLAUDE_MANAGED_BLOCK_MARKERS, installedFilePathsIn } from '../InstalledFiles';
import { INSTALL_VERSION }                                    from '../constants/InstallVersion';
import type { InstalledFileTexts }                            from './InstalledFileGeneration';

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
 * run something again names it; `writesTheSubagentStopHook` is off only under `--no-hooks`,
 * and `writesTheAgentDefinition` only under `--no-agent-definition`. Under `--no-workflow` the texts carry no dispatcher script.
 */
export interface TrackerRefreshRequest {
  workspace:                 Workspace;
  installedFileTexts:        InstalledFileTexts;
  commandName:               string;
  writesClaudeInstructions:  boolean;
  writesTheSubagentStopHook: boolean;
  writesTheAgentDefinition:  boolean;
  standardError:             (text: string) => void;
}

export interface TrackerRefreshReport {
  claudeInstructionsLine: string;
  briefFilePath:          string;
  briefLine:              string;
  hookLine:               string;
  workflowLine:           string;
  agentDefinitionLine:    string;
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

/**
 * Rewritten on every refresh: the brief is guidance shipped with the tool, so a repository that adopted
 * it a month ago gets the current wording from `agent-progress update` rather than by copying a file
 * across. Anything a project wants to keep belongs in its own `CLAUDE.md`, not here. The path is the
 * installed-file catalogue's rather than carried on `Workspace`, because nothing but a refresh touches this file and
 * `Workspace` is the set of paths every command shares.
 */
function refreshAgentBrief(briefFilePath: string, briefText: string): { briefFilePath: string; briefLine: string } {
  const bytesBefore = fileBytesOrNothing(briefFilePath);
  writeFileAtomically(briefFilePath, briefText);
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

/** Rewritten on every refresh like the dispatcher: a hand edit is undone, and a project that wants its own keeps it under another name. */
function refreshAgentDefinition(agentDefinitionFilePath: string, agentDefinitionText: string, writesTheAgentDefinition: boolean): string {
  if (!writesTheAgentDefinition) return 'left alone (--no-agent-definition)';

  const bytesBefore = fileBytesOrNothing(agentDefinitionFilePath);
  writeFileAtomically(agentDefinitionFilePath, agentDefinitionText);
  return bytesDiffer(bytesBefore, fileBytesOrNothing(agentDefinitionFilePath))
    ? `updated (${agentDefinitionFilePath})`
    : `unchanged (${agentDefinitionFilePath})`;
}

/**
 * Rewritten on every refresh like the brief: the script is the tool's, and a hand edit to the installed copy is undone. The copy an older
 * version installed under `.claude/workflows/` goes, so only one dispatcher is left to launch.
 */
function refreshDispatcherScript(dispatcherScriptFilePath: string, retiredDispatcherScriptFilePath: string, dispatcherScriptText: string | null): string {
  if (dispatcherScriptText === null) return 'left alone (--no-workflow)';

  const bytesBefore = fileBytesOrNothing(dispatcherScriptFilePath);
  writeFileAtomically(dispatcherScriptFilePath, dispatcherScriptText);
  const writeLine = bytesDiffer(bytesBefore, fileBytesOrNothing(dispatcherScriptFilePath))
    ? `updated (${dispatcherScriptFilePath})`
    : `unchanged (${dispatcherScriptFilePath})`;
  if (!existsSync(retiredDispatcherScriptFilePath)) return writeLine;
  rmSync(retiredDispatcherScriptFilePath, { force: true });
  return `${writeLine}; removed the old ${retiredDispatcherScriptFilePath}`;
}

function refreshClaudeInstructions(
  claudeFilePath: string,
  claudeInstructionsBlockBody: string,
  commandName: string,
  standardError: (text: string) => void,
): string {
  const bytesBefore = fileBytesOrNothing(claudeFilePath);
  const outcome     = writeManagedBlock(claudeFilePath, claudeInstructionsBlockBody, CLAUDE_MANAGED_BLOCK_MARKERS);

  if (outcome === 'refused-start-without-end') {
    standardError(
      `${claudeFilePath} has an \`${CLAUDE_MANAGED_BLOCK_MARKERS.start}\` marker with no matching end marker, so the block was left alone. `
      + `Close or remove that marker and run \`agent-progress ${commandName}\` again.`,
    );
    return 'refused (start marker without an end marker)';
  }

  if (outcome === 'replaced') {
    const pairCount = readFileSync(claudeFilePath, 'utf8').split(CLAUDE_MANAGED_BLOCK_MARKERS.start).length - 1;
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
    installedFileTexts,
    commandName,
    writesClaudeInstructions,
    writesTheSubagentStopHook,
    writesTheAgentDefinition,
    standardError,
  } = request;
  const installedFilePaths = installedFilePathsIn(workspace.rootDirectory);

  const claudeInstructionsLine = writesClaudeInstructions
    ? refreshClaudeInstructions(installedFilePaths.claudeInstructions, installedFileTexts.claudeInstructionsBlockBody, commandName, standardError)
    : 'left alone (--no-claude-md)';
  const { briefFilePath, briefLine } = refreshAgentBrief(installedFilePaths.agentBrief, installedFileTexts.agentBrief);
  const hookLine = refreshSubagentStopHookIn(workspace.rootDirectory, commandName, writesTheSubagentStopHook, standardError);
  const workflowLine = refreshDispatcherScript(installedFilePaths.dispatcherScript, installedFilePaths.retiredDispatcherScript, installedFileTexts.dispatcherScript);
  const agentDefinitionLine = refreshAgentDefinition(installedFilePaths.agentDefinition, installedFileTexts.agentDefinition, writesTheAgentDefinition);

  return {
    claudeInstructionsLine,
    briefFilePath,
    briefLine,
    hookLine,
    workflowLine,
    agentDefinitionLine,
  };
}

/** Called last by `init` and `update`, after every other write, so a refresh cut short leaves the old version and commands keep asking for `update`. */
export function recordInstallVersion(rootDirectory: string): void {
  createInstallManifestWriter(installedFilePathsIn(rootDirectory).installManifest).write(INSTALL_VERSION);
}
