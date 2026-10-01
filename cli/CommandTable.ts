/**
 * The commands `agent-progress` accepts and the module each one lives in. The list is derived from the
 * dispatch itself, so `cli/HelpText.spec.ts` can hold the help against `COMMAND_NAMES`: adding a
 * command is one entry here and one block in `cli/HelpText.ts`.
 */
import type { CommandContext } from './CommandContext.ts';
import type { CommandLoader }  from './CommandHandler.ts';
import type { ArgumentParser } from './arguments/ArgumentParser.ts';

export const COMMAND_TABLE = {
  init:        async () => (await import('./adoption/init/InitCommand.ts')).initCommand,
  update:      async () => (await import('./adoption/update/UpdateCommand.ts')).updateCommand,
  status:      async () => (await import('./tracking/status/StatusCommand.ts')).statusCommand,
  task:        async () => (await import('./tracking/task/TaskCommand.ts')).taskCommand,
  log:         async () => (await import('./tracking/log/LogCommand.ts')).logCommand,
  hook:        async () => (await import('./measurement/hook/HookCommand.ts')).hookCommand,
  usage:       async () => (await import('./measurement/usage/UsageCommand.ts')).usageCommand,
  rework:      async () => (await import('./measurement/rework/ReworkCommand.ts')).reworkCommand,
  release:     async () => (await import('./dispatch/release/ReleaseCommand.ts')).releaseCommand,
  ticket:      async () => (await import('./tickets/TicketCommand.ts')).ticketCommand,
  epic:        async () => (await import('./epics/EpicCommand.ts')).epicCommand,
  concurrency: async () => (await import('./dispatch/concurrency/ConcurrencyCommand.ts')).concurrencyCommand,
  dispatcher:  async () => (await import('./dispatch/dispatcher/DispatcherCommand.ts')).dispatcherCommand,
  range:       async () => (await import('./tracking/range/RangeCommand.ts')).rangeCommand,
  render:      async () => (await import('./tracking/render/RenderCommand.ts')).renderCommand,
  open:        async () => (await import('./tracking/open/OpenCommand.ts')).openCommand,
  clear:       async () => (await import('./tracking/clear/ClearCommand.ts')).clearCommand,
  help:        async () => {
    const { helpText } = await import('./HelpText.ts');
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
