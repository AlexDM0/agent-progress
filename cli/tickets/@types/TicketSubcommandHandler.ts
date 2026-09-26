import type { CommandContext } from '../../CommandContext';
import type { ArgumentParser } from '../../arguments/ArgumentParser';

/** `subcommand` is the verb as typed, for a handler that serves several verbs and names the one it was run as. */
export type TicketSubcommandHandler = (commandArguments: ArgumentParser, context: CommandContext, subcommand: string) => Promise<void>;
