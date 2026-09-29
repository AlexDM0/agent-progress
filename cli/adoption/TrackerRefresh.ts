/**
 * Writes what the tool installs into a tracked repository for `init` and `update`, and reports per file whether its bytes changed: that
 * is how an orchestrator that read the brief earlier learns its copy is stale.
 */
import { existsSync, readFileSync } from 'node:fs';

import { createInstallManifestWriter } from '../../src/adapters/install/InstallManifestWriter.ts';
import { writeFileAtomically }         from '../../src/lib/atomic-file/AtomicFile.ts';
import { writeManagedBlock }           from '../../src/lib/claude-code/ClaudeInstructions.ts';
import {
  claudeLocalSettingsFilePathFor,
  claudeSettingsFilePathFor,
  refreshSubagentStopHook,
  writeSubagentStopHook
}                                                             from '../../src/lib/claude-code/ClaudeSettings.ts';
import type { Workspace }                                from '../../src/services/tracker/Workspace.ts';
import { OperationRefusal }                              from '../../src/shared/OperationRefusal.ts';
import { installedFilePathsIn, type InstalledFilePaths } from '../InstalledFiles.ts';
import { INSTALL_VERSION }                               from '../constants/InstallVersion.ts';
import type { InstalledFileTexts }                       from './InstalledFileGeneration.ts';
import { CLAUDE_MANAGED_BLOCK_MARKERS }                  from './constants/ClaudeManagedBlockMarkers.ts';

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
  /** Only a fresh `init`: the brief marks the files installed, so a run cut short after it reads as unversioned and asks for a rerun. */
  writesTheBriefFirst:       boolean;
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

function briefFileChanged(briefFilePath: string, briefText: string): boolean {
  const bytesBefore = fileBytesOrNothing(briefFilePath);
  writeFileAtomically(briefFilePath, briefText);
  return bytesDiffer(bytesBefore, fileBytesOrNothing(briefFilePath));
}

/**
 * Rewritten on every refresh: the briefs ship with the tool. The line names the orchestrator's brief, the one a reader holds, and reports a
 * change to any of the three; the agent brief is written last, since its presence is what marks the files installed.
 */
function refreshBriefs(installedFilePaths: InstalledFilePaths, installedFileTexts: InstalledFileTexts): { briefFilePath: string; briefLine: string } {
  const builderBriefChanged = briefFileChanged(installedFilePaths.builderBrief, installedFileTexts.builderBrief);
  const reviewBriefChanged  = briefFileChanged(installedFilePaths.reviewBrief, installedFileTexts.reviewBrief);
  const agentBriefChanged   = briefFileChanged(installedFilePaths.agentBrief, installedFileTexts.agentBrief);
  const briefFilePath       = installedFilePaths.agentBrief;
  const briefLine           = builderBriefChanged || reviewBriefChanged || agentBriefChanged
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

/** Checked before the first write: the dispatcher starts every builder and reviewer as the agent this definition declares. */
export function refuseAnAgentDefinitionOptOutKeepingTheWorkflow(
  commandName: string,
  { writesTheAgentDefinition, writesTheDispatcherWorkflow }: { writesTheAgentDefinition: boolean; writesTheDispatcherWorkflow: boolean },
): void {
  if (writesTheAgentDefinition || !writesTheDispatcherWorkflow) return;
  throw new OperationRefusal(
    'refused',
    `agent-progress ${commandName} --no-agent-definition needs --no-workflow as well: the dispatcher workflow starts every builder and reviewer `
    + 'as the `agent-progress-worker` agent that definition declares, so without it no worker could start. Nothing was written. '
    + 'Add --no-workflow, or drop --no-agent-definition.',
  );
}

/** Checked before the first write: `--no-workflow` leaves an installed dispatcher in place, and it could start no worker without the definition. */
export function refuseKeepingADispatcherWithoutItsAgentDefinition(
  commandName: string,
  rootDirectory: string,
  { writesTheAgentDefinition, writesTheDispatcherWorkflow }: { writesTheAgentDefinition: boolean; writesTheDispatcherWorkflow: boolean },
): void {
  if (writesTheAgentDefinition || writesTheDispatcherWorkflow) return;
  const installedFilePaths = installedFilePathsIn(rootDirectory);
  if (!existsSync(installedFilePaths.dispatcherScript) || existsSync(installedFilePaths.agentDefinition)) return;
  throw new OperationRefusal(
    'refused',
    `agent-progress ${commandName} --no-agent-definition --no-workflow would leave ${installedFilePaths.dispatcherScript} in place without `
    + `${installedFilePaths.agentDefinition}, the \`agent-progress-worker\` agent it starts every builder and reviewer as, so no worker could start. `
    + 'Nothing was written. Drop --no-agent-definition, or remove that dispatcher script first.',
  );
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
    writesTheBriefFirst,
    standardError,
  } = request;
  const installedFilePaths = installedFilePathsIn(workspace.rootDirectory);
  const briefWrittenFirst  = writesTheBriefFirst ? refreshBriefs(installedFilePaths, installedFileTexts) : null;

  const { dispatcherScript } = installedFileTexts;

  const claudeInstructionsLine = writesClaudeInstructions
    ? refreshClaudeInstructions(installedFilePaths.claudeInstructions, installedFileTexts.claudeInstructionsBlockBody, commandName, standardError)
    : 'left alone (--no-claude-md)';
  const hookLine = refreshSubagentStopHookIn(workspace.rootDirectory, commandName, writesTheSubagentStopHook, standardError);
  const dispatcherScriptLine = dispatcherScript === null
    ? 'left alone (--no-workflow)'
    : refreshDispatcherScript(installedFilePaths.dispatcherScript, dispatcherScript);
  const agentDefinitionLine = refreshAgentDefinition(installedFilePaths.agentDefinition, installedFileTexts.agentDefinition, writesTheAgentDefinition);
  // Otherwise last, so a write that fails before it leaves the brief's `updated` for the rerun to report.
  const { briefFilePath, briefLine } = briefWrittenFirst ?? refreshBriefs(installedFilePaths, installedFileTexts);
  return {
    claudeInstructionsLine,
    briefFilePath,
    briefLine,
    hookLine,
    workflowLine: dispatcherScriptLine,
    agentDefinitionLine,
  };
}

/** Called last by `init` and `update`, after every other write, so a refresh cut short leaves the old version and commands keep asking for `update`. */
export function recordInstallVersion(rootDirectory: string): void {
  createInstallManifestWriter(installedFilePathsIn(rootDirectory).installManifest).write(INSTALL_VERSION);
}
