/**
 * The dispatch, and the only place an exit code is decided: 0 done or nothing to do, 1 a refusal the
 * caller can act on, 2 a state the tool will not repair. It returns the number rather than exiting.
 */
import { refusalIsOperationRefusal } from '../lib/platform/OperationRefusal';
import type { CommandContext }       from './CommandContext';
import { commandLoaderFor }          from './CommandTable';
import { helpText }                  from './HelpText';
import { createArgumentParser }      from './arguments/ArgumentParser';

const HELP_OPTION_NAME = 'help';
const HELP_SHORT_ALIAS = '-h';
const HELP_ALIASES     = new Set([`--${HELP_OPTION_NAME}`, HELP_SHORT_ALIAS]);

type HelpRequest = 'reference' | 'ambiguous' | 'none';

/**
 * `--help` anywhere before a bare `--`, and `-h` straight after the command word, ask for the reference; an option's value never does.
 * A `-h` further on may be free text, `log "remember" -h`, so it is refused rather than guessed: help there would do nothing at exit 0.
 */
function helpRequestOf(commandWord: string | undefined, remainingArguments: readonly string[]): HelpRequest {
  if (commandWord === undefined || HELP_ALIASES.has(commandWord)) return 'reference';
  const parser = createArgumentParser(remainingArguments);
  if (parser.flag(HELP_OPTION_NAME) || remainingArguments[0] === HELP_SHORT_ALIAS) return 'reference';
  return parser.positionalsBeforeSeparator().includes(HELP_SHORT_ALIAS) ? 'ambiguous' : 'none';
}

/** An unknown command prints the help on standard error and exits 1: a mistyped command that exits 0 reads as a step that ran. */
export async function runCommandLine(commandLineArguments: readonly string[], context: CommandContext): Promise<number> {
  const [commandWord, ...remainingArguments] = commandLineArguments;
  const helpRequest = helpRequestOf(commandWord, remainingArguments);
  if (helpRequest === 'ambiguous') {
    context.standardError(
      `"${HELP_SHORT_ALIAS}" after other arguments may be meant as text, so nothing was done.\n`
      + `  For the reference use --help; for "${HELP_SHORT_ALIAS}" as text put it behind a bare --.`,
    );
    return 1;
  }
  const printsTheHelp = helpRequest === 'reference';
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
