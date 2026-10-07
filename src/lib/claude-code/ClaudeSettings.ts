/**
 * Merges a command hook entry under its event into a repository's Claude settings file, adding it only when no
 * identical command is there and handing every other key back unchanged.
 * A file that will not parse is **refused, never overwritten**, since nothing here can tell a corrupted document from an unknown format.
 */
import { readFileSync, statSync } from 'node:fs';
import { join }                   from 'node:path';

import { writeFileAtomically }   from '../atomic-file/AtomicFile.ts';
import { JsonRecordUtil }        from '../json-record/JsonRecordUtil.ts';
import { CLAUDE_DIRECTORY_NAME } from './constants/ClaudeCodePaths.ts';

const SETTINGS_FILE_NAME = 'settings.json';

const SETTINGS_FILE_JSON_INDENT_SPACES = 2;

/** Claude Code reads this one over the shared file and keeps it out of git, for a setting that belongs to one person rather than the repository. */
const LOCAL_SETTINGS_FILE_NAME = 'settings.local.json';

const COMMAND_HOOK_TYPE = 'command';

const HOOKS_KEY = 'hooks';

export type WriteCommandHookOutcome = 'created' | 'added' | 'already-present' | 'refused-unreadable';

export type RefreshCommandHookOutcome = 'absent' | 'unchanged' | 'updated' | 'refused-unreadable';

/**
 * The event is the harness's own spelling (`SubagentStop`, `PreToolUse`), capitalised as it writes it; a lower-case one is simply never
 * matched. The timeout is in seconds because that is the unit the settings file stores.
 */
export interface CommandHook {
  event:          string;
  matcher:        string;
  command:        string;
  timeoutSeconds: number;
}

/** Derived from the root on demand, because only a caller installing the hook ever names this file. */
export function claudeSettingsFilePathFor(rootDirectory: string): string {
  return join(rootDirectory, CLAUDE_DIRECTORY_NAME, SETTINGS_FILE_NAME);
}

/** The same file for the same writer, one name along: everything here takes a path, so neither of them is a second code path. */
export function claudeLocalSettingsFilePathFor(rootDirectory: string): string {
  return join(rootDirectory, CLAUDE_DIRECTORY_NAME, LOCAL_SETTINGS_FILE_NAME);
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    // Fail closed: a `stat` that errors reads as "no settings file", which leads to writing a fresh one rather than to a merge against nothing.
    return false;
  }
}

function parsedSettings(settingsFilePath: string): Record<string, unknown> | 'unreadable' {
  let rawSettings: string;
  try {
    rawSettings = readFileSync(settingsFilePath, 'utf8');
  } catch {
    return 'unreadable';
  }

  // An empty file is a document nobody finished writing, not an empty object, so it is refused like a malformed one.
  if (rawSettings.trim().length === 0) return 'unreadable';

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSettings);
  } catch {
    return 'unreadable';
  }
  return JsonRecordUtil.recordOf(parsed) ?? 'unreadable';
}

/** Compared on the command alone: the same command under a second matcher would run twice for one agent. */
function groupAlreadyRunsTheCommand(group: unknown, command: string): boolean {
  const groupRecord = JsonRecordUtil.recordOf(group);
  if (groupRecord === undefined) return false;

  const groupHooks = groupRecord[HOOKS_KEY];
  if (!Array.isArray(groupHooks)) return false;

  return groupHooks.some((entry) => JsonRecordUtil.recordOf(entry)?.['command'] === command);
}

function commandEntryFor(hook: CommandHook): Record<string, unknown> {
  return {
    type:    COMMAND_HOOK_TYPE,
    command: hook.command,
    timeout: hook.timeoutSeconds,
  };
}

function groupFor(hook: CommandHook): Record<string, unknown> {
  return {
    matcher: hook.matcher,
    hooks:   [commandEntryFor(hook)],
  };
}

