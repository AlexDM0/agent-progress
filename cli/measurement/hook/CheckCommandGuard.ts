/**
 * The `PreToolUse` hook: only the orchestrator's own session changes the tracker's check command, so a subagent's Bash call that would set,
 * clear or restamp it is blocked. Claude Code sets `agent_id` only on a subagent's tool call, and blocks the call on exit 2 with the reason
 * on standard error; every other call passes at exit 0, an unreadable input included, since a hook that blocked every call would stall
 * every agent.
 */
import { JsonRecordUtil }                    from '../../../src/lib/json-record/JsonRecordUtil.ts';
import { OperationRefusal }                  from '../../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                     from '../../../src/shared/constants/ProductNames.ts';
import type { CommandContext }               from '../../CommandContext.ts';
import { commandLineChangesTheCheckCommand } from './CheckCommandChangeDetection.ts';
import { readHookInput, readStringField }    from './HookInput.ts';

const REPORT_PREFIX = `${PRODUCT_NAMES.PROGRAM} hook pre-tool-use:`;

const GUARDED_TOOL_NAME = 'Bash';

const BLOCKED_CALL_TEXT =
  `Only the orchestrator's own session changes the tracker's check command, so this call was blocked. Read it with \`${PRODUCT_NAMES.PROGRAM} checks --json\`; `
  + 'if the stored command is wrong, say so in your report and leave the change to the orchestrator.';

export async function guardTheCheckCommand(context: CommandContext): Promise<void> {
  const hookInput = await readHookInput(context, REPORT_PREFIX, 'the call was let through');
  if (hookInput === undefined) return;
  if (readStringField(hookInput, 'agent_id') === undefined) return;
  if (readStringField(hookInput, 'tool_name') !== GUARDED_TOOL_NAME) return;

  const commandLine = readStringField(JsonRecordUtil.recordOf(hookInput['tool_input']) ?? {}, 'command');
  if (commandLine === undefined || !commandLineChangesTheCheckCommand(commandLine)) return;
  // `unrepaired` is exit 2, the one exit code Claude Code reads as a block.
  throw new OperationRefusal('unrepaired', BLOCKED_CALL_TEXT);
}
