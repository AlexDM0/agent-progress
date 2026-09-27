/**
 * A commit printed in a sentence is shortened to its first characters, as git's own abbreviations are; a text already that short is kept
 * whole, since a caller may hand in a name as well as a hash.
 */
import { describe, expect, test } from 'bun:test';

import { SHORT_COMMIT_LENGTH_CHARACTERS } from '../constants/GitDefaults.ts';
import { OutputUtil }                     from './OutputUtil.ts';

describe('OutputUtil.shortCommitOf', () => {
  test('keeps the first characters of a full commit hash', () => {
    expect(OutputUtil.shortCommitOf('0123456789abcdef0123456789abcdef01234567')).toBe('01234567');
  });

  test('keeps exactly the short length', () => {
    expect(OutputUtil.shortCommitOf('fedcba9876543210')).toHaveLength(SHORT_COMMIT_LENGTH_CHARACTERS);
  });

  test('keeps a text no longer than the short length whole', () => {
    expect(OutputUtil.shortCommitOf('main')).toBe('main');
  });
});
