/**
 * Whether a Bash command line runs `agent-progress checks` with anything but `--json`: a command line, `--clear` or `--restamp`. The line is
 * split into words the way a shell quotes them and cut at every operator, so `cd <dir> && agent-progress checks --clear` is found too. Only a
 * shell wrapper's string (`bash -c`, `sh -c`, `zsh -c`, `eval`) is split again, recursively; any other quoted argument stays one word.
 */

const AGENT_PROGRESS_PROGRAM_NAMES = new Set(['agent-progress', 'agent-progress.ts']);

const CHECKS_COMMAND_WORD = 'checks';

const READING_ARGUMENTS = new Set(['--json']);

const SHELL_PROGRAM_NAMES = new Set(['bash', 'sh', 'zsh']);

const EVAL_PROGRAM_NAME = 'eval';

const COMMAND_STRING_OPTION_LETTER = 'c';

const SHORT_OPTION_CLUSTER_PATTERN = /^-[a-zA-Z]+$/;

const SHELL_OPTIONS_TAKING_A_VALUE = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);

const COMMAND_SEPARATOR_CHARACTERS = new Set([';', '&', '|', '(', ')', '\n', '`', '{', '}']);

const REDIRECTION_PATTERN = /^\d*[<>]/;

const BARE_REDIRECTION_PATTERN = /^\d*[<>]+$/;

/** Each inner list is one simple command's words, quotes removed. */
function simpleCommandsOf(commandLine: string): string[][] {
  const simpleCommands: string[][] = [[]];
  let word: string | null = null;
  let quote: '\'' | '"' | null = null;

  const endWord = (): void => {
    if (word !== null) simpleCommands[simpleCommands.length - 1]?.push(word);
    word = null;
  };

  for (let i = 0; i < commandLine.length; i++) {
    const character = commandLine.charAt(i);
    if (quote !== null) {
      if (character === quote) quote = null;
      else if (quote === '"' && character === '\\' && i + 1 < commandLine.length) word = `${word ?? ''}${commandLine.charAt(++i)}`;
      else word = `${word ?? ''}${character}`;
      continue;
    }
    if (character === '\'' || character === '"') {
      quote = character;
      word  = word ?? '';
    } else if (character === '\\' && i + 1 < commandLine.length) {
      word = `${word ?? ''}${commandLine.charAt(++i)}`;
    } else if (character === '$' && commandLine.charAt(i + 1) === '(') {
      endWord();
      simpleCommands.push([]);
      i++;
    } else if (COMMAND_SEPARATOR_CHARACTERS.has(character)) {
      endWord();
      simpleCommands.push([]);
    } else if (/\s/.test(character)) {
      endWord();
    } else {
      word = `${word ?? ''}${character}`;
    }
  }
  endWord();
  return simpleCommands;
}

function programNameOf(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1);
}

/** Redirections are the shell's, not the command's: `checks --json > out.json` still only reads. */
function argumentsWithoutRedirections(words: readonly string[]): string[] {
  const commandArguments: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? '';
    if (!REDIRECTION_PATTERN.test(word)) {
      commandArguments.push(word);
      continue;
    }
    if (BARE_REDIRECTION_PATTERN.test(word)) i++;
  }
  return commandArguments;
}

function optionClusterHoldsCommandStringFlag(word: string): boolean {
  return SHORT_OPTION_CLUSTER_PATTERN.test(word) && word.includes(COMMAND_STRING_OPTION_LETTER);
}

/**
 * `bash -c "<line>"` (any leading path, `-c` alone or in a cluster such as `-lc`) runs its first argument after the options, an option's
 * value (`-o pipefail`) skipped.
 */
function shellCommandStringsOf(words: readonly string[]): string[] {
  return words.flatMap((word, shellIndex) => {
    if (!SHELL_PROGRAM_NAMES.has(programNameOf(word))) return [];
    let runsACommandString = false;
    for (let i = shellIndex + 1; i < words.length; i++) {
      const option = words[i] ?? '';
      if (SHELL_OPTIONS_TAKING_A_VALUE.has(option)) i++;
      else if (option.startsWith('-') || option.startsWith('+')) runsACommandString ||= optionClusterHoldsCommandStringFlag(option);
      else return runsACommandString ? [option] : [];
    }
    return [];
  });
}

/** `eval` joins its arguments with spaces and runs the result. */
function evaluatedCommandStringsOf(words: readonly string[]): string[] {
  const evalIndex = words.indexOf(EVAL_PROGRAM_NAME);
  return evalIndex === -1 ? [] : [words.slice(evalIndex + 1).join(' ')];
}

function simpleCommandChangesTheCheckCommand(words: readonly string[]): boolean {
  const wrappedCommandStrings = [...shellCommandStringsOf(words), ...evaluatedCommandStringsOf(words)];
  if (wrappedCommandStrings.some(commandLineChangesTheCheckCommand)) return true;
  const programIndex = words.findIndex((word, index) => AGENT_PROGRESS_PROGRAM_NAMES.has(programNameOf(word)) && words[index + 1] === CHECKS_COMMAND_WORD);
  if (programIndex === -1) return false;
  return argumentsWithoutRedirections(words.slice(programIndex + 2)).some((argument) => !READING_ARGUMENTS.has(argument));
}

export function commandLineChangesTheCheckCommand(commandLine: string): boolean {
  return simpleCommandsOf(commandLine).some(simpleCommandChangesTheCheckCommand);
}
