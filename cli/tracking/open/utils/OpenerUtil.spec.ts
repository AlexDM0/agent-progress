/**
 * The launcher `open` hands the page to is chosen from the context's platform, never the test runner's, so both branches are pinned on any
 * machine: macOS has `open`, and every other platform is sent to `xdg-open`.
 */
import { describe, expect, test } from 'bun:test';

import { OpenerUtil } from './OpenerUtil.ts';

describe('OpenerUtil.openerFor', () => {
  test('macOS opens the page with `open`', () => {
    expect(OpenerUtil.openerFor('darwin')).toBe('open');
  });

  test('every other platform opens the page with `xdg-open`', () => {
    expect(OpenerUtil.openerFor('linux')).toBe('xdg-open');
    expect(OpenerUtil.openerFor('freebsd')).toBe('xdg-open');
  });
});
