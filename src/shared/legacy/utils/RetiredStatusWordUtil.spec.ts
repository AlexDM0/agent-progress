/**
 * The mapping from retired stored status words to the words that replaced them. What readers rely on is that only a retired word
 * maps: a current word, a word from the other ladder and a name every object inherits all come back `null`.
 */
import { expect, test } from 'bun:test';

import { RetiredStatusWordUtil } from './RetiredStatusWordUtil.ts';

const { currentTicketStatusFor, currentTaskStatusFor } = RetiredStatusWordUtil;

test('each retired ticket word maps to the word that replaced it', () => {
  expect(currentTicketStatusFor('open')).toBe('pending');
  expect(currentTicketStatusFor('done')).toBe('reviewed');
});

test('each retired task word maps to the word that replaced it', () => {
  expect(currentTaskStatusFor('running')).toBe('in-progress');
  expect(currentTaskStatusFor('finished')).toBe('in-review');
});

// A current word must not be remapped, or a file already written in the new words would read as something else.
test('a current ticket status is not a retired word', () => {
  for (const currentWord of ['pending', 'in-progress', 'in-review', 'reviewed', 'delivered', 'abandoned']) {
    expect(currentTicketStatusFor(currentWord), currentWord).toBeNull();
  }
});

test('a current task status is not a retired word', () => {
  for (const currentWord of ['pending', 'in-progress', 'paused', 'in-review', 're-review', 'reviewed', 'delivered', 'abandoned']) {
    expect(currentTaskStatusFor(currentWord), currentWord).toBeNull();
  }
});

test('an old task word is not a retired ticket word', () => {
  expect(currentTicketStatusFor('running')).toBeNull();
  expect(currentTicketStatusFor('finished')).toBeNull();
});

test('an old ticket word is not a retired task word', () => {
  expect(currentTaskStatusFor('open')).toBeNull();
  expect(currentTaskStatusFor('done')).toBeNull();
});

// A stored file is text from outside: a name on the object prototype must not read as a mapping.
test('a name every object inherits maps to nothing', () => {
  for (const inheritedName of ['constructor', '__proto__', 'toString']) {
    expect(currentTicketStatusFor(inheritedName), inheritedName).toBeNull();
    expect(currentTaskStatusFor(inheritedName), inheritedName).toBeNull();
  }
});
