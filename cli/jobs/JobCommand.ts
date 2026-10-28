/**
 * `job` and its subcommands: `show` and `attach` read without the lock; `message`, `wind-down`, `stop` and `fresh` each record one control
 * command in a hold, with the runner up or down, and the runner sends the frames.
 */
import type { EventLogEntry }                  from '../../src/lib/agent-host/EventLog.ts';
import type { AgentAdapter }                   from '../../src/lib/agent-launch/AgentAdapter.ts';
import type { AgentSessionEvent }              from '../../src/lib/agent-launch/AgentSessionEvent.ts';
import type { Job }                            from '../../src/lib/tracker-model/@types/Job.ts';
import type { LogRecord }                      from '../../src/lib/tracker-model/@types/LogRecord.ts';
import { ControlService }                      from '../../src/services/control/ControlService.ts';
import { HostFleet }                           from '../../src/services/runner/HostFleet.ts';
import { requireProgressFile, requireTracker } from '../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace, type Workspace }    from '../../src/services/tracker/Workspace.ts';
import type { ControlCommand }                 from '../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }                    from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                       from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                 from '../CommandContext.ts';
import type { CommandHandler }                 from '../CommandHandler.ts';
import { openTrackerForWriting }               from '../OpenTrackerForWriting.ts';
import { relayWhenUnderJob }                   from '../RelayUnderJob.ts';
import type { ArgumentParser }                 from '../arguments/ArgumentParser.ts';
import { OutputUtil }                          from '../utils/OutputUtil.ts';

const { PROGRAM } = PRODUCT_NAMES;

const SHOW_USAGE    = `${PROGRAM} job show|attach <J> [--json]`;
const MESSAGE_USAGE = `${PROGRAM} job message <J> -- <text> [--json]`;
const STOP_USAGE    = `${PROGRAM} job wind-down|stop|fresh <J> [--json] · ${PROGRAM} job stop --all [--wind-down] [--json]`;

/** How often `job attach` looks for new entries while the job is on the board: a schedule, never a decision. */
const ATTACH_POLL_MILLISECONDS = 1000;

const JOB_ID_PATTERN = /^J[1-9][0-9]*$/i;

type JobSubcommand = (commandArguments: ArgumentParser, context: CommandContext) => Promise<void>;

function refuseUsage(problem: string, usage: string): never {
  throw new OperationRefusal('refused', `${problem}\n  Usage: ${usage}`);
}

function jobIdIn(commandArguments: ArgumentParser, usage: string): string {
  const written = commandArguments.positionalsBeforeSeparator()[1];
  if (written === undefined) refuseUsage('Name the job, as J4.', usage);
  if (!JOB_ID_PATTERN.test(written)) refuseUsage(`"${written}" is not a job id. Write J and its number, as J4.`, usage);
  return written.toUpperCase();
}

async function recordControl(commandArguments: ArgumentParser, context: CommandContext, command: ControlCommand): Promise<void> {
  await relayWhenUnderJob(context, command);
  const { logged } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
  const sentences = OutputUtil.loggedSentencesOf(logged);
  const text = `${sentences === '' ? 'Recorded.' : sentences}\nThe runner carries it out, at once when it is up, else when it starts.`;
  OutputUtil.printEntity(commandArguments, context, { command, logged }, text);
}

/** A finished job is no longer on the board: what its launch and end records say of it. */
function finishedJobOf(logRecords: readonly LogRecord[], jobId: string): Record<string, unknown> | null {
  const launched = logRecords.find((record) => record.kind === 'job-launched' && record.jobId === jobId);
  if (launched?.kind !== 'job-launched') return null;
  const ended = logRecords.find((record) => record.kind === 'job-ended' && record.jobId === jobId);
  return {
    id: jobId, ...launched.fields, launchedAt: launched.at, ...(ended?.kind === 'job-ended' ? { ended: ended.fields, endedAt: ended.at } : {})
  };
}

function jobRecordOf(workspace: Workspace, jobId: string): { live: Readonly<Job> | null; record: Record<string, unknown> } {
  const live = (requireProgressFile(workspace).jobs ?? []).find((job) => job.id === jobId) ?? null;
  if (live !== null) return { live, record: { ...live } };
  const finished = finishedJobOf(requireTracker(workspace).storedLog.records, jobId);
  if (finished === null) throw new OperationRefusal('refused', `There is no job ${jobId}.\n  Usage: ${SHOW_USAGE}`);
  return { live: null, record: finished };
}

async function showJob(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(['json'], SHOW_USAGE);
  commandArguments.rejectExtraPositionals(2, SHOW_USAGE);
  const workspace = requireWorkspace(context.currentDirectory);
  const jobId     = jobIdIn(commandArguments, SHOW_USAGE);
  const { record } = jobRecordOf(workspace, jobId);
  const jobFolder = HostFleet.jobFolderOf(workspace.trackerDirectory, jobId);
  const lines = [...Object.entries(record).map(([field, value]) => `${field}: ${typeof value === 'string' ? value : JSON.stringify(value)}`), `files: ${jobFolder}`];
  OutputUtil.printEntity(commandArguments, context, { job: record, jobFolder }, lines.join('\n'));
  return Promise.resolve();
}

