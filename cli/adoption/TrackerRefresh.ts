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
import { removeManagedBlock }          from '../../src/lib/claude-code/ClaudeInstructions.ts';
import {
  claudeLocalSettingsFilePathFor,
  claudeSettingsFilePathFor,
  refreshCommandHook,
  removeCommandHook,
  writeCommandHook,
  type CommandHook
}                                                                    from '../../src/lib/claude-code/ClaudeSettings.ts';
import { ensureIgnored, removeIgnoreEntry }                                                from '../../src/lib/git/GitIgnore.ts';
import type { EnsureIgnoredOutcome }                                                       from '../../src/lib/git/GitIgnore.ts';
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
import { CLAUDE_MANAGED_BLOCK_MARKERS }               from './constants/ClaudeManagedBlockMarkers.ts';
import { RETIRED_HOOKS, retiredInstalledFilePathsIn } from './constants/RetiredClaudeInstall.ts';

const REFUSED_UNREADABLE_SETTINGS_LINE = 'refused (the settings file could not be read)';

const CLAUDE_INSTRUCTIONS_FILE_NAME = 'CLAUDE.md';

export const IGNORE_OUTCOME_WORDS: Readonly<Record<EnsureIgnoredOutcome, string>> = {
  'already-ignored':      'already ignored, so nothing was added',
  'appended':             'entry added',
  'no-gitignore-written': 'not written — this directory is not a git repository',
};

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

/** Removed once: `init` and `update` no longer own CLAUDE.md, and the Overseer launches nothing onto a target that still commits the block. */
function removeTheManagedBlock(rootDirectory: string, commandName: string, standardError: (text: string) => void): string {
  const claudeFilePath = join(rootDirectory, CLAUDE_INSTRUCTIONS_FILE_NAME);
  const outcome        = removeManagedBlock(claudeFilePath, CLAUDE_MANAGED_BLOCK_MARKERS);
  if (outcome === 'refused-start-without-end') {
    standardError(
      `${claudeFilePath} has an \`${CLAUDE_MANAGED_BLOCK_MARKERS.start}\` marker with no matching end marker, so the block was left alone. `
      + `Close or remove that marker and run \`${PRODUCT_NAMES.PROGRAM} ${commandName}\` again.`,
    );
    return 'refused (start marker without an end marker)';
  }
  return outcome === 'removed' ? 'removed; commit CLAUDE.md' : 'no managed block';
}

/** Each retired hook goes from both settings files, since version 16 wrote it into whichever already held it; nothing is said when none was there. */
function retiredHookLinesOf(rootDirectory: string, commandName: string, standardError: (text: string) => void): string[] {
  const settingsFilePaths = [claudeSettingsFilePathFor(rootDirectory), claudeLocalSettingsFilePathFor(rootDirectory)];
  return settingsFilePaths.flatMap((settingsFilePath) => {
    const outcomes = RETIRED_HOOKS.map((hook) => ({ event: hook.event, outcome: removeCommandHook(settingsFilePath, hook) }));
    if (outcomes.some(({ outcome }) => outcome === 'refused-unreadable')) {
      standardError(
        `${settingsFilePath} could not be read as a JSON object, so it was left exactly as it was and the retired hooks stayed in it. `
        + `Fix or remove that file and run \`${PRODUCT_NAMES.PROGRAM} ${commandName}\` again.`,
      );
      return [`${REFUSED_UNREADABLE_SETTINGS_LINE} ${settingsFilePath}`];
    }
    const removedEvents = outcomes.filter(({ outcome }) => outcome === 'removed').map(({ event }) => event);
    return removedEvents.length === 0 ? [] : [`removed ${removedEvents.join(', ')} hooks (${settingsFilePath})`];
  });
}

/** What install version 16 wrote that 17 does not: its hooks, unless the reader asked for no settings file to be touched, and its files. */
function removeTheRetiredInstall(rootDirectory: string, removesHooks: boolean, commandName: string, standardError: (text: string) => void): string {
  const hookLines   = removesHooks ? retiredHookLinesOf(rootDirectory, commandName, standardError) : [];
  const removedFilePaths = Object.values(retiredInstalledFilePathsIn(rootDirectory)).filter((filePath) => existsSync(filePath));
  for (const filePath of removedFilePaths) rmSync(filePath);
  const fileLines = removedFilePaths.map((filePath) => `removed (${filePath})`);
  const lines = [...hookLines, ...fileLines];
  return lines.length === 0 ? 'nothing to remove' : lines.join('; ');
}

function ignoreFolders(rootDirectory: string, folderNames: readonly string[]): string {
  return folderNames.map((folderName) => `${folderName} ${IGNORE_OUTCOME_WORDS[ensureIgnored(rootDirectory, folderName)]}`).join('; ');
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
      case 'retired-managed-block':
        return removeTheManagedBlock(workspace.rootDirectory, commandName, standardError);
      case 'retired-install':
        return removeTheRetiredInstall(workspace.rootDirectory, !optOutFlags.has('no-hooks'), commandName, standardError);
      case 'briefs':
        return refreshBriefs(part.files, installedFilePaths, installedFileTexts);
      case 'claude-settings-hooks':
        return refreshClaudeSettingsHooks(part.hooks, workspace.rootDirectory, commandName, standardError);
      case 'skill-folders':
        return refreshSkillFolders(part, workspace.rootDirectory, installedSkillFileTexts);
      case 'ignored-folders':
        return ignoreFolders(workspace.rootDirectory, part.folderNames);
    }
  }

  // The briefs go last, so a write that fails before them leaves the brief's `updated` for the rerun to report, unless a fresh init
  // writes them first to mark the files installed. The retired parts go after them, so a run cut short never leaves neither marker.
  const isRetired = (part: InstalledPart) => part.writing === 'retired-managed-block' || part.writing === 'retired-install';
  const writeOrder = [
    ...parts.filter((part) => writesTheBriefFirst && part.writing === 'briefs'),
    ...parts.filter((part) => part.writing !== 'briefs' && !isRetired(part)),
    ...parts.filter((part) => !writesTheBriefFirst && part.writing === 'briefs'),
    ...parts.filter(isRetired),
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
