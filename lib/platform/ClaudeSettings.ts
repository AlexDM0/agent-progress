/**
 * Merges the `SubagentStop` hook entry into a repository's Claude settings file, adding it only when no
 * identical command is there and handing every other key back unchanged.
 * A file that will not parse is **refused, never overwritten**, since the tool cannot tell a corrupted document from an unknown format.
 * Written through `lib/platform/AtomicFile.ts`, unlike `.gitignore` and `CLAUDE.md`, because the harness reads it at moments nobody controls.
 */
import { readFileSync, statSync } from 'node:fs';
import { join }                   from 'node:path';

import { JSON_INDENT }         from '../constants/Limits';
import { writeFileAtomically } from './AtomicFile';

const CLAUDE_DIRECTORY_NAME = '.claude';

const SETTINGS_FILE_NAME = 'settings.json';

/** Claude Code reads this one over the shared file and keeps it out of git: what a subagent cost is the figure of whoever ran the tool. */
const LOCAL_SETTINGS_FILE_NAME = 'settings.local.json';

/** The harness's own spelling of the event, capitalised as it writes it; a lower-case one is simply never matched. */
const SUBAGENT_STOP_EVENT_NAME = 'SubagentStop';

const COMMAND_HOOK_TYPE = 'command';

const HOOKS_KEY = 'hooks';

export type WriteSubagentStopHookOutcome = 'created' | 'added' | 'already-present' | 'refused-unreadable';

export type RefreshSubagentStopHookOutcome = 'absent' | 'unchanged' | 'updated' | 'refused-unreadable';

/** The timeout is in seconds because that is the unit the settings file stores; the name carries it so no caller has to guess. */
export interface SubagentStopHook {
  matcher:        string;
  command:        string;
  timeoutSeconds: number;
}

/** Derived rather than carried on `Workspace`: only `init --hooks` ever names this file, and `Workspace` is the set of paths every command shares. */
export function claudeSettingsFilePathFor(rootDirectory: string): string {
  return join(rootDirectory, CLAUDE_DIRECTORY_NAME, SETTINGS_FILE_NAME);
}

/** The same file for the same writer, one name along: everything here takes a path, so neither of them is a second code path. */
export function claudeLocalSettingsFilePathFor(rootDirectory: string): string {
  return join(rootDirectory, CLAUDE_DIRECTORY_NAME, LOCAL_SETTINGS_FILE_NAME);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
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
  return asRecord(parsed) ?? 'unreadable';
}

/** Compared on the command alone: the same command under a second matcher would be a second log line per agent. */
function groupAlreadyRunsTheCommand(group: unknown, command: string): boolean {
  const groupRecord = asRecord(group);
  if (groupRecord === undefined) return false;

  const groupHooks = groupRecord[HOOKS_KEY];
  if (!Array.isArray(groupHooks)) return false;

  return groupHooks.some((entry) => asRecord(entry)?.['command'] === command);
}

function commandEntryFor(hook: SubagentStopHook): Record<string, unknown> {
  return {
    type:    COMMAND_HOOK_TYPE,
    command: hook.command,
    timeout: hook.timeoutSeconds,
  };
}

function groupFor(hook: SubagentStopHook): Record<string, unknown> {
  return {
    matcher: hook.matcher,
    hooks:   [commandEntryFor(hook)],
  };
}

/** The group with this command's entry brought up to date, its matcher and any hook beside it left as whoever wrote them meant them. */
function groupWithRefreshedEntry(group: unknown, hook: SubagentStopHook): unknown {
  const groupRecord = asRecord(group);
  if (groupRecord === undefined) return group;

  const groupHooks = groupRecord[HOOKS_KEY];
  if (!Array.isArray(groupHooks)) return group;

  return {
    ...groupRecord,
    [HOOKS_KEY]: groupHooks.map((entry) => (asRecord(entry)?.['command'] === hook.command ? commandEntryFor(hook) : entry)),
  };
}

