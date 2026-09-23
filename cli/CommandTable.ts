/**
 * The commands `agent-progress` accepts and the module each one lives in. The list is derived from the
 * dispatch itself, so `cli/HelpText.spec.ts` can hold the help against `COMMAND_NAMES`: adding a
 * command is one entry here and one block in `cli/HelpText.ts`.
 */
import type { CommandContext } from './CommandContext';
import type { ArgumentParser } from './arguments/ArgumentParser';

export type CommandHandler = (commandArguments: ArgumentParser, context: CommandContext) => Promise<void>;

/** Import the command's module and return its handler, running nothing: `help` or a mistyped word never loads the renderer. */
export type CommandLoader = () => Promise<CommandHandler>;

export const COMMAND_TABLE = {
  init:        async () => (await import('./init/InitCommand')).initCommand,
  update:      async () => (await import('./update/UpdateCommand')).updateCommand,
  status:      async () => (await import('./status/StatusCommand')).statusCommand,
  task:        async () => (await import('./task/TaskCommand')).taskCommand,
  log:         async () => (await import('./log/LogCommand')).logCommand,
  hook:        async () => (await import('./hook/HookCommand')).hookCommand,
  usage:       async () => (await import('./usage/UsageCommand')).usageCommand,
  rework:      async () => (await import('./rework/ReworkCommand')).reworkCommand,
  ticket:      async () => (await import('./ticket/TicketCommand')).ticketCommand,
  concurrency: async () => (await import('./concurrency/ConcurrencyCommand')).concurrencyCommand,
  range:       async () => (await import('./range/RangeCommand')).rangeCommand,
  render:      async () => (await import('./render/RenderCommand')).renderCommand,
  open:        async () => (await import('./open/OpenCommand')).openCommand,
  clear:       async () => (await import('./clear/ClearCommand')).clearCommand,
  help:        async () => {
    const { helpText } = await import('./HelpText');
    return (_commandArguments: ArgumentParser, context: CommandContext) => {
      context.standardOutput(helpText());
      return Promise.resolve();
    };
  },
} as const satisfies Record<string, CommandLoader>;

export const COMMAND_NAMES = Object.keys(COMMAND_TABLE) as readonly (keyof typeof COMMAND_TABLE)[];

/** `Object.hasOwn`, never a bare lookup: the literal inherits `Object.prototype`, so `agent-progress constructor` would otherwise run and exit 0. */
export function commandLoaderFor(command: string): CommandLoader | undefined {
  if (!Object.hasOwn(COMMAND_TABLE, command)) return undefined;
  return COMMAND_TABLE[command as keyof typeof COMMAND_TABLE];
}
