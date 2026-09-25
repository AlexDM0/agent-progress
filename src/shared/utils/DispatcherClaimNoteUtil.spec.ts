/**
 * The dispatcher's claim note, which the dispatcher writes and the CLI reads back. What callers rely on is that the note is exactly the
 * form tracked repositories already hold, that any run's note is recognised on its own ticket, and that neither a person's note nor a
 * claim on another ticket whose id merely ends the same way is taken for one.
 */
import { expect, test } from 'bun:test';

import { DispatcherClaimNoteUtil } from './DispatcherClaimNoteUtil';

const {
  runLabelFor,
  claimNoteFor,
  claimNoteBoundsFor,
  noteIsADispatcherClaimOn,
} = DispatcherClaimNoteUtil;

test('a run over the whole board is labelled whole-board', () => {
  expect(runLabelFor(null)).toBe('whole-board');
});

test('a run over named tickets is labelled with every ticket id joined by a plus', () => {
  expect(runLabelFor(['001'])).toBe('ticket-001');
  expect(runLabelFor(['001', '002'])).toBe('ticket-001+002');
});

// Tracked repositories already hold notes in this exact form, so a changed word would strand every paused build.
test('the note names the run and the ticket in the form tracked repositories already hold', () => {
  expect(claimNoteFor('whole-board', '001')).toBe('Built by the whole-board dispatcher run on ticket-001');
  expect(claimNoteFor('ticket-001+002', '002')).toBe('Built by the ticket-001+002 dispatcher run on ticket-002');
});

test('the bounds a builder is quoted are the note with its run label cut out', () => {
  const { opening, ending } = claimNoteBoundsFor('001');
  expect(opening).toBe('Built by the ');
  expect(ending).toBe(' dispatcher run on ticket-001');
  for (const runLabel of ['whole-board', 'ticket-001+002']) {
    expect(claimNoteFor(runLabel, '001')).toBe(`${opening}${runLabel}${ending}`);
  }
});

test('any run\'s note is recognised as a dispatcher claim on its own ticket', () => {
  for (const runLabel of [runLabelFor(null), runLabelFor(['001']), runLabelFor(['001', '002'])]) {
    expect(noteIsADispatcherClaimOn(claimNoteFor(runLabel, '001'), '001'), runLabel).toBe(true);
  }
});

test('a person\'s note is not a dispatcher claim', () => {
  expect(noteIsADispatcherClaimOn('Paused by Alex Example', '001')).toBe(false);
});

// Ticket 1001's id ends in 001, so a check on the digits alone would hand ticket 001 another ticket's paused build.
test('another ticket\'s claim is not recognised on this ticket', () => {
  expect(noteIsADispatcherClaimOn(claimNoteFor('whole-board', '1001'), '001')).toBe(false);
});
