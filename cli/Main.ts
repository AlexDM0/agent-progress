/**
 * The dispatch, and the only place an exit code is decided: 0 done or nothing to do, 1 a refusal the
 * caller can act on, 2 a state the tool will not repair. It returns the number rather than exiting.
 */
import { OperationRefusalWordingUtil }                               from '../src/adapters/utils/OperationRefusalWordingUtil.ts';
import { OperationRefusal, refusalIsOperationRefusal }               from '../src/shared/OperationRefusal.ts';
import type { CommandContext }                                       from './CommandContext.ts';
import { commandLoaderFor }                                          from './CommandTable.ts';
import { helpText }                                                  from './HelpText.ts';
import { requireCurrentInstall }                                     from './InstallVersionCheck.ts';
import { refusalIsRelayConcluded }                                   from './RelayUnderJob.ts';
import { createArgumentParser }                                      from './arguments/ArgumentParser.ts';
import { READ_ONLY_VERBS_UNDER_A_JOB, RELAYED_VERB_OF_CONTROL_KIND } from './constants/JobVerbs.ts';

const HELP_OPTION_NAME = 'help';
const HELP_SHORT_ALIAS = '-h';
const HELP_ALIASES     = new Set([`--${HELP_OPTION_NAME}`, HELP_SHORT_ALIAS]);

/** `init` and `update` repair a mismatch, `status` output is a contract that stays silent about one, and `version` reports the versions itself. */
const COMMANDS_THE_INSTALL_CHECK_SPARES = new Set(['init', 'update', 'help', 'status', 'version']);
/**
 * A hook prints or guards whatever the install, and `run status` and `run stop` must reach a runner whose install changed, so each runs the
 * check inside its own handling.
 */
const COMMANDS_THAT_CHECK_THEIR_OWN_INSTALL = new Set(['hook', 'run']);

/** The commands whose first argument names a subcommand, which the recorded verb then carries: `ticket finish`, not `ticket`. */
const COMMANDS_WITH_A_SUBCOMMAND = new Set(['task', 'ticket', 'epic', 'draft', 'hook', 'run', 'job', 'intake', 'incident', 'merge', 'worktree', 'gate']);

type HelpRequest = 'reference' | 'ambiguous' | 'none';

/** How a verb runs: `direct` outside a job or when read-only, `relayed` when it builds a control command, `refused` otherwise. */
type JobRoute = 'direct' | 'relayed' | 'refused';

const RELAYED_VERBS_UNDER_A_JOB = new Set(Object.values(RELAYED_VERB_OF_CONTROL_KIND));

function jobRouteOf(context: CommandContext, commandVerb: string): JobRoute {
  if (context.job === undefined || READ_ONLY_VERBS_UNDER_A_JOB.includes(commandVerb)) return 'direct';
  return RELAYED_VERBS_UNDER_A_JOB.has(commandVerb) ? 'relayed' : 'refused';
}

function commandVerbOf(command: string, remainingArguments: readonly string[]): string {
  const subcommand = remainingArguments[0];
  if (!COMMANDS_WITH_A_SUBCOMMAND.has(command) || subcommand === undefined || subcommand.startsWith('-')) return command;
  return `${command} ${subcommand}`;
}

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

  const commandVerb = commandVerbOf(command, remainingArguments);
  const jobRoute    = jobRouteOf(context, printsTheHelp ? 'help' : commandVerb);
  try {
    if (jobRoute === 'refused' && context.job !== undefined) {
      throw new OperationRefusal('refused', { kind: 'verb-not-relayable', verb: commandVerb, jobId: context.job.jobId });
    }
    const runCommand = await loadCommand();
    // A relayed verb writes nothing of this install's: the runner applies it, so it relays before any install check.
    if (jobRoute !== 'relayed' && !COMMANDS_THE_INSTALL_CHECK_SPARES.has(command) && !COMMANDS_THAT_CHECK_THEIR_OWN_INSTALL.has(command)) {
      requireCurrentInstall(context.currentDirectory);
    }
    await runCommand(createArgumentParser(printsTheHelp ? [] : remainingArguments), { ...context, commandVerb });
    return 0;
  } catch (error) {
    if (refusalIsRelayConcluded(error)) return error.exitCode;
    if (refusalIsOperationRefusal(error)) {
      context.standardError(OperationRefusalWordingUtil.messageOf(error));
      return error.status === 'refused' ? 1 : 2;
    }
    context.standardError(error instanceof Error ? error.message : String(error));
    return 2;
  }
}
