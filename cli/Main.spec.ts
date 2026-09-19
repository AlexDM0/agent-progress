/**
 * What a command line does to the exit code: 0 for the reference, 1 for an unknown command or an actionable refusal, 2 for anything else.
 */
import {
  describe,
  expect,
  mock,
  test
}                                       from 'bun:test';
import { OperationRefusal }             from '../lib/platform/OperationRefusal';
import { createCapturedCommandContext } from '../lib/tooling/dev/CapturedCommandContext';
import { runCommandLine }               from './Main';

let errorThrownByTheStubbedCommand: unknown = null;

const capturingContext = createCapturedCommandContext;

describe('asking for the reference', () => {
  test('no command at all prints the help on standard output and exits 0', async () => {
    const context = capturingContext();
    expect(await runCommandLine([], context)).toBe(0);
    expect(context.outputText()).toContain('agent-progress — tasks, tickets and a Gantt dashboard');
    expect(context.errorText()).toBe('');
  });

  test('`help`, `--help` and `-h` are the same route as each other', async () => {
    for (const word of ['help', '--help', '-h']) {
      const context = capturingContext();
      expect(await runCommandLine([word], context), `\`agent-progress ${word}\` exits 0`).toBe(0);
      expect(context.outputText(), `\`agent-progress ${word}\` prints the reference`).toContain('Usage: agent-progress <command>');
      expect(context.errorText()).toBe('');
    }
  });

  test('--help after a command word prints the reference and exits 0, without reaching the command', async () => {
    for (const line of [['ticket', '--help'], ['task', 'add', '-h'], ['status', '--help']]) {
      const context = capturingContext();
      expect(await runCommandLine(line, context), line.join(' ')).toBe(0);
      expect(context.outputText(), line.join(' ')).toContain('Usage: agent-progress <command>');
      expect(context.errorText(), line.join(' ')).toBe('');
    }
  });

  test('a help alias after a bare -- is a positional, not a request for the reference', async () => {
    const context = capturingContext();
    await runCommandLine(['ticket', 'add', '--', '--help'], context);
    expect(context.outputText()).not.toContain('Usage: agent-progress <command>');
  });
});

describe('a command that does not exist', () => {
  test('names the word, prints the help on standard error, and exits 1', async () => {
    const context = capturingContext();
    expect(await runCommandLine(['taks', 'add', 'Review pass'], context)).toBe(1);
    expect(context.errorText()).toContain('Unknown command: "taks".');
    expect(context.errorText()).toContain('Usage: agent-progress <command>');
    expect(context.outputText()).toBe('');
  });
});

describe('a command that throws', () => {
  /** Stubbing `cli/render/RenderCommand.ts` reaches all three shapes with the real dispatch, catch and status-to-code mapping. */
  mock.module('./render/RenderCommand', () => ({ renderCommand: () => Promise.reject(errorThrownByTheStubbedCommand), }));

  test('an unrepaired refusal exits 2 with its own message and no stack trace', async () => {
    errorThrownByTheStubbedCommand = new OperationRefusal('unrepaired', 'Another agent-progress command is holding the lock');
    const context = capturingContext();
    expect(await runCommandLine(['render'], context)).toBe(2);
    expect(context.errorText()).toContain('is holding the lock');
    expect(context.errorText()).not.toContain('at <anonymous>');
    expect(context.outputText()).toBe('');
  });

  test('a refusal the caller can act on exits 1, with the refusal\'s own message', async () => {
    errorThrownByTheStubbedCommand = new OperationRefusal('refused', 'agent-progress init: this repository already has a tracker');
    const context = capturingContext();
    expect(await runCommandLine(['render'], context)).toBe(1);
    expect(context.errorText()).toContain('this repository already has a tracker');
  });

  test('an error that is not a refusal exits 2, because the tool cannot say the caller can fix it', async () => {
    errorThrownByTheStubbedCommand = new Error('EACCES: permission denied, open \'.agent-progress/progress.json\'');
    const context = capturingContext();
    expect(await runCommandLine(['render'], context)).toBe(2);
    expect(context.errorText()).toContain('EACCES: permission denied');
  });

  test('something thrown that is not an Error at all is still reported and still exits 2', async () => {
    errorThrownByTheStubbedCommand = 'a bare string, which a dependency is entitled to throw';
    const context = capturingContext();
    expect(await runCommandLine(['render'], context)).toBe(2);
    expect(context.errorText()).toContain('a bare string');
  });
});