/**
 * Adds the hook and says what it did. `'already-present'` is returned for a file that already runs
 * this command under any matcher and nothing is written at all, so re-running `init --hooks` leaves
 * no diff. `'refused-unreadable'` covers a document that will not parse, one that is not a JSON
 * object, and one whose `hooks` section or `SubagentStop` list is of a shape this cannot merge into —
 * **in every one of those cases the existing file is left exactly as it was**, and the caller says so
 * rather than the tool deciding it knows better.
 */
export function writeSubagentStopHook(settingsFilePath: string, hook: SubagentStopHook): WriteSubagentStopHookOutcome {
  const settingsFileExisted = fileExists(settingsFilePath);

  const settings = settingsFileExisted ? parsedSettings(settingsFilePath) : {};
  if (settings === 'unreadable') return 'refused-unreadable';

  const hooksSectionValue = settings[HOOKS_KEY];
  const hooksSection      = hooksSectionValue === undefined ? {} : asRecord(hooksSectionValue);
  if (hooksSection === undefined) return 'refused-unreadable';

  const eventGroupsValue = hooksSection[SUBAGENT_STOP_EVENT_NAME];
  if (eventGroupsValue !== undefined && !Array.isArray(eventGroupsValue)) return 'refused-unreadable';
  const eventGroups: unknown[] = eventGroupsValue === undefined ? [] : [...eventGroupsValue];

  if (eventGroups.some((group) => groupAlreadyRunsTheCommand(group, hook.command))) return 'already-present';

  eventGroups.push(groupFor(hook));
  hooksSection[SUBAGENT_STOP_EVENT_NAME] = eventGroups;
  settings[HOOKS_KEY] = hooksSection;

  writeFileAtomically(settingsFilePath, `${JSON.stringify(settings, null, JSON_INDENT)}\n`);
  return settingsFileExisted ? 'added' : 'created';
}

/**
 * Brings an entry that is **already there** up to the hook this tool ships, and says whether that
 * changed anything. An entry nobody installed stays `'absent'` and nothing is written: a first install
 * into a file the user owns is the caller's decision, not this module's. Nothing is written when the
 * entry already says what it should either, so refreshing a settings file somebody formatted by hand
 * leaves no diff. The matcher and every hook beside this command's are left alone — the same tolerance
 * `writeSubagentStopHook` shows, which recognises this command under any matcher.
 */
export function refreshSubagentStopHook(settingsFilePath: string, hook: SubagentStopHook): RefreshSubagentStopHookOutcome {
  if (!fileExists(settingsFilePath)) return 'absent';

  const settings = parsedSettings(settingsFilePath);
  if (settings === 'unreadable') return 'refused-unreadable';

  const hooksSection = asRecord(settings[HOOKS_KEY]);
  if (hooksSection === undefined) return settings[HOOKS_KEY] === undefined ? 'absent' : 'refused-unreadable';

  const eventGroupsValue = hooksSection[SUBAGENT_STOP_EVENT_NAME];
  if (eventGroupsValue === undefined) return 'absent';
  if (!Array.isArray(eventGroupsValue)) return 'refused-unreadable';

  if (!eventGroupsValue.some((group) => groupAlreadyRunsTheCommand(group, hook.command))) return 'absent';

  const refreshedGroups = eventGroupsValue.map((group) => (groupAlreadyRunsTheCommand(group, hook.command) ? groupWithRefreshedEntry(group, hook) : group));
  if (JSON.stringify(refreshedGroups) === JSON.stringify(eventGroupsValue)) return 'unchanged';

  hooksSection[SUBAGENT_STOP_EVENT_NAME] = refreshedGroups;
  settings[HOOKS_KEY] = hooksSection;
  writeFileAtomically(settingsFilePath, `${JSON.stringify(settings, null, JSON_INDENT)}\n`);
  return 'updated';
}
