/**
 * The install-version mismatch paragraph, pinned byte for byte per reason. What matters: each reason names the root and the numbers it has, each
 * says nothing was done and how out, only `newer` asks for agent-progress itself to be updated first, and none holds a newline, because the
 * SubagentStop hook prints it as the tail of one prefixed report.
 */
import { describe, expect, test } from 'bun:test';

import type { InstallVersionMismatch } from '../../shared/@types/InstallVersionMismatch.ts';
import { InstallVersionWordingUtil }   from './InstallVersionWordingUtil.ts';

const ROOT_DIRECTORY     = '/example/repository';
const MANIFEST_FILE_PATH = '/example/repository/.agent-progress/version.json';

function messageFor(mismatch: InstallVersionMismatch): string {
  return InstallVersionWordingUtil.messageOf({
    kind:             'install-version-mismatch',
    rootDirectory:    ROOT_DIRECTORY,
    manifestFilePath: MANIFEST_FILE_PATH,
    installVersion:   3,
    mismatch,
  });
}

describe('InstallVersionWordingUtil.messageOf', () => {
  test('an older install names both versions and asks for update', () => {
    expect(messageFor({ reason: 'older', installedVersion: 2 })).toBe(
      'The files agent-progress installed in /example/repository are install version 2, from an older agent-progress, '
      + 'and this one needs install version 3, so nothing was done. Run `agent-progress update` in /example/repository.',
    );
  });

  test('a newer install names both versions and asks for agent-progress itself to be updated before update runs', () => {
    expect(messageFor({ reason: 'newer', installedVersion: 4 })).toBe(
      'The files agent-progress installed in /example/repository are install version 4, from a newer agent-progress than this one '
      + '(install version 3), so nothing was done. Update agent-progress itself, then run `agent-progress update` in /example/repository.',
    );
  });

  test('an unversioned install names the missing manifest and asks for update', () => {
    expect(messageFor({ reason: 'unversioned' })).toBe(
      'The files agent-progress installed in /example/repository carry no install version (/example/repository/.agent-progress/version.json is '
      + 'missing), so they are from an agent-progress older than this one, which needs install version 3; nothing was done. '
      + 'Run `agent-progress update` in /example/repository.',
    );
  });

  test('an unreadable manifest names the manifest and its problem and asks for update', () => {
    expect(messageFor({ reason: 'unreadable', manifestProblem: 'it is not a JSON object' })).toBe(
      '/example/repository/.agent-progress/version.json gives no install version: it is not a JSON object. So the install version of the files '
      + 'agent-progress installed in /example/repository is unknown and nothing was done. Run `agent-progress update` in /example/repository.',
    );
  });

  test('an I/O failure reading the manifest names the problem once', () => {
    const message = messageFor({ reason: 'unreadable', manifestProblem: 'it could not be read (EISDIR: illegal operation on a directory, read)' });
    expect(message).toBe(
      '/example/repository/.agent-progress/version.json gives no install version: it could not be read (EISDIR: illegal operation on a directory, '
      + 'read). So the install version of the files agent-progress installed in /example/repository is unknown and nothing was done. '
      + 'Run `agent-progress update` in /example/repository.',
    );
    expect(message.split('could not be read')).toHaveLength(2);
  });

  test('a directory at the manifest\'s path asks for it to be removed before update runs', () => {
    expect(messageFor({ reason: 'manifest-is-a-directory' })).toBe(
      '/example/repository/.agent-progress/version.json is a directory where agent-progress keeps its install version file, so nothing was done. '
      + 'Remove that directory, then run `agent-progress update` in /example/repository.',
    );
  });

  test('every reason is one paragraph with no newline', () => {
    const mismatches: InstallVersionMismatch[] = [
      { reason: 'older', installedVersion: 2 },
      { reason: 'newer', installedVersion: 4 },
      { reason: 'unversioned' },
      { reason: 'unreadable', manifestProblem: 'it is not valid JSON' },
      { reason: 'manifest-is-a-directory' },
    ];
    expect(mismatches.filter((mismatch) => messageFor(mismatch).includes('\n'))).toEqual([]);
  });
});
