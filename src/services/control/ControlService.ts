/**
 * Applies one control command to the Board a `writeTracker` hold carries: the one path a CLI verb, a relayed request and an API command
 * share. It records only, never spawning, signalling or reconciling; a refusal leaves as an `OperationRefusal` with a wordless detail.
 */
import type { ControlCommand, ControlCommandKind, ControlCommandOf } from '../../shared/@types/ControlCommand.ts';
import type { TrackerChange }                                        from '../tracker/TrackerPipeline.ts';
import { FILING_CONTROLS }                                           from './FilingControls.ts';
import { RUNNER_CONTROLS }                                           from './RunnerControls.ts';
import { SETTING_CONTROLS }                                          from './SettingControls.ts';
import { TICKET_CONTROLS }                                           from './TicketControls.ts';

const CONTROL_APPLIERS = {
  ...TICKET_CONTROLS,
  ...FILING_CONTROLS,
  ...RUNNER_CONTROLS,
  ...SETTING_CONTROLS,
} as const satisfies { [Kind in ControlCommandKind]: (command: ControlCommandOf<Kind>, change: TrackerChange) => unknown };

type ControlAppliers = typeof CONTROL_APPLIERS;

export type ControlResultOf<Kind extends ControlCommandKind> = ReturnType<ControlAppliers[Kind]>;

export interface ControlApplied<Result> {
  /** `nothing-to-do` when the Board found the change already made, as an edit to the same text. */
  outcome: 'done' | 'nothing-to-do';
  result:  Result;
}

/** Every kind the service applies, in the order of the contract's groups. */
export const CONTROL_COMMAND_KINDS = Object.freeze(Object.keys(CONTROL_APPLIERS)) as readonly ControlCommandKind[];

function outcomeOf(result: unknown): ControlApplied<unknown>['outcome'] {
  const reportsNoChange = typeof result === 'object' && result !== null && 'changed' in result && result.changed === false;
  return reportsNoChange ? 'nothing-to-do' : 'done';
}

function apply<Command extends ControlCommand>(command: Command, change: TrackerChange): ControlApplied<ControlResultOf<Command['kind']>> {
  // The table pairs each kind with its applier, a correlation TypeScript cannot follow through an indexed union.
  const applier = CONTROL_APPLIERS[command.kind] as unknown as (command: Command, change: TrackerChange) => ControlResultOf<Command['kind']>;
  const result  = applier(command, change);
  return { outcome: outcomeOf(result), result };
}

export const ControlService = Object.freeze({ apply });
