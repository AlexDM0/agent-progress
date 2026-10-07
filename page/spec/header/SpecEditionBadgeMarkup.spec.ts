/**
 * The spec page's edition badge. The cases that matter: both versions with the constitution's prefixed by `v`, an unknown part left out,
 * null when both are unknown so the page hides the badge, and each version escaped once.
 */

import { describe, expect, test } from 'bun:test';
import { specEditionBadgeMarkup } from './SpecEditionBadgeMarkup.ts';

describe('specEditionBadgeMarkup', () => {
  test('names both versions, the constitution\'s with a v', () => {
    expect(specEditionBadgeMarkup('1.1.0', '1.2.0')).toBe('spec-kit <b>1.1.0</b> · constitution <b>v1.2.0</b>');
  });

  test('leaves out an unknown part, and is null when both are unknown', () => {
    expect(specEditionBadgeMarkup(null, '1.2.0')).toBe('constitution <b>v1.2.0</b>');
    expect(specEditionBadgeMarkup('1.1.0', null)).toBe('spec-kit <b>1.1.0</b>');
    expect(specEditionBadgeMarkup(null, null)).toBeNull();
  });

  test('escapes each version once', () => {
    expect(specEditionBadgeMarkup('<1>', null)).toBe('spec-kit <b>&lt;1&gt;</b>');
  });
});
