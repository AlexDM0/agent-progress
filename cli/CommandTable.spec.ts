/**
 * The top-level dispatch: every command in `cli/CommandTable.ts` reaches a handler, and a word that
 * is not a command — including a property an object literal inherits — is refused rather than run.
 */
import { describe, expect, test }       from 'bun:test';
import { createCapturedCommandContext } from '../lib/tooling/dev/CapturedCommandContext';
import { COMMAND_NAMES, COMMAND_TABLE } from './CommandTable';
import { runCommandLine }               from './Main';

const capturingContext = createCapturedCommandContext;

describe('the command table', () => {
  test('every command in the table resolves to a handler', async () => {
    for (const [name, loadCommand] of Object.entries(COMMAND_TABLE)) {
      expect(typeof (await loadCommand()), `\`agent-progress ${name}\` failed to load its handler`).toBe('function');
    }
    // The floor: a table that had lost its entries would satisfy the loop above by iterating nothing.
    expect(COMMAND_NAMES.length).toBeGreaterThanOrEqual(10);
  });

  test('every declared command is its own property, not one it inherited', () => {
    for (const name of COMMAND_NAMES) expect(Object.hasOwn(COMMAND_TABLE, name)).toBe(true);
  });

  test('the table holds exactly the commands the plan names', () => {
    expect([...COMMAND_NAMES].sort()).toEqual([
      'clear', 'help', 'init', 'log', 'open', 'range', 'render', 'status', 'task', 'ticket',
    ]);
  });
});

describe('a word that is not a command', () => {
  // `constructor` and `toString` are the dangerous pair: a literal inherits both and both are callable, so an unguarded lookup succeeds.
  const INHERITED_PROPERTY_NAMES = [
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    '__proto__',
    'propertyIsEnumerable',
    'toLocaleString',
  ];

  test('is refused the same way whether it is a plain word or an inherited property', async () => {
    for (const name of ['nosuchcommand', ...INHERITED_PROPERTY_NAMES]) {
      const context = capturingContext();
      const exitCode = await runCommandLine([name], context);
      expect(exitCode, `\`agent-progress ${name}\` must be refused, not run`).toBe(1);
      expect(context.errorText(), `\`agent-progress ${name}\` must say it is unknown`).toContain(`Unknown command: "${name}".`);
      expect(context.errorText(), `\`agent-progress ${name}\` must not crash`).not.toContain('TypeError');
      expect(context.errorText(), `\`agent-progress ${name}\` must still print the help`).toContain('agent-progress <command>');
      expect(context.outputText(), `\`agent-progress ${name}\` must print nothing on stdout`).toBe('');
    }
  });

  test('no inherited property is also a real command, so the cases above test what they claim', () => {
    // Guards the guard: a command named `toString` would make the loop above assert that a working command is refused.
    expect(COMMAND_NAMES.filter((name) => INHERITED_PROPERTY_NAMES.includes(name))).toEqual([]);
  });
});
