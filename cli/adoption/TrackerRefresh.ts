/**
 * Writes what the tool installs into a tracked repository for `init` and `update`, walking the table in
 * `cli/adoption/constants/ClaudeCodeInstall.ts`, and reports per part whether its bytes changed: that is how an orchestrator that read the
 * brief earlier learns its copy is stale.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync
} from 'node:fs';
import { join } from 'node:path';

import { createInstallManifestWriter } from '../../src/adapters/install/InstallManifestWriter.ts';
import { writeFileAtomically }         from '../../src/lib/atomic-file/AtomicFile.ts';
import { writeManagedBlock }           from '../../src/lib/claude-code/ClaudeInstructions.ts';
import {
  claudeLocalSettingsFilePathFor,
  claudeSettingsFilePathFor,
  refreshCommandHook,
  writeCommandHook,
  type CommandHook
}                                                                    from '../../src/lib/claude-code/ClaudeSettings.ts';
import { ensureIgnored, removeIgnoreEntry }                                                from '../../src/lib/git/GitIgnore.ts';
import type { Workspace }                                                                  from '../../src/services/tracker/Workspace.ts';
import { OperationRefusal }                                                                from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                                                                   from '../../src/shared/constants/ProductNames.ts';
import { installedFilePathsIn, installedSkillFolderInRepository, type InstalledFilePaths } from '../InstalledFiles.ts';
import { INSTALL_VERSION }                                                                 from '../constants/InstallVersion.ts';
import type { InstalledFileTexts, InstalledSkillFileTexts }                                from './InstalledFileGeneration.ts';
import {
  CLAUDE_CODE_INSTALL,
  INSTALL_OPT_OUT_FLAGS,
  type InstalledFile,
  type InstalledFileName,
  type InstalledPart,
  type InstallOptOutFlag,
  type RetiredSkillFolder
}                                                                from './constants/ClaudeCodeInstall.ts';
import { CLAUDE_MANAGED_BLOCK_MARKERS } from './constants/ClaudeManagedBlockMarkers.ts';

const REFUSED_UNREADABLE_SETTINGS_LINE = 'refused (the settings file could not be read)';

/** Wide enough for the longest label, `.gitignore:`, so every value starts in one column. */
const REPORT_LABEL_COLUMN_WIDTH = 13;

export interface TrackerRefreshRequest {
  workspace:               Workspace;
  installedFileTexts:      InstalledFileTexts;
  installedSkillFileTexts: InstalledSkillFileTexts;
  /** The word the reader typed, so a line telling them to run something again names it. */
  commandName:             string;
  optOutFlags:             ReadonlySet<InstallOptOutFlag>;
  /** Only a fresh `init`: the brief marks the files installed, so a run cut short after it reads as unversioned and asks for a rerun. */
  writesTheBriefFirst:     boolean;
  standardError:           (text: string) => void;
}

export interface RefreshedPartLine {
  reportLabel:     string;
  line:            string;
  marksTheInstall: boolean;
}

export interface TrackerRefreshReport {
  /** The brief whose presence marks the files installed, the one a reader holds. */
  briefFilePath: string;
  /** In the table's order. */
  partLines:     readonly RefreshedPartLine[];
}

export function optOutFlagsGiven(flagIsGiven: (flagName: string) => boolean): ReadonlySet<InstallOptOutFlag> {
  return new Set(INSTALL_OPT_OUT_FLAGS.filter((flagName) => flagIsGiven(flagName)));
}

export function reportLineOf(reportLabel: string, value: string): string {
  return `  ${`${reportLabel}:`.padEnd(REPORT_LABEL_COLUMN_WIDTH)}${value}`;
}

