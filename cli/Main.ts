/**
 * The dispatch, and the only place an exit code is decided: 0 done or nothing to do, 1 a refusal the
 * caller can act on, 2 a state the tool will not repair. It returns the number rather than exiting.
 */
import { refusalIsOperationRefusal } from '../lib/platform/OperationRefusal';
import type { CommandContext }       from './CommandContext';
import { commandLoaderFor }          from './CommandTable';
import { helpText }                  from './HelpText';
import { createArgumentParser }      from './arguments/ArgumentParser';

const HELP_ALIASES        = new Set(['--help', '-h']);
const POSITIONAL_SEPARATOR = '--';

function asksForTheHelp(commandWord: string | undefined, remainingArguments: readonly string[]): boolean {
  if (commandWord === undefined || HELP_ALIASES.has(commandWord)) return true;
  const separatorIndex  = remainingArguments.indexOf(POSITIONAL_SEPARATOR);
  const beforeSeparator = separatorIndex === -1 ? remainingArguments : remainingArguments.slice(0, separatorIndex);
  return beforeSeparator.some((argument) => HELP_ALIASES.has(argument));
}

/** An unknown command prints the help on standard error and exits 1: a mistyped command that exits 0 reads as a step that ran. */
export async function runCommandLine(commandLineArguments: readonly string[], context: CommandContext): Promise<number> {
  const [commandWord, ...remainingArguments] = commandLineArguments;
  const printsTheHelp = asksForTheHelp(commandWord, remainingArguments);
  const command       = commandWord === undefined || printsTheHelp ? 'help' : commandWord;

  const loadCommand = commandLoaderFor(command);
  if (!loadCommand) {
    context.standardError(`Unknown command: "${command}".\n`);
    context.standardError(helpText());
    return 1;
  }

  try {
    const runCommand = await loadCommand();
    await runCommand(createArgumentParser(printsTheHelp ? [] : remainingArguments), context);
    return 0;
  } catch (error) {
    if (refusalIsOperationRefusal(error)) {
      context.standardError(error.message);
      return error.status === 'refused' ? 1 : 2;
    }
    context.standardError(error instanceof Error ? error.message : String(error));
    return 2;
  }
}
