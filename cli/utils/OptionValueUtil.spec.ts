/**
 * The two option values every writing command reads: `--at`, which defaults to now and resolves a signed offset against the now handed in,
 * and `--tokens`, which is absent unless written and reads a `k` suffix. An unreadable value of either is refused with its exact words,
 * since a default in its place would store something nobody asked for.
 */
import { describe, expect, test } from 'bun:test';

import { refusalIsOperationRefusal, type OperationRefusal } from '../../src/shared/OperationRefusal';
import { createArgumentParser }                             from '../arguments/ArgumentParser';
import { OptionValueUtil }                                  from './OptionValueUtil';

const { resolveAtOption, tokenCountFrom } = OptionValueUtil;

// Built from local components, so its local clock reads 10:00 in any time zone the suite runs in.
const EXAMPLE_NOW = new Date(2026, 0, 1, 10, 0, 0);

const LOCAL_OFFSET_PATTERN = '[+-][0-9]{2}:[0-9]{2}';

function refusalFrom(action: () => unknown): OperationRefusal {
  try {
    action();
  } catch (error) {
    if (refusalIsOperationRefusal(error)) return error;
    throw error;
  }
  throw new Error('the call was expected to refuse and it returned instead');
}

describe('OptionValueUtil.resolveAtOption', () => {
  test('an absent --at is the now handed in, as a local ISO stamp', () => {
    expect(resolveAtOption(createArgumentParser([]), EXAMPLE_NOW)).toMatch(new RegExp(`^2026-01-01T10:00:00${LOCAL_OFFSET_PATTERN}$`));
  });

  test('a signed offset resolves against the now handed in', () => {
    expect(resolveAtOption(createArgumentParser(['--at', '-5m']), EXAMPLE_NOW)).toMatch(new RegExp(`^2026-01-01T09:55:00${LOCAL_OFFSET_PATTERN}$`));
  });

  test('an unreadable --at is refused with the forms it accepts', () => {
    const refusal = refusalFrom(() => resolveAtOption(createArgumentParser(['--at', 'nonsense']), EXAMPLE_NOW));

    expect(refusal.status).toBe('refused');
    expect(refusal.message).toBe(
      '--at "nonsense" is not a time. Write an ISO 8601 timestamp, `now`, or a signed offset from now such as `-5m`, `-2h`, `-1d` or `+30m`.',
    );
  });
});

describe('OptionValueUtil.tokenCountFrom', () => {
  test('an absent --tokens is undefined, not zero', () => {
    expect(tokenCountFrom(createArgumentParser([]))).toBeUndefined();
  });

  test('a decimal with a k suffix reads as whole tokens', () => {
    expect(tokenCountFrom(createArgumentParser(['--tokens', '12.3k']))).toBe(12300);
  });

  test('an unreadable --tokens is refused with the forms it accepts', () => {
    const refusal = refusalFrom(() => tokenCountFrom(createArgumentParser(['--tokens', 'nonsense'])));

    expect(refusal.status).toBe('refused');
    expect(refusal.message).toBe(
      '--tokens "nonsense" is not a token count. Write a whole number, or a decimal with a `k` or `m` suffix: `12000`, `12k`, `12.3k`, `1.2m`.',
    );
  });
});
