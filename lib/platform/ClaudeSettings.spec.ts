/**
 * The four cases that decide whether this is safe to run against a file the tool does not own: a
 * repository with no settings at all, one whose settings hold other people's keys, a second
 * `init --hooks` that must leave no diff, and a malformed document that must survive untouched.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync }                               from 'node:fs';
import { join }                                    from 'node:path';
import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import { createScratchDirectory, removeScratchDirectory }   from '../tooling/dev/ScratchWorkspace';
import { claudeSettingsFilePathFor, writeSubagentStopHook } from './ClaudeSettings';

const THE_HOOK = {
  matcher:        '',
  command:        'agent-progress hook subagent-stop',
  timeoutSeconds: 20,
};

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchRoot(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return directory;
}

function writeSettings(rootDirectory: string, contents: string): string {
  const settingsFilePath = claudeSettingsFilePathFor(rootDirectory);
  mkdirSync(join(rootDirectory, '.claude'), { recursive: true });
  writeFileSync(settingsFilePath, contents);
  return settingsFilePath;
}

function settingsIn(rootDirectory: string): Record<string, unknown> {
  return JSON.parse(readFileSync(claudeSettingsFilePathFor(rootDirectory), 'utf8')) as Record<string, unknown>;
}

describe('a repository with no settings file', () => {
  test('gets one holding just the hook, in the folder the harness reads it from', () => {
    const rootDirectory = scratchRoot('claude-settings-created');

    expect(writeSubagentStopHook(claudeSettingsFilePathFor(rootDirectory), THE_HOOK)).toBe('created');

    expect(existsSync(join(rootDirectory, '.claude', 'settings.json'))).toBe(true);
    expect(settingsIn(rootDirectory)).toEqual({
      hooks: {
        SubagentStop: [
          { matcher: '', hooks: [{ type: 'command', command: 'agent-progress hook subagent-stop', timeout: 20 }] },
        ],
      },
    });
  });
});

describe('a settings file that already says things', () => {
  /** The failure this guards against is the whole reason the writer merges: a settings file is shared, and losing a permission list is silent. */
  test('keeps every other key, and every other hook event, exactly as it found them', () => {
    const rootDirectory = scratchRoot('claude-settings-merged');
    writeSettings(rootDirectory, JSON.stringify({
      permissions: { allow: ['Bash(bun test)'] },
      hooks:       { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'echo hello' }] }] },
      model:       'opus',
    }, null, 2));

    expect(writeSubagentStopHook(claudeSettingsFilePathFor(rootDirectory), THE_HOOK)).toBe('added');

    const settings = settingsIn(rootDirectory);
    expect(settings['permissions']).toEqual({ allow: ['Bash(bun test)'] });
    expect(settings['model']).toBe('opus');
    const hooks = settings['hooks'] as Record<string, unknown>;
    expect(hooks['SessionStart']).toEqual([{ matcher: '', hooks: [{ type: 'command', command: 'echo hello' }] }]);
    expect((hooks['SubagentStop'] as unknown[]).length).toBe(1);
  });

  test('a SubagentStop entry somebody else wrote is kept, and this one is added beside it', () => {
    const rootDirectory = scratchRoot('claude-settings-other-subagent-stop');
    writeSettings(rootDirectory, JSON.stringify({ hooks: { SubagentStop: [{ matcher: 'Explore', hooks: [{ type: 'command', command: 'say done' }] }] }, }, null, 2));

    expect(writeSubagentStopHook(claudeSettingsFilePathFor(rootDirectory), THE_HOOK)).toBe('added');

    const groups = (settingsIn(rootDirectory)['hooks'] as Record<string, unknown>)['SubagentStop'] as unknown[];
    expect(groups.length).toBe(2);
    expect(groups[0]).toEqual({ matcher: 'Explore', hooks: [{ type: 'command', command: 'say done' }] });
  });
});

describe('a second init --hooks', () => {
  /** Re-running `init` is the documented way to refresh a repository, so the second run has to leave the file byte for byte as the first did. */
  test('finds the command already there, adds nothing and leaves the file unchanged', () => {
    const rootDirectory    = scratchRoot('claude-settings-idempotent');
    const settingsFilePath = claudeSettingsFilePathFor(rootDirectory);
    expect(writeSubagentStopHook(settingsFilePath, THE_HOOK)).toBe('created');
    const afterTheFirstRun = readFileSync(settingsFilePath, 'utf8');

    expect(writeSubagentStopHook(settingsFilePath, THE_HOOK)).toBe('already-present');

    expect(readFileSync(settingsFilePath, 'utf8')).toBe(afterTheFirstRun);
  });

  test('the same command under a different matcher still counts as already there, so the log never gains a second line per agent', () => {
    const rootDirectory = scratchRoot('claude-settings-other-matcher');
    const sameCommandElsewhere = [{ matcher: '*', hooks: [{ type: 'command', command: 'agent-progress hook subagent-stop', timeout: 20 }] }];
    writeSettings(rootDirectory, JSON.stringify({ hooks: { SubagentStop: sameCommandElsewhere } }, null, 2));

    expect(writeSubagentStopHook(claudeSettingsFilePathFor(rootDirectory), THE_HOOK)).toBe('already-present');
  });
});

describe('a settings file this cannot merge into', () => {
  test('a malformed document is refused and survives exactly as it was, rather than being replaced with a valid one', () => {
    const rootDirectory    = scratchRoot('claude-settings-malformed');
    const malformedText    = '{ "permissions": { "allow": ["Bash(bun test)"] ,,, }';
    const settingsFilePath = writeSettings(rootDirectory, malformedText);

    expect(writeSubagentStopHook(settingsFilePath, THE_HOOK)).toBe('refused-unreadable');

    expect(readFileSync(settingsFilePath, 'utf8')).toBe(malformedText);
  });

  test('a document that is valid JSON but the wrong shape is refused too, in each of the three places a shape can be wrong', () => {
    const cases: Record<string, string> = {
      'the document is an array':   '[]',
      'hooks is not an object':     '{"hooks": "none"}',
      'SubagentStop is not a list': '{"hooks": {"SubagentStop": {"matcher": "general-purpose"}}}',
    };

    for (const [description, contents] of Object.entries(cases)) {
      const rootDirectory    = scratchRoot('claude-settings-wrong-shape');
      const settingsFilePath = writeSettings(rootDirectory, contents);

      expect(writeSubagentStopHook(settingsFilePath, THE_HOOK), description).toBe('refused-unreadable');
      expect(readFileSync(settingsFilePath, 'utf8'), description).toBe(contents);
    }
  });

  /** An empty file is what a crashed writer leaves behind; treating it as `{}` would quietly discard whatever it was meant to hold. */
  test('an empty file is refused rather than read as an empty document', () => {
    const rootDirectory    = scratchRoot('claude-settings-empty');
    const settingsFilePath = writeSettings(rootDirectory, '');

    expect(writeSubagentStopHook(settingsFilePath, THE_HOOK)).toBe('refused-unreadable');
    expect(readFileSync(settingsFilePath, 'utf8')).toBe('');
  });
});
