import type { CommandContext } from '../../CommandContext.ts';
import type { ArgumentParser } from '../../arguments/ArgumentParser.ts';

/** `subcommand` is the verb as typed, for a handler that serves several verbs and names the one it was run as. */
export type TicketSubcommandHandler = (commandArguments: ArgumentParser, context: CommandContext, subcommand: string) => Promise<void>;
