/** The hook JSON the harness writes on standard input; anything unreadable is one sentence on standard error and no input. */
import { JsonRecordUtil }      from '../../../src/lib/utils/JsonRecordUtil.ts';
import type { CommandContext } from '../../CommandContext.ts';

/** The prefix on every sentence the hook writes, so a line in a harness log says which command produced it. */
export const REPORT_PREFIX = 'agent-progress hook subagent-stop:';

export function readStringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function readHookInput(context: CommandContext): Promise<Record<string, unknown> | undefined> {
  let rawHookInput: string;
  try {
    rawHookInput = await context.readStandardInput();
  } catch {
    context.standardError(`${REPORT_PREFIX} standard input could not be read, so nothing was recorded.`);
    return undefined;
  }

  if (rawHookInput.trim().length === 0) {
    context.standardError(`${REPORT_PREFIX} no hook input arrived on standard input, so nothing was recorded.`);
    return undefined;
  }

  let parsedHookInput: unknown;
  try {
    parsedHookInput = JSON.parse(rawHookInput);
  } catch {
    context.standardError(`${REPORT_PREFIX} the hook input on standard input is not JSON, so nothing was recorded.`);
    return undefined;
  }

  const hookInput = JsonRecordUtil.recordOf(parsedHookInput);
  if (hookInput === undefined) {
    context.standardError(`${REPORT_PREFIX} the hook input is not a JSON object, so nothing was recorded.`);
    return undefined;
  }
  return hookInput;
}
