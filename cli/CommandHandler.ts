import type { CommandContext } from './CommandContext.ts';
import type { ArgumentParser } from './arguments/ArgumentParser.ts';

export type CommandHandler = (commandArguments: ArgumentParser, context: CommandContext) => Promise<void>;

/** Import the command's module and return its handler, running nothing: `help` or a mistyped word never loads the renderer. */
export type CommandLoader = () => Promise<CommandHandler>;
