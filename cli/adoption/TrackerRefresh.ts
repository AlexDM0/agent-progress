/**
 * Writes what the tool installs into a tracked repository for `init` and `update`, and reports per file whether its bytes changed: that
 * is how an orchestrator that read the brief earlier learns its copy is stale.
 */
import { readFileSync } from 'node:fs';

import { createInstallManifestWriter } from '../../src/adapters/install/InstallManifestWriter.ts';
import { writeFileAtomically }         from '../../src/lib/atomic-file/AtomicFile.ts';
import { writeManagedBlock }           from '../../src/lib/claude-code/ClaudeInstructions.ts';
import {
  claudeLocalSettingsFilePathFor,
  claudeSettingsFilePathFor,
  refreshSubagentStopHook,
  writeSubagentStopHook
}                                                             from '../../src/lib/claude-code/ClaudeSettings.ts';
import type { Workspace }                                     from '../../src/services/tracker/Workspace.ts';
import { CLAUDE_MANAGED_BLOCK_MARKERS, installedFilePathsIn } from '../InstalledFiles.ts';
import { INSTALL_VERSION }                                    from '../constants/InstallVersion.ts';
import { removalOfTheRetiredDispatcherScript }                from '../legacy/RetiredDispatcherScriptRemoval.ts';
import type { InstalledFileTexts }                            from './InstalledFileGeneration.ts';

/** The matcher is empty so every subagent is recorded, matching the cohort `usage` reads; the timeout covers waiting on a held lock. */
const SUBAGENT_STOP_HOOK = {
  matcher:        '',
  command:        'agent-progress hook subagent-stop',
  timeoutSeconds: 20,
};

export interface TrackerRefreshRequest {
  workspace:                 Workspace;
  installedFileTexts:        InstalledFileTexts;
  /** The word the reader typed, so a line telling them to run something again names it. */
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

export function refreshReportLinesOf(report: TrackerRefreshReport, htmlFilePath: string): string[] {
  return [
    `  CLAUDE.md:   ${report.claudeInstructionsLine}`,
    `  brief:       ${report.briefLine}`,
    `  hooks:       ${report.hookLine}`,
    `  workflow:    ${report.workflowLine}`,
    `  agent:       ${report.agentDefinitionLine}`,
    `  dashboard:   ${htmlFilePath}`,
  ];
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

/** Rewritten on every refresh: the brief ships with the tool. */
function refreshAgentBrief(briefFilePath: string, briefText: string): { briefFilePath: string; briefLine: string } {
  const bytesBefore = fileBytesOrNothing(briefFilePath);
  writeFileAtomically(briefFilePath, briefText);
  const briefLine = bytesDiffer(bytesBefore, fileBytesOrNothing(briefFilePath))
    ? `updated — re-read it before your next brief (${briefFilePath})`
    : `unchanged (${briefFilePath})`;
  return { briefFilePath, briefLine };
}

/** Written to the per-user settings file unless the shared one already holds the entry, which is then kept current there. */
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

/** Rewritten on every refresh like the brief: the script is the tool's, and a hand edit to the installed copy is undone. */
function refreshDispatcherScript(dispatcherScriptFilePath: string, dispatcherScriptText: string): string {
  const bytesBefore = fileBytesOrNothing(dispatcherScriptFilePath);
  writeFileAtomically(dispatcherScriptFilePath, dispatcherScriptText);
  return bytesDiffer(bytesBefore, fileBytesOrNothing(dispatcherScriptFilePath))
    ? `updated (${dispatcherScriptFilePath})`
    : `unchanged (${dispatcherScriptFilePath})`;
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
  // Reported by the bytes on disk, not by the write that was attempted.
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

  const { dispatcherScript } = installedFileTexts;

  const claudeInstructionsLine = writesClaudeInstructions
    ? refreshClaudeInstructions(installedFilePaths.claudeInstructions, installedFileTexts.claudeInstructionsBlockBody, commandName, standardError)
    : 'left alone (--no-claude-md)';
  const hookLine = refreshSubagentStopHookIn(workspace.rootDirectory, commandName, writesTheSubagentStopHook, standardError);
  const dispatcherScriptLine = dispatcherScript === null
    ? 'left alone (--no-workflow)'
    : refreshDispatcherScript(installedFilePaths.dispatcherScript, dispatcherScript);
  const agentDefinitionLine = refreshAgentDefinition(installedFilePaths.agentDefinition, installedFileTexts.agentDefinition, writesTheAgentDefinition);
  // Last, so a write that fails before them leaves the brief's `updated` and the removal for the rerun to do and report.
  const { briefFilePath, briefLine } = refreshAgentBrief(installedFilePaths.agentBrief, installedFileTexts.agentBrief);
  // The seam to the retired .claude/workflows/ copy; dropping cli/legacy/ makes the workflow line dispatcherScriptLine.
  const retiredCopyRemoval = dispatcherScript === null ? null : removalOfTheRetiredDispatcherScript(workspace.rootDirectory);
  const workflowLine = retiredCopyRemoval === null ? dispatcherScriptLine : `${dispatcherScriptLine}; ${retiredCopyRemoval}`;

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
