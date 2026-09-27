/**
 * The two option values every writing command reads: `--at`, which defaults to now and resolves a signed offset against the now handed in,
 * and `--tokens`, which is absent unless written and reads a `k` suffix. An unreadable value of either is refused with its exact words,
 * since a default in its place would store something nobody asked for.
 */
import { describe, expect, test } from 'bun:test';

import { createArgumentParser } from '../arguments/ArgumentParser.ts';
import { refusalFrom }          from '../testing/RefusalFrom.ts';
import { OptionValueUtil }      from './OptionValueUtil.ts';

const { atStampFrom, tokenCountFrom, taskIdOf } = OptionValueUtil;

// Built from local components, so its local clock reads 10:00 in any time zone the suite runs in.
const EXAMPLE_NOW = new Date(2026, 0, 1, 10, 0, 0);

const LOCAL_OFFSET_PATTERN = '[+-][0-9]{2}:[0-9]{2}';

describe('OptionValueUtil.atStampFrom', () => {
  test('an absent --at is the now handed in, as a local ISO stamp', () => {
    expect(atStampFrom(createArgumentParser([]), EXAMPLE_NOW)).toMatch(new RegExp(`^2026-01-01T10:00:00${LOCAL_OFFSET_PATTERN}$`));
  });

  test('a signed offset resolves against the now handed in', () => {
    expect(atStampFrom(createArgumentParser(['--at', '-5m']), EXAMPLE_NOW)).toMatch(new RegExp(`^2026-01-01T09:55:00${LOCAL_OFFSET_PATTERN}$`));
  });

  test('an unreadable --at is refused with the forms it accepts', () => {
    const refusal = refusalFrom(() => atStampFrom(createArgumentParser(['--at', 'nonsense']), EXAMPLE_NOW));

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

describe('OptionValueUtil.taskIdOf', () => {
  test('a positive whole number is the task id', () => {
    expect(taskIdOf('18')).toBe(18);
  });

  test('zero is no task id, since ids start at one', () => {
    expect(taskIdOf('0')).toBeNull();
  });

  test('a negative number is no task id', () => {
    expect(taskIdOf('-3')).toBeNull();
  });

  test('a fraction is no task id', () => {
    expect(taskIdOf('1.5')).toBeNull();
  });

  test('a number past the safe integers is no task id, since it could not be told from its neighbours', () => {
    expect(taskIdOf('9007199254740993')).toBeNull();
  });

  test('text that is not a number is no task id', () => {
    expect(taskIdOf('first')).toBeNull();
  });
});
