import { readFileSync } from 'node:fs';
import { resolve }      from 'node:path';

import { OperationRefusal }    from '../src/shared/OperationRefusal.ts';
import type { CommandContext } from './CommandContext.ts';
import type { ArgumentParser } from './arguments/ArgumentParser.ts';

const STANDARD_INPUT_MARKER = '-';

/**
 * The text of `--body`, or of the file `--body-file` names (`-` for standard input), for a ticket or an epic; undefined when neither is
 * given. Read before the lock.
 */
export async function suppliedMarkdownBodyOf(commandArguments: ArgumentParser, context: CommandContext): Promise<string | undefined> {
  const written = commandArguments.option('body');
  if (written !== undefined) return written;

  const bodyFile = commandArguments.option('body-file');
  if (bodyFile === STANDARD_INPUT_MARKER) return context.readStandardInput();
  if (bodyFile === undefined) return undefined;
  try {
    return readFileSync(resolve(context.currentDirectory, bodyFile), 'utf8');
  } catch (problem) {
    throw new OperationRefusal('refused', `--body-file ${bodyFile} could not be read: ${problem instanceof Error ? problem.message : String(problem)}`);
  }
}
