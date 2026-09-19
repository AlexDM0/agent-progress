/**
 * Reading one command's arguments. A valueless option, an extra positional or an unknown option
 * throws `OperationRefusal` rather than exiting: `cli/Main.ts` alone turns a refusal into an exit code.
 */
import { OperationRefusal }         from '../../lib/platform/OperationRefusal';
import { OPTION_NAMES_WITH_VALUES } from './OptionsWithValues';

export interface ArgumentParser {
  flag(name: string): boolean;
  option(name: string): string | undefined;
  optionValues(name: string): string[];
  positionals(): string[];
  positional(): string | undefined;
  joinedPositionalsFrom(index: number): string | undefined;
  rejectExtraPositionals(consumedCount: number, usage: string): void;
  rejectUnknownOptions(knownOptionNames: readonly string[], usage: string): void;
  readonly rawArguments: readonly string[];
}

export function createArgumentParser(remainingArguments: readonly string[]): ArgumentParser {
  // One bare `--` settles the question for options, flags and positionals alike, which is how a ticket title may begin with a dash.
  const separatorIndex          = remainingArguments.indexOf('--');
  const optionScanEnd           = separatorIndex === -1 ? remainingArguments.length : separatorIndex;
  const argumentsBeforeSeparator = remainingArguments.slice(0, optionScanEnd);
  const argumentsAfterSeparator  = remainingArguments.slice(optionScanEnd + 1);

  /** An empty value is the same mistake as a missing one: `--project "$NAME"` with `NAME` unset is how it happens. */
  function refuseValuelessOption(name: string): never {
    throw new OperationRefusal('refused', `--${name} needs a value: --${name} <value> (or --${name}=<value>).`);
  }

  function flag(name: string): boolean {
    return argumentsBeforeSeparator.includes(`--${name}`);
  }

  /** Both `--owner x` and `--owner=x` are read, and every caller depends on that; a value that looks like a flag needs the `=` form. */
  function option(name: string): string | undefined {
    const optionToken = `--${name}`;
    for (let argumentIndex = 0; argumentIndex < argumentsBeforeSeparator.length; argumentIndex++) {
      const argument = argumentsBeforeSeparator[argumentIndex] ?? '';
      if (argument.startsWith(`${optionToken}=`)) {
        const inlineValue = argument.slice(optionToken.length + 1);
        if (inlineValue) return inlineValue;
        refuseValuelessOption(name);
      }
      if (argument !== optionToken) continue;
      const nextArgument = argumentsBeforeSeparator[argumentIndex + 1];
      if (nextArgument !== undefined && !nextArgument.startsWith('--') && nextArgument) return nextArgument;
      refuseValuelessOption(name);
    }
    return undefined;
  }

  /** Every occurrence of a repeated option, in order, where `option()` reads only the first. */
  function optionValues(name: string): string[] {
    const optionToken = `--${name}`;
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
      if (nextArgument === undefined || nextArgument.startsWith('--') || !nextArgument) refuseValuelessOption(name);
      values.push(nextArgument);
    }
    return values;
  }

  /** Only an option in `OPTION_NAMES_WITH_VALUES` consumes the argument behind it, so a bare `--start` cannot swallow a positional. */
  function positionals(): string[] {
    const values: string[] = [];
    let nextArgumentIsAnOptionValue = false;
    for (const argument of argumentsBeforeSeparator) {
      if (nextArgumentIsAnOptionValue) {
        nextArgumentIsAnOptionValue = false;
        continue;
      }
      if (argument.startsWith('--')) {
        const optionName = argument.slice(2).split('=')[0] ?? '';
        nextArgumentIsAnOptionValue = !argument.includes('=') && OPTION_NAMES_WITH_VALUES.has(optionName);
        continue;
      }
      values.push(argument);
    }
    values.push(...argumentsAfterSeparator);
    return values;
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
      .filter((argument) => argument.startsWith('--'))
      .map((argument) => argument.slice(2).split('=')[0] ?? '')
      .filter((name) => !known.has(name))
      .map((name) => `--${name}`);
    if (!unknown.length) return;
    throw new OperationRefusal('refused', `Unknown option(s): ${unknown.join(', ')}.\n  Usage: ${usage}`);
  }

  return {
    flag,
    option,
    optionValues,
    positionals,
    positional,
    joinedPositionalsFrom,
    rejectExtraPositionals,
    rejectUnknownOptions,
    rawArguments: remainingArguments,
  };
}
