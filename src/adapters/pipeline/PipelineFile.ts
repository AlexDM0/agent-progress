/**
 * `pipeline.json` beside the progress file: the board's gate pipeline, read, validated and mapped here, and written through the hold. A
 * file that cannot be read whole is `malformed` with the reason, never a throw.
 */
import { JsonRecordUtil } from '../../lib/json-record/JsonRecordUtil.ts';
import type {
  Pipeline,
  PipelineAgentRole,
  PipelineGate,
  PipelineReview,
  PipelineStep
} from '../../lib/tracker-model/@types/Pipeline.ts';
import { JsonTextUtil }     from '../../shared/utils/JsonTextUtil.ts';
import { storedFileTextOf } from '../StoredFileText.ts';
import { StoredValueUtil }  from '../utils/StoredValueUtil.ts';

export type PipelineReading =
  | { verdict: 'absent' }
  | { verdict: 'readable'; pipeline: Pipeline }
  | { verdict: 'malformed'; reason: string };

const PIPELINE_KEYS        = ['prepare', 'gates', 'review', 'constitution', 'agents'] as const;
const STEP_KEYS            = ['name', 'run'] as const;
const GATE_KEYS            = ['name', 'run', 'fix', 'in', 'definedBy', 'network', 'writes', 'overseerOnly'] as const;
const REVIEW_KEYS          = ['name', 'model', 'effort'] as const;
const AGENT_ROLES          = ['builder', 'reviewer', 'merger', 'productOwner', 'onboarder', 'assistant'] as const satisfies readonly PipelineAgentRole[];

type Mapped<Value> = { value: Value } | { problem: string };

function problemOf(problem: string): { problem: string } {
  return { problem };
}

function unknownKeyProblemOf(record: Record<string, unknown>, knownKeys: readonly string[], path: string): string | null {
  const unknownKey = Object.keys(record).find((key) => !knownKeys.includes(key));
  return unknownKey === undefined ? null : `${path}${JSON.stringify(unknownKey)} is not a pipeline key; the keys are ${knownKeys.join(', ')}`;
}