/** The group with this command's entry brought up to date, its matcher and any hook beside it left as whoever wrote them meant them. */
function groupWithRefreshedEntry(group: unknown, hook: CommandHook): unknown {
  const groupRecord = JsonRecordUtil.recordOf(group);
  if (groupRecord === undefined) return group;

  const groupHooks = groupRecord[HOOKS_KEY];
  if (!Array.isArray(groupHooks)) return group;

  return {
    ...groupRecord,
    [HOOKS_KEY]: groupHooks.map((entry) => (JsonRecordUtil.recordOf(entry)?.['command'] === hook.command ? commandEntryFor(hook) : entry)),
  };
}

/** Writes nothing when this command already runs under any matcher; a file it cannot merge into is refused and left untouched. */
export function writeCommandHook(settingsFilePath: string, hook: CommandHook): WriteCommandHookOutcome {
  const settingsFileExisted = fileExists(settingsFilePath);

  const settings = settingsFileExisted ? parsedSettings(settingsFilePath) : {};
  if (settings === 'unreadable') return 'refused-unreadable';

  const hooksSectionValue = settings[HOOKS_KEY];
  const hooksSection      = hooksSectionValue === undefined ? {} : JsonRecordUtil.recordOf(hooksSectionValue);
  if (hooksSection === undefined) return 'refused-unreadable';

  const eventGroupsValue = hooksSection[hook.event];
  if (eventGroupsValue !== undefined && !Array.isArray(eventGroupsValue)) return 'refused-unreadable';
  const eventGroups: unknown[] = eventGroupsValue === undefined ? [] : [...eventGroupsValue];

  if (eventGroups.some((group) => groupAlreadyRunsTheCommand(group, hook.command))) return 'already-present';

  eventGroups.push(groupFor(hook));
  hooksSection[hook.event] = eventGroups;
  settings[HOOKS_KEY] = hooksSection;

  writeFileAtomically(settingsFilePath, `${JSON.stringify(settings, null, SETTINGS_FILE_JSON_INDENT_SPACES)}\n`);
  return settingsFileExisted ? 'added' : 'created';
}

/** Only updates an entry that is already there, under any matcher; an absent entry or one already current writes nothing. */
export function refreshCommandHook(settingsFilePath: string, hook: CommandHook): RefreshCommandHookOutcome {
  if (!fileExists(settingsFilePath)) return 'absent';

  const settings = parsedSettings(settingsFilePath);
  if (settings === 'unreadable') return 'refused-unreadable';

  const hooksSection = JsonRecordUtil.recordOf(settings[HOOKS_KEY]);
  if (hooksSection === undefined) return settings[HOOKS_KEY] === undefined ? 'absent' : 'refused-unreadable';

  const eventGroupsValue = hooksSection[hook.event];
  if (eventGroupsValue === undefined) return 'absent';
  if (!Array.isArray(eventGroupsValue)) return 'refused-unreadable';

  if (!eventGroupsValue.some((group) => groupAlreadyRunsTheCommand(group, hook.command))) return 'absent';

  const refreshedGroups = eventGroupsValue.map((group) => (groupAlreadyRunsTheCommand(group, hook.command) ? groupWithRefreshedEntry(group, hook) : group));
  if (JSON.stringify(refreshedGroups) === JSON.stringify(eventGroupsValue)) return 'unchanged';

  hooksSection[hook.event] = refreshedGroups;
  settings[HOOKS_KEY] = hooksSection;
  writeFileAtomically(settingsFilePath, `${JSON.stringify(settings, null, SETTINGS_FILE_JSON_INDENT_SPACES)}\n`);
  return 'updated';
}

/** Reads only: whether the event runs this command under any matcher. A file that cannot be read holds no entry anyone could run. */
export function commandHookIsPresent(settingsFilePath: string, hook: Pick<CommandHook, 'event' | 'command'>): boolean {
  if (!fileExists(settingsFilePath)) return false;
  const settings = parsedSettings(settingsFilePath);
  if (settings === 'unreadable') return false;
  const eventGroups = JsonRecordUtil.recordOf(settings[HOOKS_KEY])?.[hook.event];
  return Array.isArray(eventGroups) && eventGroups.some((group) => groupAlreadyRunsTheCommand(group, hook.command));
}