function eventTextOf(event: AgentSessionEvent): string | null {
  switch (event.kind) {
    case 'started':
      return `session started on ${event.model}`;
    case 'tool-call':
      return `${event.parentToolUseId === null ? '' : '  '}${event.toolName} ${event.inputSummary}`;
    case 'question':
      return `asks: ${event.questions.map((question) => question.question).join(' / ')}`;
    case 'permission-denied':
      return `denied: ${event.toolName}`;
    default:
      return event.kind === 'result' ? 'turn ended' : null;
  }
}

function entryLinesOf(adapter: AgentAdapter, instance: number, entries: readonly EventLogEntry[]): string[] {
  return entries.flatMap((entry) => {
    if (entry.origin !== 'agent') return [`[${instance}.${entry.sequence}] > ${entry.origin}: ${entry.line}`];
    return adapter.eventsOf(entry.line).flatMap((event) => {
      const text = eventTextOf(event);
      return text === null ? [] : [`[${instance}.${entry.sequence}] ${text}`];
    });
  });
}

/** Read-only: every host instance's event log in instance order, then the newest followed while the job is on the board. */
async function attachJob(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions([], SHOW_USAGE);
  commandArguments.rejectExtraPositionals(2, SHOW_USAGE);
  const workspace = requireWorkspace(context.currentDirectory);
  const jobId     = jobIdIn(commandArguments, SHOW_USAGE);
  const { live, record } = jobRecordOf(workspace, jobId);
  const jobFolder = HostFleet.jobFolderOf(workspace.trackerDirectory, jobId);
  let newestInstance = live?.hostInstance ?? (typeof record['hostInstance'] === 'number' ? record['hostInstance'] : 1);
  let cursor = 0;
  const printNewEntries = (instance: number): void => {
    const entries = HostFleet.eventsAfter(jobFolder, instance, instance === newestInstance ? cursor : 0);
    if (entries === 'malformed') return;
    for (const line of entryLinesOf(context.agentAdapter, instance, entries)) context.standardOutput(line);
    if (instance === newestInstance) cursor = entries.at(-1)?.sequence ?? cursor;
  };
  for (let instance = 1; instance < newestInstance; instance += 1) printNewEntries(instance);
  printNewEntries(newestInstance);
  for (;;) {
    const current = (requireProgressFile(workspace).jobs ?? []).find((job) => job.id === jobId);
    if (current === undefined) return;
    if (current.hostInstance !== newestInstance) {
      printNewEntries(newestInstance);
      newestInstance = current.hostInstance;
      cursor = 0;
    }
    await Bun.sleep(ATTACH_POLL_MILLISECONDS);
    printNewEntries(newestInstance);
  }
}

async function messageJob(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(['json'], MESSAGE_USAGE);
  const jobId = jobIdIn(commandArguments, MESSAGE_USAGE);
  if (commandArguments.positionalsBeforeSeparator().length > 2) refuseUsage('Write the message after --.', MESSAGE_USAGE);
  const text = commandArguments.positionals().slice(2).join(' ').trim();
  if (text === '') refuseUsage('Write the message after --.', MESSAGE_USAGE);
  await recordControl(commandArguments, context, { kind: 'job-message', jobId, text });
}

function stopSubcommand(mode: 'stop' | 'wind-down' | 'fresh'): JobSubcommand {
  return async (commandArguments, context) => {
    commandArguments.rejectUnknownOptions(mode === 'stop' ? ['json', 'all', 'wind-down'] : ['json'], STOP_USAGE);
    if (mode === 'stop' && commandArguments.flag('all')) {
      commandArguments.rejectExtraPositionals(1, STOP_USAGE);
      await recordControl(commandArguments, context, { kind: 'job-stop-all', mode: commandArguments.flag('wind-down') ? 'wind-down' : 'stop' });
      return;
    }
    if (commandArguments.flag('wind-down')) refuseUsage('--wind-down goes with --all; write job wind-down <J> for one job.', STOP_USAGE);
    commandArguments.rejectExtraPositionals(2, STOP_USAGE);
    const jobId = jobIdIn(commandArguments, STOP_USAGE);
    await recordControl(commandArguments, context, mode === 'fresh' ? { kind: 'job-fresh', jobId } : { kind: 'job-stop', jobId, mode });
  };
}

const JOB_SUBCOMMANDS: Readonly<Record<string, JobSubcommand>> = Object.freeze({
  'show':      showJob,
  'attach':    attachJob,
  'message':   messageJob,
  'wind-down': stopSubcommand('wind-down'),
  'stop':      stopSubcommand('stop'),
  'fresh':     stopSubcommand('fresh'),
});

export const JOB_SUBCOMMAND_NAMES: readonly string[] = Object.freeze(Object.keys(JOB_SUBCOMMANDS));

export const jobCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];
  const handler = subcommand !== undefined && Object.hasOwn(JOB_SUBCOMMANDS, subcommand) ? JOB_SUBCOMMANDS[subcommand] : undefined;
  if (handler === undefined) {
    throw new OperationRefusal('refused', `Write one of job ${JOB_SUBCOMMAND_NAMES.join(', ')}.\n  Usage: ${SHOW_USAGE}\n  Usage: ${MESSAGE_USAGE}\n  Usage: ${STOP_USAGE}`);
  }
  await handler(commandArguments, context);
};
