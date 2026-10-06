/** The hook JSON the harness writes on standard input; anything unreadable is one sentence on standard error and no input. */
import { JsonRecordUtil }      from '../../../src/lib/json-record/JsonRecordUtil.ts';
import type { CommandContext } from '../../CommandContext.ts';

/** The prefix on every sentence the hook writes, so a line in a harness log says which command produced it. */
export const REPORT_PREFIX = 'agent-progress hook subagent-stop:';

/** Logged for an agent id or type the hook input does not carry. */
export const UNKNOWN_AGENT = 'unknown';

export function readStringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** `consequence` ends each sentence with what the hook did instead, so each hook says it in its own words. */
export async function readHookInput(context: CommandContext, reportPrefix: string, consequence: string): Promise<Record<string, unknown> | undefined> {
  let rawHookInput: string;
  try {
    rawHookInput = await context.readStandardInput();
  } catch {
    context.standardError(`${reportPrefix} standard input could not be read, so ${consequence}.`);
    return undefined;
  }

  if (rawHookInput.trim().length === 0) {
    context.standardError(`${reportPrefix} no hook input arrived on standard input, so ${consequence}.`);
    return undefined;
  }

  let parsedHookInput: unknown;
  try {
    parsedHookInput = JSON.parse(rawHookInput);
  } catch {
    context.standardError(`${reportPrefix} the hook input on standard input is not JSON, so ${consequence}.`);
    return undefined;
  }

  const hookInput = JsonRecordUtil.recordOf(parsedHookInput);
  if (hookInput === undefined) {
    context.standardError(`${reportPrefix} the hook input is not a JSON object, so ${consequence}.`);
    return undefined;
  }
  return hookInput;
}
