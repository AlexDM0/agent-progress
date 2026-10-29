/**
 * The state after one event. What matters: `board` replaces everything, a record event replaces its record by id or adds it, a slice event
 * replaces its slice, and nothing updates before the first board.
 */
import { describe, expect, test } from 'bun:test';

import type { BoardStateDocument } from '../@types/BoardStateDocument.ts';
import { BoardStateUpdate }        from './BoardStateUpdate.ts';

const BOARD: BoardStateDocument = {
  project:   'Example Agency',
  jobs:      [{ id: 'J1' }],
  decisions: [],
  incidents: [],
  overseer:  { state: 'serving', paused: false, codeVersion: 'code-1' },
  usage:     null,
};

describe('the board state after an event', () => {
  test('a board replaces the state, and a slice event before the first board changes nothing', () => {
    expect(BoardStateUpdate.boardStateAfter(null, 'board', BOARD)).toBe(BOARD);
    expect(BoardStateUpdate.boardStateAfter(null, 'job', { id: 'J1' })).toBeNull();
  });

  test('a job replaces its record by id or is added; a decision and an incident are added', () => {
    const replaced = BoardStateUpdate.boardStateAfter(BOARD, 'job', { id: 'J1', state: 'running' });
    expect(replaced?.jobs).toEqual([{ id: 'J1', state: 'running' } as unknown as { id: string }]);
    expect(BoardStateUpdate.boardStateAfter(BOARD, 'job', { id: 'J2' })?.jobs.map((job) => job.id)).toEqual(['J1', 'J2']);
    expect(BoardStateUpdate.boardStateAfter(BOARD, 'decision', { id: 'Q1' })?.decisions).toEqual([{ id: 'Q1' }]);
    expect(BoardStateUpdate.boardStateAfter(BOARD, 'incident', { id: 'I1' })?.incidents).toEqual([{ id: 'I1' }]);
  });

  test('overseer and usage replace their slices', () => {
    expect(BoardStateUpdate.boardStateAfter(BOARD, 'overseer', { paused: true })?.overseer).toEqual({ state: 'serving', paused: true, codeVersion: 'code-1' });
    expect(BoardStateUpdate.boardStateAfter(BOARD, 'usage', { resetsAt: null })?.usage).toEqual({ resetsAt: null });
  });
});