export function refreshReportLinesOf(report: TrackerRefreshReport, htmlFilePath: string): string[] {
  return [
    ...report.partLines.map(({ reportLabel, line }) => reportLineOf(reportLabel, line)),
    reportLineOf('dashboard', htmlFilePath),
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

function fileChangedByWriting(filePath: string, text: string): boolean {
  const bytesBefore = fileBytesOrNothing(filePath);
  writeFileAtomically(filePath, text);
  return bytesDiffer(bytesBefore, fileBytesOrNothing(filePath));
}

/** A text the generation left out of a part that was not opted out is a defect of this checkout, never of the repository written to. */
function requiredTextOf(installedFileTexts: InstalledFileTexts, fileName: InstalledFileName): string {
  const text = installedFileTexts[fileName];
  if (text === undefined) throw new OperationRefusal('unrepaired', `No text was generated for the installed file ${fileName}, so it was not written.`);
  return text;
}

function lastFileOf(files: readonly InstalledFile[]): InstalledFile {
  const lastFile = files.at(-1);
  if (lastFile === undefined) throw new OperationRefusal('unrepaired', 'An installed part lists no file.');
  return lastFile;
}

/**
 * Rewritten on every refresh: the briefs ship with the tool. The line names the last brief, the one a reader holds and whose presence marks
 * the files installed, and reports a change to any of them.
 */
function refreshBriefs(files: readonly InstalledFile[], installedFilePaths: InstalledFilePaths, installedFileTexts: InstalledFileTexts): string {
  let anyBriefChanged = false;
  for (const file of files) {
    if (fileChangedByWriting(installedFilePaths[file.name], requiredTextOf(installedFileTexts, file.name))) anyBriefChanged = true;
  }
  const briefFilePath = installedFilePaths[lastFileOf(files).name];
  return anyBriefChanged ? `updated — re-read it before your next brief (${briefFilePath})` : `unchanged (${briefFilePath})`;
}

/** Rewritten on every refresh like the briefs: a hand edit is undone, and a project that wants its own keeps it under another name. */
function refreshRewrittenFiles(files: readonly InstalledFile[], installedFilePaths: InstalledFilePaths, installedFileTexts: InstalledFileTexts): string {
  const fileLines = files.map((file) => {
    const filePath = installedFilePaths[file.name];
    return fileChangedByWriting(filePath, requiredTextOf(installedFileTexts, file.name)) ? `updated (${filePath})` : `unchanged (${filePath})`;
  });
  return fileLines.join('; ');
}

/**
 * Every file of the skill is rewritten, like the briefs; a file a user added to the folder is never touched, so one the skill dropped stays
 * behind too. Each folder is git-ignored, since it is a copy of this checkout's and the next `update` replaces it.
 */
function refreshSkillFolders(
  { installedSkillNames, retiredSkillFolders }: Pick<Extract<InstalledPart, { writing: 'skill-folders' }>, 'installedSkillNames' | 'retiredSkillFolders'>,
  rootDirectory: string,
  installedSkillFileTexts: InstalledSkillFileTexts,
): string {
  const folderLines = Object.values(installedSkillNames).map((skillName) => {
    const skillFileTexts = installedSkillFileTexts[skillName];
    if (skillFileTexts === undefined) throw new OperationRefusal('unrepaired', `No files were read for the installed skill ${skillName}, so it was not written.`);
    const folderInRepository = installedSkillFolderInRepository(skillName);
    const folderPath         = join(rootDirectory, folderInRepository);
    let anyFileChanged = false;
    for (const [pathInFolder, text] of skillFileTexts) {
      if (fileChangedByWriting(join(folderPath, pathInFolder), text)) anyFileChanged = true;
    }
    const ignoreOutcome = ensureIgnored(rootDirectory, folderInRepository);
    const ignoreNote    = ignoreOutcome === 'appended' ? ', .gitignore entry added' : '';
    return `${anyFileChanged ? 'updated' : 'unchanged'} (${folderPath}${ignoreNote})`;
  });
  const retiredLines = retiredSkillFolders.flatMap((retiredSkillFolder) => retiredSkillFolderLinesOf(retiredSkillFolder, rootDirectory));
  return [...folderLines, ...retiredLines].join('; ');
}

/** Only the files the skill shipped go, so a file a user put in the folder keeps the folder; nothing is said when nothing was there. */
function retiredSkillFolderLinesOf({ skillName, installedFileNames }: RetiredSkillFolder, rootDirectory: string): string[] {
  const folderInRepository = installedSkillFolderInRepository(skillName);
  const folderPath         = join(rootDirectory, folderInRepository);
  const removedFileNames   = installedFileNames.filter((fileName) => existsSync(join(folderPath, fileName)));
  for (const fileName of removedFileNames) rmSync(join(folderPath, fileName));
  if (existsSync(folderPath) && readdirSync(folderPath).length === 0) rmdirSync(folderPath);
  const ignoreOutcome = removeIgnoreEntry(rootDirectory, folderInRepository);
  if (removedFileNames.length === 0 && ignoreOutcome === 'absent') return [];
  const ignoreNote = ignoreOutcome === 'removed' ? ', .gitignore entry removed' : '';
  return [`retired (${folderPath}${ignoreNote})`];
}

/** Written to the per-user settings file unless the shared one already holds the entry, which is then kept current there. */
function refreshHookIn(rootDirectory: string, commandName: string, hook: CommandHook, standardError: (text: string) => void): string {

  function refusedUnreadableSettings(settingsFilePath: string): string {
    standardError(
      `${settingsFilePath} could not be read as a JSON object, so it was left exactly as it was and the hook was not written. `
      + `Fix or remove that file and run \`${PRODUCT_NAMES.PROGRAM} ${commandName}\` again, or add the \`${hook.command}\` hook to it by hand.`,
    );
    return REFUSED_UNREADABLE_SETTINGS_LINE;
  }

  const sharedSettingsFilePath = claudeSettingsFilePathFor(rootDirectory);
  const sharedOutcome          = refreshCommandHook(sharedSettingsFilePath, hook);
  if (sharedOutcome === 'refused-unreadable') return refusedUnreadableSettings(sharedSettingsFilePath);
  if (sharedOutcome !== 'absent') return `${sharedSettingsFilePath} (${sharedOutcome})`;

  const localSettingsFilePath = claudeLocalSettingsFilePathFor(rootDirectory);
  const localOutcome          = refreshCommandHook(localSettingsFilePath, hook);
  if (localOutcome === 'refused-unreadable') return refusedUnreadableSettings(localSettingsFilePath);
  if (localOutcome !== 'absent') return `${localSettingsFilePath} (${localOutcome})`;

  const installOutcome = writeCommandHook(localSettingsFilePath, hook);
  if (installOutcome === 'refused-unreadable') return refusedUnreadableSettings(localSettingsFilePath);
  return `${localSettingsFilePath} (installed)`;
}

/** One line for every hook when they fared alike, one per hook otherwise; an unreadable settings file stops at the first refusal. */
function refreshClaudeSettingsHooks(hooks: readonly CommandHook[], rootDirectory: string, commandName: string, standardError: (text: string) => void): string {
  const hookLines: { event: string; line: string }[] = [];
  for (const hook of hooks) {
    const line = refreshHookIn(rootDirectory, commandName, hook, standardError);
    if (line === REFUSED_UNREADABLE_SETTINGS_LINE) return line;
    hookLines.push({ event: hook.event, line });
  }
  const distinctLines = new Set(hookLines.map(({ line }) => line));
  if (distinctLines.size === 1) return hookLines[0]?.line ?? '';
  return hookLines.map(({ event, line }) => `${event} ${line}`).join('; ');
}

function refreshManagedBlock(
  claudeFilePath: string,
  blockBody: string,
  commandName: string,
  standardError: (text: string) => void,
): string {
  const bytesBefore = fileBytesOrNothing(claudeFilePath);
  const outcome     = writeManagedBlock(claudeFilePath, blockBody, CLAUDE_MANAGED_BLOCK_MARKERS);

  if (outcome === 'refused-start-without-end') {
    standardError(
      `${claudeFilePath} has an \`${CLAUDE_MANAGED_BLOCK_MARKERS.start}\` marker with no matching end marker, so the block was left alone. `
      + `Close or remove that marker and run \`${PRODUCT_NAMES.PROGRAM} ${commandName}\` again.`,
    );
    return 'refused (start marker without an end marker)';
  }

  if (outcome === 'replaced') {
    const pairCount = readFileSync(claudeFilePath, 'utf8').split(CLAUDE_MANAGED_BLOCK_MARKERS.start).length - 1;
    if (pairCount > 1) {
      standardError(`${claudeFilePath} holds ${pairCount} ${PRODUCT_NAMES.PROGRAM} blocks; only the first was refreshed and the others are now stale.`);
    }
  }
  // Reported by the bytes on disk, not by the write that was attempted.
  if (!bytesDiffer(bytesBefore, fileBytesOrNothing(claudeFilePath))) return 'unchanged';
  return `updated (${outcome})`;
}

/** Checked before the first write: the dispatcher starts every builder and reviewer as the agent this definition declares. */
export function refuseAnAgentDefinitionOptOutKeepingTheWorkflow(
  commandName: string,
  { writesTheAgentDefinition, writesTheDispatcherWorkflow }: { writesTheAgentDefinition: boolean; writesTheDispatcherWorkflow: boolean },
): void {
  if (writesTheAgentDefinition || !writesTheDispatcherWorkflow) return;
  throw new OperationRefusal(
    'refused',
    `${PRODUCT_NAMES.PROGRAM} ${commandName} --no-agent-definition needs --no-workflow as well: the dispatcher workflow starts every builder and reviewer `
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
  const installedFilePaths   = installedFilePathsIn(rootDirectory);
  const dispatcherFilePath   = installedFilePaths[lastFileOf(filesOptedOutBy('no-workflow')).name];
  const definitionFilePath   = installedFilePaths[lastFileOf(filesOptedOutBy('no-agent-definition')).name];
  if (!existsSync(dispatcherFilePath) || existsSync(definitionFilePath)) return;
  throw new OperationRefusal(
    'refused',
    `${PRODUCT_NAMES.PROGRAM} ${commandName} --no-agent-definition --no-workflow would leave ${dispatcherFilePath} in place without `
    + `${definitionFilePath}, the \`agent-progress-worker\` agent it starts every builder and reviewer as, so no worker could start. `
    + 'Nothing was written. Drop --no-agent-definition, or remove that dispatcher script first.',
  );
}

function filesOptedOutBy(optOutFlag: InstallOptOutFlag): readonly InstalledFile[] {
  return CLAUDE_CODE_INSTALL.parts.flatMap((part) => {
    if (part.optOutFlag !== optOutFlag) return [];
    if (part.writing === 'rewritten-files') return part.files;
    return [];
  });
}

/** Touches nothing the tracker holds: not `progress.json`, not a ticket, not the log. */
export function refreshTrackedRepository(request: TrackerRefreshRequest): TrackerRefreshReport {
  const {
    workspace, installedFileTexts, installedSkillFileTexts, commandName, optOutFlags, writesTheBriefFirst, standardError
  } = request;
  const installedFilePaths = installedFilePathsIn(workspace.rootDirectory);
  const { parts }          = CLAUDE_CODE_INSTALL;
  const briefsPart         = parts.find((part) => part.writing === 'briefs');
  if (briefsPart?.writing !== 'briefs') throw new OperationRefusal('unrepaired', 'The install lists no briefs.');

  function refreshedLineOf(part: InstalledPart): string {
    // Opting out comes first, or refreshing a hook the shared settings file already holds would write into a file colleagues share on
    // behalf of a reader who asked for no settings file to be touched at all.
    if (part.optOutFlag !== null && optOutFlags.has(part.optOutFlag)) return `left alone (--${part.optOutFlag})`;
    switch (part.writing) {
      case 'managed-block':
        return refreshManagedBlock(installedFilePaths[part.file.name], requiredTextOf(installedFileTexts, part.file.name), commandName, standardError);
      case 'briefs':
        return refreshBriefs(part.files, installedFilePaths, installedFileTexts);
      case 'rewritten-files':
        return refreshRewrittenFiles(part.files, installedFilePaths, installedFileTexts);
      case 'claude-settings-hooks':
        return refreshClaudeSettingsHooks(part.hooks, workspace.rootDirectory, commandName, standardError);
      case 'skill-folders':
        return refreshSkillFolders(part, workspace.rootDirectory, installedSkillFileTexts);
    }
  }

  // The briefs go last, so a write that fails before them leaves the brief's `updated` for the rerun to report, unless a fresh init
  // writes them first to mark the files installed.
  const writeOrder = [
    ...parts.filter((part) => writesTheBriefFirst && part.writing === 'briefs'),
    ...parts.filter((part) => part.writing !== 'briefs'),
    ...parts.filter((part) => !writesTheBriefFirst && part.writing === 'briefs'),
  ];
  const lineByPart = new Map<InstalledPart, string>();
  for (const part of writeOrder) lineByPart.set(part, refreshedLineOf(part));

  return {
    briefFilePath: installedFilePaths[lastFileOf(briefsPart.files).name],
    partLines:     parts.map((part) => ({
      reportLabel:     part.reportLabel,
      line:            lineByPart.get(part) ?? '',
      marksTheInstall: part === briefsPart,
    })),
  };
}

/** Called last by `init` and `update`, after every other write, so a refresh cut short leaves the old version and commands keep asking for `update`. */
export function recordInstallVersion(rootDirectory: string): void {
  createInstallManifestWriter(installedFilePathsIn(rootDirectory).installManifest).write({ installVersion: INSTALL_VERSION });
}
