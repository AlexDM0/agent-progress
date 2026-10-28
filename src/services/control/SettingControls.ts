/** The board settings kinds of the control contract; a check line's trial run is the caller's effect, before the command is built. */
import type { ControlCommandOf as CommandOf } from '../../shared/@types/ControlCommand.ts';
import { OperationRefusal }                   from '../../shared/OperationRefusal.ts';
import type { TrackerChange }                 from '../tracker/TrackerPipeline.ts';

function setCheckCommand(command: CommandOf<'checks-set'>, change: TrackerChange) {
  if (command.command === null && change.board.checkCommand() === undefined && !command.restamps) {
    throw new OperationRefusal('refused', { kind: 'no-check-command-to-clear' });
  }
  return change.board.setCheckCommand(command.command, command.restamps, change.at);
}

export const SETTING_CONTROLS = {
  'concurrency-set':             (command: CommandOf<'concurrency-set'>, change: TrackerChange) => change.board.setConcurrencyLimit(command.limit, change.at),
  'checks-set':                  setCheckCommand,
  'install-command-set':         (command: CommandOf<'install-command-set'>, change: TrackerChange) => change.board.setInstallCommand(command.command, change.at),
  'checks-definition-files-set': (command: CommandOf<'checks-definition-files-set'>, change: TrackerChange) => change.board.setChecksDefinitionFiles(command.patterns, change.at),
  'gate-key-command-set':        (command: CommandOf<'gate-key-command-set'>, change: TrackerChange) => change.board.setGateKeyCommand(command.command, change.at),
  'gate-cache-paths-set':        (command: CommandOf<'gate-cache-paths-set'>, change: TrackerChange) => change.board.setGateCachePaths(command.paths, change.at),
} as const;
