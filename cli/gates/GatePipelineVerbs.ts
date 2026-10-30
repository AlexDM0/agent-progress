/**
 * `gate prepare|add|none|remove|list`: the only writers and the reader of the board's `pipeline.json`. Each write is one control command
 * applied in a hold (relayed when run under a job); a command line goes after `--`, so its words are never read as options.
 */
import { PipelineFile }                            from '../../src/adapters/pipeline/PipelineFile.ts';
import type { Pipeline, PipelineGate }             from '../../src/lib/tracker-model/@types/Pipeline.ts';
import { PipelineUtil }                            from '../../src/lib/tracker-model/utils/PipelineUtil.ts';
import { ControlService }                          from '../../src/services/control/ControlService.ts';
import { type CacheFolderRefusal, GateCachePaths } from '../../src/services/overseer/GateCachePaths.ts';
import { requireWorkspace }                        from '../../src/services/tracker/Workspace.ts';
import type { ControlCommand }                     from '../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }                        from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                           from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                     from '../CommandContext.ts';
import { hatchWhenUnderJob }                       from '../HatchUnderJob.ts';
import { openTrackerForWriting }                   from '../OpenTrackerForWriting.ts';
import { refuseUsage }                             from '../RecordedIncidentMove.ts';
import type { ArgumentParser }                     from '../arguments/ArgumentParser.ts';
import { OutputUtil }                              from '../utils/OutputUtil.ts';

const { PROGRAM } = PRODUCT_NAMES;

export const GATE_PIPELINE_USAGE = {
  prepare: `${PROGRAM} gate prepare <name> [--json] -- <command>`,
  add:     `${PROGRAM} gate add <name> [--fix "<command>"] [--in <folder>] [--defined-by <pattern>]… [--network <domain>]… [--writes <path>]… `
    + '[--overseer-only] [--json] -- <command>',
  none:   `${PROGRAM} gate none [--json]`,
  remove: `${PROGRAM} gate remove <name> [--json]`,
  list:   `${PROGRAM} gate list [--json]`,
} as const;

const GATE_ADD_OPTION_NAMES = ['fix', 'in', 'defined-by', 'network', 'writes', 'overseer-only', 'json'];

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

const UNWRITABLE_FOLDER_WORDING: Readonly<Record<CacheFolderRefusal, string>> = {
  'bin-folder':         'is, sits in or holds a bin folder',
  'search-path-folder': 'is, sits in or holds a folder on PATH',
};

function nameFrom(commandArguments: ArgumentParser, usage: string): string {
  const name = commandArguments.positionalsBeforeSeparator()[1];
  if (name === undefined) refuseUsage('Name the step.', usage);
  if (!NAME_PATTERN.test(name)) refuseUsage(`"${name}" is not a step name: letters, digits, dots, dashes and underscores, starting with a letter or digit.`, usage);
  return name;
}

/** Everything after `--`, joined: one quoted argument or the command's words as typed. */
function commandLineFrom(commandArguments: ArgumentParser, usage: string): string {
  if (commandArguments.positionalsBeforeSeparator().length > 2) refuseUsage('Put the command after --.', usage);
  const commandLine = commandArguments.positionals().slice(2).join(' ').trim();
  if (commandLine === '') refuseUsage('Give the command after --.', usage);
  return commandLine;
}

/** A folder a gate could never write is refused when stored, so the Overseer's later dropping of it never comes as a surprise. */
function refuseUnwritableFolder(path: string, context: CommandContext, usage: string): void {
  if (!PipelineFile.writablePathIsWellFormed(path)) refuseUsage(`--writes takes an absolute or ~/ folder, and ${path} is neither.`, usage);
  const refusal = GateCachePaths.refusalOf(path, context.homeDirectory, context.executableSearchPath);
  if (refusal !== null) refuseUsage(`The folder ${path} ${UNWRITABLE_FOLDER_WORDING[refusal]}, so a gate may never write it; nothing was stored.`, usage);
}

async function applyPipelineChange(commandArguments: ArgumentParser, context: CommandContext, command: ControlCommand): Promise<void> {
  await hatchWhenUnderJob(context, command);
  const changed = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
  if (!('pipeline' in changed)) return;
  const { logged, pipeline } = changed;
  OutputUtil.printEntity(commandArguments, context, { pipeline, pipelineHash: PipelineUtil.pipelineHashOf(pipeline) }, OutputUtil.loggedSentencesOf(logged));
}

