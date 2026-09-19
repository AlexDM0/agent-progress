/**
 * The `SubagentStop` entry `agent-progress init --hooks` puts into a repository's
 * `.claude/settings.json`. The file belongs to the harness and to whoever else has written into it,
 * so this merges rather than writes: the document is parsed, the entry is added only when no
 * identical command is already there, and everything else — every other key, every other hook event,
 * every other matcher — is handed back unchanged.
 *
 * A file that will not parse is **refused, never overwritten**. Replacing it would be the one failure
 * a person cannot undo from here, and the tool has no way to tell a corrupted document from one whose
 * format it does not know yet; the caller reports the refusal and the rest of `init` still runs.
 *
 * Written through `lib/platform/AtomicFile.ts` rather than in place, unlike `.gitignore` and
 * `CLAUDE.md`: the harness reads this file at moments nobody controls, and a half-written settings
 * document is a session that starts without its hooks.
 *
 * It knows nothing about tasks or about what the hook does — the matcher, the command and the timeout
 * are the caller's, which is what keeps this module a settings writer rather than a second place that
 * decides how the tracker is invoked.
 */
import { readFileSync, statSync } from 'node:fs';
import { join }                   from 'node:path';

import { JSON_INDENT }         from '../constants/Limits';
import { writeFileAtomically } from './AtomicFile';

const CLAUDE_DIRECTORY_NAME = '.claude';

const SETTINGS_FILE_NAME = 'settings.json';

/** The harness's own spelling of the event, capitalised as it writes it; a lower-case one is simply never matched. */
const SUBAGENT_STOP_EVENT_NAME = 'SubagentStop';

const COMMAND_HOOK_TYPE = 'command';

const HOOKS_KEY = 'hooks';

export type WriteSubagentStopHookOutcome = 'created' | 'added' | 'already-present' | 'refused-unreadable';

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

function groupFor(hook: SubagentStopHook): Record<string, unknown> {
  return {
    matcher: hook.matcher,
    hooks:   [{ type: COMMAND_HOOK_TYPE, command: hook.command, timeout: hook.timeoutSeconds }],
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
