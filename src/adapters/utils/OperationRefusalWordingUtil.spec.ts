/**
 * One claim per kind of refusal: a refusal built from words is printed verbatim, and a refusal built from a detail is printed exactly as
 * the util that owns that kind words it. The delegates pin their own texts, so the claims compare with their answers. The texts worded here
 * are pinned byte for byte, frozen from the services that wrote them at 6fb290d; retake them with `git show 6fb290d:src/services/tracker/Workspace.ts`
 * and `git show 6fb290d:src/services/tracker/TrackerLock.ts`.
 */
import { expect, test } from 'bun:test';

import type { BoardRefusalDetail }     from '../../lib/tracker-model/BoardRefusal.ts';
import type { UnreadableTracker }      from '../../shared/@types/UnreadableTracker.ts';
import { ROOT_OVERRIDE_VARIABLE }      from '../../shared/Environment.ts';
import { OperationRefusal }            from '../../shared/OperationRefusal.ts';
import { PRODUCT_NAMES }               from '../../shared/constants/ProductNames.ts';
import { OperationRefusalWordingUtil } from './OperationRefusalWordingUtil.ts';

test('a refusal built from words is printed with those words, unchanged', () => {
  const refusal = new OperationRefusal('refused', 'No tracker here. Run `agent-progress init` in /example/repository.');
  expect(OperationRefusalWordingUtil.messageOf(refusal)).toBe('No tracker here. Run `agent-progress init` in /example/repository.');
});

test('a Board refusal is printed as the Board refusal wording words its detail', () => {
  const boardRefusal: BoardRefusalDetail = { reason: 'ticket-already-held', ticketId: '001' };
  const refusal = new OperationRefusal('refused', { kind: 'board-refusal', boardRefusal });
  expect(OperationRefusalWordingUtil.messageOf(refusal)).toBe(OperationRefusalWordingUtil.boardRefusalMessageOf(boardRefusal));
});

/** What `status` and every mutating command print for a tracker they cannot read; a script may match them, so they are pinned as literals. */
function unreadableTrackerMessageOf(reading: UnreadableTracker): string {
  return OperationRefusalWordingUtil.messageOf(new OperationRefusal('unrepaired', { kind: 'unreadable-tracker', reading }));
}

test('an absent progress file is named by its path and said to be missing', () => {
  expect(unreadableTrackerMessageOf({ verdict: 'absent', filePath: '/example/.agent-progress/progress.json' }))
    .toBe('/example/.agent-progress/progress.json cannot be read: it is not there');
});

test('an unreadable progress file is named by its path, followed by the adapter reason verbatim', () => {
  expect(unreadableTrackerMessageOf({
    verdict:        'unreadable',
    unreadableFile: 'progress-file',
    filePath:       '/example/.agent-progress/progress.json',
    reason:         'it is not valid JSON (Unexpected end of JSON input)',
  })).toBe('/example/.agent-progress/progress.json cannot be read: it is not valid JSON (Unexpected end of JSON input)');
});

test('an unreadable log is called the log, followed by the adapter reason verbatim', () => {
  expect(unreadableTrackerMessageOf({
    verdict:        'unreadable',
    unreadableFile: 'log-file',
    filePath:       '/example/.agent-progress/log.jsonl',
    reason:         '/example/.agent-progress/log.jsonl, line 1: fields.text is not a string',
  })).toBe('The log cannot be read: /example/.agent-progress/log.jsonl, line 1: fields.text is not a string');
});

test('no tracker at the AGENT_PROGRESS_ROOT directory is worded naming the variable and how to search upwards instead', () => {
  const refusal = new OperationRefusal('refused', { kind: 'no-tracker-at-override', overrideDirectory: '/example/empty' });
  const message = OperationRefusalWordingUtil.messageOf(refusal);
  expect(message).toBe(
    `No ${PRODUCT_NAMES.PROGRAM} tracker was found in /example/empty, which ${ROOT_OVERRIDE_VARIABLE} names. `
    + `Run \`${PRODUCT_NAMES.PROGRAM} init\` there, or unset ${ROOT_OVERRIDE_VARIABLE} to search upwards from the current directory instead.`,
  );
  expect(message).toContain(ROOT_OVERRIDE_VARIABLE);
});

test('an older program\'s data folder at the root is worded naming the folder, both programs and where to run instead', () => {
  const refusal = new OperationRefusal('refused', {
    kind:                'older-program-present',
    rootDirectory:       '/example/repository',
    olderDataFolderPath: '/example/repository/.agent-progress',
    program:             'agent-progress-v2',
    olderProgram:        'agent-progress',
  });
  expect(OperationRefusalWordingUtil.messageOf(refusal)).toBe(
    '/example/repository/.agent-progress holds what agent-progress keeps for /example/repository, and agent-progress-v2 is built to run '
    + 'beside it only in a repository agent-progress does not track, so nothing was written. Run agent-progress-v2 in a scratch repository instead.',
  );
});

test('no tracker found above the start directory is worded naming that directory and `agent-progress init`', () => {
  const refusal = new OperationRefusal('refused', { kind: 'no-tracker-found', searchedFrom: '/example/untracked' });
  expect(OperationRefusalWordingUtil.messageOf(refusal)).toBe(
    `No ${PRODUCT_NAMES.PROGRAM} tracker was found in /example/untracked or any directory above it. `
    + `Run \`${PRODUCT_NAMES.PROGRAM} init\` in the repository you want tracked.`,
  );
});

test('a held lock is worded naming the lock directory as a path to remove, never as a file', () => {
  const refusal = new OperationRefusal('unrepaired', { kind: 'tracker-lock-held', lockDirectoryPath: '/example/.agent-progress/.lock' });
  const message = OperationRefusalWordingUtil.messageOf(refusal);
  expect(message).toBe(
    `Another ${PRODUCT_NAMES.PROGRAM} command is holding /example/.agent-progress/.lock and did not release it. `
    + 'If nothing else is running, remove that path and try again.',
  );
  expect(message).not.toContain('that file');
});

test('a board no Overseer serves is worded naming the lease folder and the command that starts one', () => {
  const refusal = new OperationRefusal('refused', { kind: 'overseer-down', runnerDirectory: '/example/repository/.agent-progress/runner' });
  expect(OperationRefusalWordingUtil.messageOf(refusal)).toBe(
    'No Overseer serves this board (/example/repository/.agent-progress/runner holds no live lease), so there is nothing to open. '
    + `Start one with \`${PRODUCT_NAMES.PROGRAM} run --detach\`.`,
  );
});

test('an install version mismatch is printed as the install version wording words its detail', () => {
  const detail = {
    kind:             'install-version-mismatch',
    rootDirectory:    '/example/repository',
    manifestFilePath: '/example/repository/.agent-progress/version.json',
    installVersion:   1,
    mismatch:         { reason: 'unversioned' },
  } as const;
  const refusal = new OperationRefusal('refused', detail);
  expect(OperationRefusalWordingUtil.messageOf(refusal)).toBe(OperationRefusalWordingUtil.installVersionMismatchMessageOf(detail));
});
