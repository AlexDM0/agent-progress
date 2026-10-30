/**
 * `pipeline.json` both ways. What matters: a written pipeline reads back whole, every optional key kept; an empty gate list stays written,
 * since it is "no gates on purpose", not "none set"; a file nobody could trust whole (not JSON, an unknown key, a gate missing `name` or
 * `run`, a name given twice) is `malformed` with a reason naming the offending part, never a throw; and no file is `absent`.
 */
import { writeFileSync } from 'node:fs';
import { join }          from 'node:path';
import {
  afterEach,
  beforeEach,
  expect,
  test,
} from 'bun:test';
import type { Pipeline }                                  from '../../lib/tracker-model/@types/Pipeline.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { PipelineFile }                                   from './PipelineFile.ts';

const EXAMPLE_PIPELINE: Pipeline = {
  prepare: [{ name: 'install', run: 'bun install --frozen-lockfile' }],
  gates:   [
    { name: 'types', run: 'bun run typecheck', definedBy: ['tsconfig.json'] },
    {
      name: 'lint', run: 'bun run lint', fix: 'bun run lint --fix', in: 'packages/example', network: ['registry.example.com'], writes: ['~/.cache/example'], overseerOnly: true
    },
  ],
  review:       { name: 'review', model: 'opus', effort: 'medium' },
  constitution: ['CLAUDE.md'],
  agents:       { builder: ['Alex Example builds'], reviewer: ['Example Agency reviews'] },
};

let scratchDirectory = '';

const pipelineFilePath = (): string => join(scratchDirectory, 'pipeline.json');

function readingOfText(text: string): ReturnType<typeof PipelineFile.read> {
  writeFileSync(pipelineFilePath(), text);
  return PipelineFile.read(pipelineFilePath());
}

function reasonOf(document: unknown): string {
  const reading = readingOfText(JSON.stringify(document));
  return reading.verdict === 'malformed' ? reading.reason : `read as ${reading.verdict}`;
}

beforeEach(() => {
  scratchDirectory = createScratchDirectory('pipeline-file');
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

test('no file reads as absent', () => {
  expect(PipelineFile.read(pipelineFilePath())).toEqual({ verdict: 'absent' });
});

test('a written pipeline reads back whole, every optional key kept', () => {
  expect(readingOfText(PipelineFile.contentsOf(EXAMPLE_PIPELINE))).toEqual({ verdict: 'readable', pipeline: EXAMPLE_PIPELINE });
});

test('an empty gate list is written and reads back as an empty list, not as no pipeline', () => {
  const contents = PipelineFile.contentsOf({ prepare: [], gates: [] });
  expect(JSON.parse(contents)).toEqual({ prepare: [], gates: [] });
  expect(readingOfText(contents)).toEqual({ verdict: 'readable', pipeline: { prepare: [], gates: [] } });
});

test('a file that is not JSON is malformed, never a throw', () => {
  expect(readingOfText('{ "gates": [').verdict).toBe('malformed');
});

test('an unknown key, at the top or on a gate or step, is refused with a reason naming it', () => {
  expect(reasonOf({ gates: [], checks: 'bun test' })).toBe('"checks" is not a pipeline key; the keys are prepare, gates, review, constitution, agents');
  expect(reasonOf({ gates: [{ name: 'test', run: 'bun test', cache: true }] })).toContain('gates[0]."cache" is not a pipeline key');
  expect(reasonOf({ prepare: [{ name: 'install', run: 'bun install', network: [] }] })).toContain('prepare[0]."network" is not a pipeline key');
  expect(reasonOf({ gates: [], agents: { tester: [] } })).toContain('agents."tester" is not a pipeline key');
});

test('a gate missing its name or its run line is refused with a reason naming the gate', () => {
  expect(reasonOf({ gates: [{ run: 'bun test' }] })).toBe('gates[0] has no name');
  expect(reasonOf({ gates: [{ name: 'test' }] })).toBe('gates[0] has no run line');
  expect(reasonOf({ gates: [{ name: 'test', run: '  ' }] })).toBe('gates[0] has no run line');
});

test('a name given twice, or a field of the wrong shape, is refused with a reason naming it', () => {
  expect(reasonOf({ gates: [{ name: 'test', run: 'bun test' }, { name: 'test', run: 'bun test --bail' }] })).toBe('gates names "test" twice');
  expect(reasonOf({ gates: [{ name: 'test', run: 'bun test', definedBy: 'package.json' }] })).toBe('gates[0].definedBy is not a list of non-blank texts');
  expect(reasonOf({ gates: [{ name: 'test', run: 'bun test', overseerOnly: false }] })).toBe('gates[0].overseerOnly is present and is not true');
  expect(reasonOf([])).toBe('the document is not a JSON object');
  expect(reasonOf({ gates: [{ name: 'test', run: 'bun test', writes: ['~/.cache/example', 'cache'] }] })).toBe('gates[0].writes holds a folder that is not absolute or ~/');
});
