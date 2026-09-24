/**
 * The argument parser, against the shapes that fail quietly: `--option=value`, an option with no value,
 * a flag swallowing the positional behind it, and a bare `--`. Every refusal is an `OperationRefusal`, never a `process.exit`.
 */
import { describe, expect, test }                           from 'bun:test';
import { refusalIsOperationRefusal, type OperationRefusal } from '../../lib/platform/OperationRefusal';
import { createArgumentParser }                             from './ArgumentParser';

function refusalFrom(action: () => unknown): OperationRefusal {
  try {
    action();
  } catch (error) {
    if (refusalIsOperationRefusal(error)) return error;
    throw error;
  }
  throw new Error('the call was expected to refuse and it returned instead');
}

describe('an option and its value', () => {
  test('reads an option written as two arguments', () => {
    expect(createArgumentParser(['add', 'Review pass', '--owner', 'Alex Example']).option('owner')).toBe('Alex Example');
  });

  test('reads the same option written with an equals sign', () => {
    expect(createArgumentParser(['add', 'Review pass', '--owner=Alex Example']).option('owner')).toBe('Alex Example');
  });

  test('a value that looks like a path or a negative offset is still a value', () => {
    expect(createArgumentParser(['--at', '-5m']).option('at')).toBe('-5m');
  });

  test('an option nobody wrote is undefined rather than an empty string', () => {
    expect(createArgumentParser(['add', 'Review pass']).option('owner')).toBeUndefined();
  });

  // Keeping either value silently stores what the caller did not mean: `claim 1 --owner first --owner second` once stored "first".
  test('refuses a single-value option given twice, in either spelling', () => {
    const refusal = refusalFrom(() => createArgumentParser(['claim', '1', '--owner', 'first', '--owner=second']).option('owner'));
    expect(refusal.status).toBe('refused');
    expect(refusal.message).toContain('--owner was given 2 times');
  });

  test('reads every value of an option that may be repeated, in order', () => {
    expect(createArgumentParser(['--note', 'first', '--note=second']).optionValues('note')).toEqual(['first', 'second']);
  });
});

describe('an option with nothing behind it', () => {
  test('refuses an option written last on the line', () => {
    const refusal = refusalFrom(() => createArgumentParser(['add', '--owner']).option('owner'));
    expect(refusal.status).toBe('refused');
    expect(refusal.message).toContain('--owner needs a value');
  });

  test('refuses an option followed by another option instead of a value', () => {
    expect(refusalFrom(() => createArgumentParser(['--owner', '--note', 'x']).option('owner')).status).toBe('refused');
  });

  test('refuses an empty value, in either spelling', () => {
    expect(refusalFrom(() => createArgumentParser(['--project', '']).option('project')).status).toBe('refused');
    expect(refusalFrom(() => createArgumentParser(['--project=']).option('project')).status).toBe('refused');
  });

  test('refuses a repeated option that is missing one of its values', () => {
    expect(refusalFrom(() => createArgumentParser(['--note', 'first', '--note']).optionValues('note')).status).toBe('refused');
  });
});

describe('positional arguments', () => {
  test('an option that takes a value swallows exactly one argument and no more', () => {
    expect(createArgumentParser(['add', '--owner', 'Alex Example', 'Review pass']).positionals()).toEqual(['add', 'Review pass']);
  });

  test('a flag does not swallow the positional behind it', () => {
    expect(createArgumentParser(['add', '--start', 'Review pass']).positionals()).toEqual(['add', 'Review pass']);
  });

  test('an option written with an equals sign consumes nothing', () => {
    expect(createArgumentParser(['add', '--owner=Alex Example', 'Review pass']).positionals()).toEqual(['add', 'Review pass']);
  });

  test('the first positional is the one the command reads as its subcommand', () => {
    expect(createArgumentParser(['--json', 'list']).positional()).toBe('list');
  });

  test('rejoins free text the shell split into several arguments', () => {
    expect(createArgumentParser(['log', 'fixed', 'the', 'axis']).joinedPositionalsFrom(1)).toBe('fixed the axis');
  });

  test('joining from past the end is undefined, not an empty string a command would record', () => {
    expect(createArgumentParser(['log']).joinedPositionalsFrom(1)).toBeUndefined();
  });
});

describe('a bare double dash', () => {
  test('everything after it is a positional whatever it looks like', () => {
    expect(createArgumentParser(['add', '--', '--at is ignored']).positionals()).toEqual(['add', '--at is ignored']);
  });

  test('an option written after it is not read as an option', () => {
    expect(createArgumentParser(['add', '--', '--owner', 'Alex Example']).option('owner')).toBeUndefined();
  });

  test('a flag written after it is not read as a flag', () => {
    expect(createArgumentParser(['add', '--', '--start']).flag('start')).toBe(false);
  });

  test('a flag written before it still reads', () => {
    expect(createArgumentParser(['add', '--start', '--', 'Review pass']).flag('start')).toBe(true);
  });
});

describe('arguments the command has no place for', () => {
  test('refuses extra positionals and names them in the message', () => {
    const commandArguments = createArgumentParser(['add', 'Fix', 'the', 'axis']);
    const refusal = refusalFrom(() => commandArguments.rejectExtraPositionals(2, 'agent-progress ticket add "<title>"'));
    expect(refusal.status).toBe('refused');
    expect(refusal.message).toContain('"axis"');
    expect(refusal.message).toContain('agent-progress ticket add "<title>"');
  });

  test('accepts exactly the number of positionals the command consumed', () => {
    expect(() => createArgumentParser(['add', 'Fix the axis']).rejectExtraPositionals(2, 'usage')).not.toThrow();
  });

  test('refuses an option this command does not have', () => {
    const commandArguments = createArgumentParser(['--all', '--ye']);
    const refusal = refusalFrom(() => commandArguments.rejectUnknownOptions(['all', 'yes'], 'agent-progress clear [--all] [--yes]'));
    expect(refusal.status).toBe('refused');
    expect(refusal.message).toContain('--ye');
  });

  test('accepts the known options in both spellings', () => {
    const commandArguments = createArgumentParser(['--all', '--yes', '--project=Example Agency']);
    expect(() => commandArguments.rejectUnknownOptions(['all', 'yes', 'project'], 'usage')).not.toThrow();
  });
});

describe('the arguments as they were written', () => {
  test('hands the line back untouched, separator and all', () => {
    const line = ['add', '--owner', 'Alex Example', '--', '--not an option'];
    expect(createArgumentParser(line).rawArguments).toEqual(line);
  });
});