export async function prepareStep(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const usage = GATE_PIPELINE_USAGE.prepare;
  commandArguments.rejectUnknownOptions(['json'], usage);
  const step = { name: nameFrom(commandArguments, usage), run: commandLineFrom(commandArguments, usage) };
  await applyPipelineChange(commandArguments, context, { kind: 'pipeline-prepare-step-set', step });
}

export async function addGate(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const usage = GATE_PIPELINE_USAGE.add;
  commandArguments.rejectUnknownOptions(GATE_ADD_OPTION_NAMES, usage);
  const gate: PipelineGate = { name: nameFrom(commandArguments, usage), run: commandLineFrom(commandArguments, usage) };
  const fix    = commandArguments.option('fix');
  const folder = commandArguments.option('in');
  if (fix !== undefined) gate.fix = fix;
  if (folder !== undefined) gate.in = folder;
  const definedBy = commandArguments.optionValues('defined-by');
  const network   = commandArguments.optionValues('network');
  const writes    = commandArguments.optionValues('writes');
  if (definedBy.length > 0) gate.definedBy = definedBy;
  if (network.length > 0) gate.network = network;
  for (const path of writes) refuseUnwritableFolder(path, context, usage);
  if (writes.length > 0) gate.writes = writes;
  if (commandArguments.flag('overseer-only')) gate.overseerOnly = true;
  await applyPipelineChange(commandArguments, context, { kind: 'pipeline-gate-add', gate });
}

export async function setNoGates(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(['json'], GATE_PIPELINE_USAGE.none);
  commandArguments.rejectExtraPositionals(1, GATE_PIPELINE_USAGE.none);
  await applyPipelineChange(commandArguments, context, { kind: 'pipeline-gates-none' });
}

export async function removeGate(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const usage = GATE_PIPELINE_USAGE.remove;
  commandArguments.rejectUnknownOptions(['json'], usage);
  commandArguments.rejectExtraPositionals(2, usage);
  await applyPipelineChange(commandArguments, context, { kind: 'pipeline-gate-remove', name: nameFrom(commandArguments, usage) });
}

function gateLineOf(gate: Readonly<PipelineGate>): string {
  return `  ${gate.name}${gate.in === undefined ? '' : ` (in ${gate.in})`}: ${gate.run}`;
}

function pipelineTextOf(pipeline: Readonly<Pipeline> | null): string {
  if (pipeline === null) return `No pipeline is set, so no gate runs and the board holds new work (checks-not-set). Add a gate with \`${GATE_PIPELINE_USAGE.add}\`, or `
    + `\`${PROGRAM} gate none\` for none on purpose.`;
  const prepare = pipeline.prepare.map((step) => `  ${step.name}: ${step.run}`);
  const gates   = pipeline.gates.length === 0 ? ['  none, on purpose'] : pipeline.gates.map(gateLineOf);
  return [...(prepare.length === 0 ? [] : ['Prepare:', ...prepare]), 'Gates:', ...gates].join('\n');
}

/** Takes no lock and writes nothing; a malformed file is refused with its reason, since nothing could be listed from it. */
export function listPipeline(commandArguments: ArgumentParser, context: CommandContext): void {
  commandArguments.rejectUnknownOptions(['json'], GATE_PIPELINE_USAGE.list);
  commandArguments.rejectExtraPositionals(1, GATE_PIPELINE_USAGE.list);
  const { pipelineFilePath } = requireWorkspace(context.currentDirectory);
  const reading = PipelineFile.read(pipelineFilePath);
  if (reading.verdict === 'malformed') throw new OperationRefusal('refused', { kind: 'malformed-pipeline', filePath: pipelineFilePath, reason: reading.reason });
  const pipeline = reading.verdict === 'readable' ? reading.pipeline : null;
  const entity = {
    pipelineIsSet: pipeline !== null,
    pipelineHash:  pipeline === null ? null : PipelineUtil.pipelineHashOf(pipeline),
    prepare:       pipeline?.prepare ?? [],
    gates:         pipeline?.gates ?? [],
    ...(pipeline?.review === undefined ? {} : { review: pipeline.review }),
    ...(pipeline?.constitution === undefined ? {} : { constitution: pipeline.constitution }),
    ...(pipeline?.agents === undefined ? {} : { agents: pipeline.agents }),
  };
  OutputUtil.printEntity(commandArguments, context, entity, pipelineTextOf(pipeline));
}
