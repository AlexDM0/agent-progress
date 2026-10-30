/**
 * `POST /api/commands` behind the token: a `ControlCommand` applied in a hold of its own, answered 200 `{outcome, result}`, 409 with the
 * worded refusal, 400 for a malformed body, or 423 while launches are held for an install change. `overseer-stop` and `overseer-restart` are
 * runtime only and go to the Overseer itself, held or not.
 */
import { OperationRefusalWordingUtil }           from '../../../src/adapters/utils/OperationRefusalWordingUtil.ts';
import { CONTROL_COMMAND_KINDS, ControlService } from '../../../src/services/control/ControlService.ts';
import type { RouteAnswer }                      from '../../../src/services/overseer/OverseerServer.ts';
import type { ControlCommand }                   from '../../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }                      from '../../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                         from '../../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                   from '../../CommandContext.ts';
import { openTrackerForWriting }                 from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }                   from '../../arguments/ArgumentParser.ts';

export interface RuntimeOverseerCommand {
  kind: 'overseer-stop' | 'overseer-restart';
  now:  boolean;
}

export interface CommandRouteRequest {
  commandArguments: ArgumentParser;
  context:          CommandContext;
  launchesHeld:     () => boolean;
  onRuntimeCommand: (command: RuntimeOverseerCommand) => void;
  /** After a command was applied, so the pass acts on it at once. */
  wake:             () => void;
}

const HTTP_STATUS = {
  OK:          200,
  BAD_REQUEST: 400,
  CONFLICT:    409,
  LOCKED:      423,
} as const;

const RUNTIME_COMMAND_KINDS: readonly string[] = ['overseer-stop', 'overseer-restart'];

const MALFORMED: RouteAnswer = { status: HTTP_STATUS.BAD_REQUEST, body: { refusal: 'malformed-body' } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function answerControlCommand(body: unknown, request: CommandRouteRequest): Promise<RouteAnswer> {
  if (!isRecord(body) || typeof body['kind'] !== 'string' || !(CONTROL_COMMAND_KINDS as readonly string[]).includes(body['kind'])) return MALFORMED;
  const { kind } = body;
  if (RUNTIME_COMMAND_KINDS.includes(kind)) {
    const { now } = body;
    if (now !== undefined && typeof now !== 'boolean') return MALFORMED;
    request.onRuntimeCommand({ kind: kind as RuntimeOverseerCommand['kind'], now: now === true });
    return { status: HTTP_STATUS.OK, body: { outcome: 'done', result: { kind } } };
  }
  if (request.launchesHeld()) {
    return { status: HTTP_STATUS.LOCKED, body: { refusal: `The install version changed: run \`${PRODUCT_NAMES.PROGRAM} update\`.` } };
  }
  try {
    const applied = await openTrackerForWriting(request.commandArguments, request.context, (change) => ControlService.apply(body as unknown as ControlCommand, change));
    request.wake();
    return { status: HTTP_STATUS.OK, body: applied };
  } catch (thrown) {
    if (thrown instanceof OperationRefusal) return { status: HTTP_STATUS.CONFLICT, body: { refusal: OperationRefusalWordingUtil.messageOf(thrown) } };
    // An applier reading a field the body lacks fails on its shape, before anything was written.
    if (thrown instanceof TypeError) return MALFORMED;
    throw thrown;
  }
}
