/**
 * The commands `agent-progress` accepts and the module each one lives in. The list is derived from the
 * dispatch itself, so `cli/HelpText.spec.ts` can hold the help against `COMMAND_NAMES`: adding a
 * command is one entry here and one block in `cli/HelpText.ts`.
 */
import type { CommandContext } from './CommandContext.ts';
import type { CommandLoader }  from './CommandHandler.ts';
import type { ArgumentParser } from './arguments/ArgumentParser.ts';

export const COMMAND_TABLE = {
  init:           async () => (await import('./adoption/init/InitCommand.ts')).initCommand,
  update:         async () => (await import('./adoption/update/UpdateCommand.ts')).updateCommand,
  status:         async () => (await import('./tracking/status/StatusCommand.ts')).statusCommand,
  task:           async () => (await import('./tracking/task/TaskCommand.ts')).taskCommand,
  log:            async () => (await import('./tracking/log/LogCommand.ts')).logCommand,
  hook:           async () => (await import('./hooks/HookCommand.ts')).hookCommand,
  usage:          async () => (await import('./measurement/usage/UsageCommand.ts')).usageCommand,
  'review-stats': async () => (await import('./measurement/review-stats/ReviewStatsCommand.ts')).reviewStatsCommand,
  ticket:         async () => (await import('./tickets/TicketCommand.ts')).ticketCommand,
  epic:           async () => (await import('./epics/EpicCommand.ts')).epicCommand,
  draft:          async () => (await import('./drafts/DraftCommand.ts')).draftCommand,
  concurrency:    async () => (await import('./dispatch/concurrency/ConcurrencyCommand.ts')).concurrencyCommand,
  merges:         async () => (await import('./merges/MergesCommand.ts')).mergesCommand,
  merge:          async () => (await import('./merges/MergeCommand.ts')).mergeCommand,
  worktree:       async () => (await import('./worktrees/WorktreeCommand.ts')).worktreeCommand,
  gate:           async () => (await import('./gates/GateCommand.ts')).gateCommand,
  decisions:      async () => (await import('./decisions/DecisionsCommand.ts')).decisionsCommand,
  decide:         async () => (await import('./decisions/DecideCommand.ts')).decideCommand,
  incidents:      async () => (await import('./incidents/IncidentsCommand.ts')).incidentsCommand,
  incident:       async () => (await import('./incidents/IncidentCommand.ts')).incidentCommand,
  jobs:           async () => (await import('./jobs/JobsCommand.ts')).jobsCommand,
  job:            async () => (await import('./jobs/JobCommand.ts')).jobCommand,
  intake:         async () => (await import('./intake/IntakeCommand.ts')).intakeCommand,
  advise:         async () => (await import('./onboarding/AdviseCommand.ts')).adviseCommand,
  await:          async () => (await import('./tracking/await/AwaitCommand.ts')).awaitCommand,
  range:          async () => (await import('./tracking/range/RangeCommand.ts')).rangeCommand,
  open:           async () => (await import('./tracking/open/OpenCommand.ts')).openCommand,
  clear:          async () => (await import('./tracking/clear/ClearCommand.ts')).clearCommand,
  run:            async () => (await import('./runner/RunCommand.ts')).runCommand,
  version:        async () => (await import('./runner/VersionCommand.ts')).versionCommand,
  help:           async () => {
    const { helpText } = await import('./HelpText.ts');
    return (_commandArguments: ArgumentParser, context: CommandContext) => {
      context.standardOutput(helpText());
      return Promise.resolve();
    };
  },
} as const satisfies Record<string, CommandLoader>;

export const COMMAND_NAMES = Object.keys(COMMAND_TABLE) as readonly (keyof typeof COMMAND_TABLE)[];

/** `Object.hasOwn`, never a bare lookup: the literal inherits `Object.prototype`, so `agent-progress constructor` would otherwise run and exit 0. */
export function commandLoaderFor(command: string): CommandLoader | undefined {
  if (!Object.hasOwn(COMMAND_TABLE, command)) return undefined;
  return COMMAND_TABLE[command as keyof typeof COMMAND_TABLE];
}
