/**
 * Reading one command's arguments. A valueless option, an extra positional or an unknown option
 * throws `OperationRefusal` rather than exiting: `cli/Main.ts` alone turns a refusal into an exit code.
 */
import { OperationRefusal }         from '../../src/shared/OperationRefusal.ts';
import { OPTION_NAMES_WITH_VALUES } from './constants/OptionNamesWithValues.ts';

export interface ArgumentParser {
  flag(name: string): boolean;
  option(name: string): string | undefined;
  positionalsBeforeSeparator(): string[];
  positionals(): string[];
  positional(): string | undefined;
  joinedPositionalsFrom(index: number): string | undefined;
  rejectExtraPositionals(consumedCount: number, usage: string): void;
  rejectUnknownOptions(knownOptionNames: readonly string[], usage: string): void;
}

const OPTION_PREFIX = '--';

const ARGUMENT_SEPARATOR = '--';

function optionTokenOf(name: string): string {
  return `${OPTION_PREFIX}${name}`;
}

function optionNameOf(argument: string): string {
  return argument.slice(OPTION_PREFIX.length).split('=')[0] ?? '';
}

export function createArgumentParser(remainingArguments: readonly string[]): ArgumentParser {
  // One bare `--` settles the question for options, flags and positionals alike, which is how a ticket title may begin with a dash.
  const separatorIndex          = remainingArguments.indexOf(ARGUMENT_SEPARATOR);
  const optionScanEnd           = separatorIndex === -1 ? remainingArguments.length : separatorIndex;
  const argumentsBeforeSeparator = remainingArguments.slice(0, optionScanEnd);
  const argumentsAfterSeparator  = remainingArguments.slice(optionScanEnd + 1);

  /** An empty value is the same mistake as a missing one: `--project "$NAME"` with `NAME` unset is how it happens. */
  function refuseValuelessOption(name: string): never {
    const optionToken = optionTokenOf(name);
    throw new OperationRefusal('refused', `${optionToken} needs a value: ${optionToken} <value> (or ${optionToken}=<value>).`);
  }

  function flag(name: string): boolean {
    return argumentsBeforeSeparator.includes(optionTokenOf(name));
  }

  /**
   * Both `--owner x` and `--owner=x` are read, and every caller depends on that; a value that looks like a flag needs the `=` form.
   * Given twice it is refused, since keeping either value silently stores what the caller did not mean.
   */
  function option(name: string): string | undefined {
    const values = optionValues(name);
    if (values.length > 1) throw new OperationRefusal('refused', `${optionTokenOf(name)} was given ${values.length} times; it takes one value.`);
    return values[0];
  }

  function optionValues(name: string): string[] {
    const optionToken = optionTokenOf(name);
    const values: string[] = [];
    for (let argumentIndex = 0; argumentIndex < argumentsBeforeSeparator.length; argumentIndex++) {
      const argument = argumentsBeforeSeparator[argumentIndex] ?? '';
      if (argument.startsWith(`${optionToken}=`)) {
        const inlineValue = argument.slice(optionToken.length + 1);
        if (!inlineValue) refuseValuelessOption(name);
        values.push(inlineValue);
        continue;
      }
      if (argument !== optionToken) continue;
      const nextArgument = argumentsBeforeSeparator[argumentIndex + 1];
      if (nextArgument === undefined || nextArgument.startsWith(OPTION_PREFIX) || !nextArgument) refuseValuelessOption(name);
      values.push(nextArgument);
    }
    return values;
  }

  /** Only an option in `OPTION_NAMES_WITH_VALUES` consumes the argument behind it, so a bare `--start` cannot swallow a positional. */
  function positionalsBeforeSeparator(): string[] {
    const values: string[] = [];
    let nextArgumentIsAnOptionValue = false;
    for (const argument of argumentsBeforeSeparator) {
      if (nextArgumentIsAnOptionValue) {
        nextArgumentIsAnOptionValue = false;
        continue;
      }
      if (argument.startsWith(OPTION_PREFIX)) {
        nextArgumentIsAnOptionValue = !argument.includes('=') && OPTION_NAMES_WITH_VALUES.has(optionNameOf(argument));
        continue;
      }
      values.push(argument);
    }
    return values;
  }

  function positionals(): string[] {
    return [...positionalsBeforeSeparator(), ...argumentsAfterSeparator];
  }

  function positional(): string | undefined {
    return positionals()[0];
  }

  function joinedPositionalsFrom(index: number): string | undefined {
    const terms = positionals().slice(index);
    return terms.length ? terms.join(' ') : undefined;
  }

  function rejectExtraPositionals(consumedCount: number, usage: string): void {
    const extra = positionals().slice(consumedCount);
    if (!extra.length) return;
    throw new OperationRefusal(
      'refused',
      `Unexpected extra argument(s): ${extra.map((argument) => `"${argument}"`).join(', ')}.\n`
      + '  An argument containing spaces has to be quoted.\n'
      + `  Usage: ${usage}`,
    );
  }

  /** A misspelled switch otherwise vanishes silently, and `agent-progress clear --all --ye` would delete every ticket unasked. */
  function rejectUnknownOptions(knownOptionNames: readonly string[], usage: string): void {
    const known = new Set(knownOptionNames);
    const unknown = argumentsBeforeSeparator
      .filter((argument) => argument.startsWith(OPTION_PREFIX))
      .map((argument) => optionNameOf(argument))
      .filter((name) => !known.has(name))
      .map((name) => optionTokenOf(name));
    if (!unknown.length) return;
    throw new OperationRefusal('refused', `Unknown option(s): ${unknown.join(', ')}.\n  Usage: ${usage}`);
  }

  return {
    flag,
    option,
    positionalsBeforeSeparator,
    positionals,
    positional,
    joinedPositionalsFrom,
    rejectExtraPositionals,
    rejectUnknownOptions,
  };
}