function textIsPresent(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** A gate's writable folder is absolute or home-relative: a relative one would resolve against wherever the Overseer runs. */
function writablePathIsWellFormed(path: string): boolean {
  return path.startsWith('/') || path.startsWith('~/');
}

function textListOf(value: unknown, path: string): Mapped<string[] | undefined> {
  if (value === undefined) return { value: undefined };
  if (!Array.isArray(value) || !value.every(textIsPresent)) return problemOf(`${path} is not a list of non-blank texts`);
  return { value: [...value] };
}

function optionalTextOf(value: unknown, path: string): Mapped<string | undefined> {
  if (value === undefined) return { value: undefined };
  return textIsPresent(value) ? { value } : problemOf(`${path} is present and is not a non-blank text`);
}

function namedRecordOf(value: unknown, path: string, knownKeys: readonly string[]): Mapped<Record<string, unknown>> {
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return problemOf(`${path} is not an object`);
  const unknownKeyProblem = unknownKeyProblemOf(value, knownKeys, `${path}.`);
  if (unknownKeyProblem !== null) return problemOf(unknownKeyProblem);
  if (!textIsPresent(value['name'])) return problemOf(`${path} has no name`);
  return { value };
}

function stepOf(value: unknown, path: string): Mapped<PipelineStep> {
  const record = namedRecordOf(value, path, STEP_KEYS);
  if ('problem' in record) return record;
  const { name, run } = record.value;
  if (!textIsPresent(run)) return problemOf(`${path} has no run line`);
  return { value: { name: String(name), run } };
}

function gateOf(value: unknown, path: string): Mapped<PipelineGate> {
  const record = namedRecordOf(value, path, GATE_KEYS);
  if ('problem' in record) return record;
  const fields = record.value;
  const { name, run, overseerOnly } = fields;
  if (!textIsPresent(run)) return problemOf(`${path} has no run line`);
  if (overseerOnly !== undefined && overseerOnly !== true) return problemOf(`${path}.overseerOnly is present and is not true`);
  const gate: PipelineGate = { name: String(name), run };
  for (const key of ['fix', 'in'] as const) {
    const text = optionalTextOf(fields[key], `${path}.${key}`);
    if ('problem' in text) return text;
    if (text.value !== undefined) gate[key] = text.value;
  }
  for (const key of ['definedBy', 'network', 'writes'] as const) {
    const texts = textListOf(fields[key], `${path}.${key}`);
    if ('problem' in texts) return texts;
    if (texts.value !== undefined) gate[key] = texts.value;
  }
  if (gate.writes !== undefined && !gate.writes.every(writablePathIsWellFormed)) return problemOf(`${path}.writes holds a folder that is not absolute or ~/`);
  if (overseerOnly === true) gate.overseerOnly = true;
  return { value: gate };
}

function listOf<Item>(value: unknown, path: string, itemOf: (item: unknown, itemPath: string) => Mapped<Item>): Mapped<Item[]> {
  if (value === undefined) return { value: [] };
  if (!Array.isArray(value)) return problemOf(`${path} is not a list`);
  const items: Item[] = [];
  for (const [index, item] of value.entries()) {
    const mapped = itemOf(item, `${path}[${index}]`);
    if ('problem' in mapped) return mapped;
    items.push(mapped.value);
  }
  const names = items.map((item) => (JsonRecordUtil.recordOf(item) ?? {})['name']);
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  return repeated === undefined ? { value: items } : problemOf(`${path} names ${JSON.stringify(repeated)} twice`);
}

function reviewOf(value: unknown): Mapped<PipelineReview | undefined> {
  if (value === undefined) return { value: undefined };
  const record = namedRecordOf(value, 'review', REVIEW_KEYS);
  if ('problem' in record) return record;
  const model  = optionalTextOf(record.value['model'], 'review.model');
  const effort = optionalTextOf(record.value['effort'], 'review.effort');
  if ('problem' in model) return model;
  if ('problem' in effort) return effort;
  return {
    value: {
      name: String(record.value['name']),
      ...(model.value === undefined ? {} : { model: model.value }),
      ...(effort.value === undefined ? {} : { effort: effort.value }),
    },
  };
}

function agentsOf(value: unknown): Mapped<Pipeline['agents']> {
  if (value === undefined) return { value: undefined };
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return problemOf('agents is not an object');
  const unknownKeyProblem = unknownKeyProblemOf(value, AGENT_ROLES, 'agents.');
  if (unknownKeyProblem !== null) return problemOf(unknownKeyProblem);
  const agents: Partial<Record<PipelineAgentRole, string[]>> = {};
  for (const role of AGENT_ROLES) {
    const entries = textListOf(value[role], `agents.${role}`);
    if ('problem' in entries) return entries;
    if (entries.value !== undefined) agents[role] = entries.value;
  }
  return { value: agents };
}

function pipelineOf(document: unknown): Mapped<Pipeline> {
  if (!JsonRecordUtil.valueIsAPlainObject(document)) return problemOf('the document is not a JSON object');
  const unknownKeyProblem = unknownKeyProblemOf(document, PIPELINE_KEYS, '');
  if (unknownKeyProblem !== null) return problemOf(unknownKeyProblem);
  const prepare      = listOf(document['prepare'], 'prepare', stepOf);
  const gates        = listOf(document['gates'], 'gates', gateOf);
  const review       = reviewOf(document['review']);
  const constitution = textListOf(document['constitution'], 'constitution');
  const agents       = agentsOf(document['agents']);
  if ('problem' in prepare) return prepare;
  if ('problem' in gates) return gates;
  if ('problem' in review) return review;
  if ('problem' in constitution) return constitution;
  if ('problem' in agents) return agents;
  return {
    value: {
      prepare: prepare.value,
      gates:   gates.value,
      ...(review.value === undefined ? {} : { review: review.value }),
      ...(constitution.value === undefined ? {} : { constitution: constitution.value }),
      ...(agents.value === undefined ? {} : { agents: agents.value }),
    },
  };
}

function read(pipelineFilePath: string): PipelineReading {
  const storedText = storedFileTextOf(pipelineFilePath);
  if (storedText.verdict === 'absent') return storedText;
  if (storedText.verdict === 'unreadable') return { verdict: 'malformed', reason: storedText.reason };
  const parsedJson = StoredValueUtil.parsedJsonOf(storedText.text);
  if (parsedJson.verdict === 'unparseable') return { verdict: 'malformed', reason: parsedJson.problem };
  const pipeline = pipelineOf(parsedJson.value);
  return 'problem' in pipeline ? { verdict: 'malformed', reason: pipeline.problem } : { verdict: 'readable', pipeline: pipeline.value };
}

/**
 * Mapped through the read, so every key is written in the order the read lists them; `prepare` and `gates` are always written, so an empty
 * gate list stays the deliberate "no gates" it was set as.
 */
function contentsOf(pipeline: Readonly<Pipeline>): string {
  const mapped = pipelineOf(JSON.parse(JSON.stringify(pipeline)));
  return JsonTextUtil.storedFileTextOf('value' in mapped ? mapped.value : pipeline);
}

export const PipelineFile = Object.freeze({ read, contentsOf, writablePathIsWellFormed });
