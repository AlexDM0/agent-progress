/**
 * One claim per kind of refusal: a refusal built from words is printed verbatim, and a refusal built from a detail is printed exactly as
 * the util that owns that kind words it. The delegates pin their own texts, so the claims compare with their answers. The texts worded here
 * are pinned byte for byte, frozen from the services that wrote them at 6fb290d; retake them with `git show 6fb290d:src/services/tracker/Workspace.ts`,
 * `git show 6fb290d:src/services/tracker/TrackerLock.ts` and `git show 6fb290d:src/services/render/Template.ts`.
 */
import { expect, test } from 'bun:test';

import type { BoardRefusalDetail }     from '../../lib/tracker-model/BoardRefusal';
import type { UnreadableTracker }      from '../../shared/@types/UnreadableTracker';
import { OperationRefusal }            from '../../shared/OperationRefusal';
import { BoardRefusalWordingUtil }     from './BoardRefusalWordingUtil';
import { OperationRefusalWordingUtil } from './OperationRefusalWordingUtil';
import { TrackerReadingWordingUtil }   from './TrackerReadingWordingUtil';

test('a refusal built from words is printed with those words, unchanged', () => {
  const refusal = new OperationRefusal('refused', 'No tracker here. Run `agent-progress init` in /example/repository.');
  expect(OperationRefusalWordingUtil.messageOf(refusal)).toBe('No tracker here. Run `agent-progress init` in /example/repository.');
});

test('a Board refusal is printed as the Board refusal wording words its detail', () => {
  const boardRefusal: BoardRefusalDetail = { reason: 'ticket-already-held', ticketId: '001' };
  const refusal = new OperationRefusal('refused', { kind: 'board-refusal', boardRefusal });
  expect(OperationRefusalWordingUtil.messageOf(refusal)).toBe(BoardRefusalWordingUtil.messageOf(boardRefusal));
});

test('an unreadable tracker is printed as the tracker reading wording words the reading', () => {
  const reading: UnreadableTracker = { verdict: 'absent', filePath: '/example/.agent-progress/progress.json' };
  const refusal = new OperationRefusal('unrepaired', { kind: 'unreadable-tracker', reading });
  expect(OperationRefusalWordingUtil.messageOf(refusal)).toBe(TrackerReadingWordingUtil.refusalMessageOf(reading));
});

test('no tracker at the AGENT_PROGRESS_ROOT directory is worded naming the variable and how to search upwards instead', () => {
  const refusal = new OperationRefusal('refused', { kind: 'no-tracker-at-override', overrideDirectory: '/example/empty' });
  const message = OperationRefusalWordingUtil.messageOf(refusal);
  expect(message).toBe(
    'No agent-progress tracker was found in /example/empty, which AGENT_PROGRESS_ROOT names. '
    + 'Run `agent-progress init` there, or unset AGENT_PROGRESS_ROOT to search upwards from the current directory instead.',
  );
  expect(message).toContain('AGENT_PROGRESS_ROOT');
});

test('no tracker found above the start directory is worded naming that directory and `agent-progress init`', () => {
  const refusal = new OperationRefusal('refused', { kind: 'no-tracker-found', searchedFrom: '/example/untracked' });
  expect(OperationRefusalWordingUtil.messageOf(refusal)).toBe(
    'No agent-progress tracker was found in /example/untracked or any directory above it. Run `agent-progress init` in the repository you want tracked.',
  );
});

test('a held lock is worded naming the lock directory as a path to remove, never as a file', () => {
  const refusal = new OperationRefusal('unrepaired', { kind: 'tracker-lock-held', lockDirectoryPath: '/example/.agent-progress/.lock' });
  const message = OperationRefusalWordingUtil.messageOf(refusal);
  expect(message).toBe(
    'Another agent-progress command is holding /example/.agent-progress/.lock and did not release it. If nothing else is running, remove that path and try again.',
  );
  expect(message).not.toContain('that file');
});

test('a template token that is not unique is worded with the template path, the count and the token', () => {
  const refusal = new OperationRefusal('unrepaired', {
    kind:             'template-token-not-unique',
    templateFilePath: 'resources/template.html',
    token:            '__TICKETS__',
    occurrenceCount:  2,
  });
  expect(OperationRefusalWordingUtil.messageOf(refusal)).toBe('the page template resources/template.html holds 2 occurrences of __TICKETS__, not exactly one');
});
