/**
 * One claim per kind of refusal: a refusal built from words is printed verbatim, and a refusal built from a detail is printed exactly as
 * the util that owns that kind words it. The delegates pin their own texts, so the claims compare with their answers.
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
