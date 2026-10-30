/**
 * The build prompt's gates section. What matters: each gate the builder runs is listed by name with its exact command and its fix, in the
 * pipeline's order, under the rule to pass every gate on the final commit; a gate with a fix says to run it before fixing by hand; an
 * `overseerOnly` gate is named as the Overseer's and never listed as one to run or claim; and after `gate none`, or with no pipeline stored,
 * the message says the repository has no gates.
 */
import { readFileSync }           from 'node:fs';
import { describe, expect, test } from 'bun:test';

import type { Job }            from '../../src/lib/tracker-model/@types/Job.ts';
import type { PipelineGate }   from '../../src/lib/tracker-model/@types/Pipeline.ts';
import type { JobLaunchFacts } from '../../src/services/runner/DrivePass.ts';
import { resourceFilePathOf }  from '../../src/shared/ResourceFilePath.ts';
import { RunnerWording }       from './RunnerWording.ts';

const BUILD_INSTRUCTIONS = readFileSync(resourceFilePathOf('prompts', 'BuildPrompt.md'), 'utf8');

const BUILD_JOB = {
  id: 'J4', kind: 'build', role: 'builder', ticketIds: ['012'], attempt: 1
} as unknown as Readonly<Job>;

const GATES: readonly PipelineGate[] = [
  { name: 'format', run: 'bun run format:check', fix: 'bun run format' },
  { name: 'tests', run: 'bun test', in: 'packages/example' },
  { name: 'audit', run: 'bun audit', overseerOnly: true },
  { name: 'lint', run: 'bun run lint', fix: 'bun run lint --fix' },
];

function buildMessageOf(gates: readonly PipelineGate[] | null): string {
  const facts: JobLaunchFacts = {
    tickets:                [{ id: '012', title: 'Example basket total', body: '## Acceptance\nA1. Example basket adds up.\n' }],
    checksLine:             'bun test',
    gates,
    earlierSessionReplaced: false,
    intake:                 null,
    airlock:                null,
    assistant:              null,
    instructions:           BUILD_INSTRUCTIONS,
  };
  return RunnerWording.launchTextOf(BUILD_JOB, facts).firstMessage;
}

describe('the build prompt\'s gates', () => {
  const message = buildMessageOf(GATES);

  test('lists each gate the builder runs by name, command and fix, in the pipeline\'s order, under the final-commit rule', () => {
    expect(message).toContain('Pass every gate on your final commit before you report, in this order');
    const entries = [
      '1. `format`: `bun run format:check`\n   Fix: `bun run format`. Run it before you fix anything by hand.',
      '2. `tests`: `bun test` (in `packages/example`)',
      '3. `lint`: `bun run lint`\n   Fix: `bun run lint --fix`. Run it before you fix anything by hand.',
    ];
    const positions = entries.map((entry) => message.indexOf(entry));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(message).not.toMatch(/\{\{\w+\}\}/);
  });

  test('names an overseerOnly gate as the Overseer\'s and never lists it as one to run or claim', () => {
    expect(message).toContain('The Overseer alone runs `audit`: never run or claim it.');
    expect(message).not.toContain('`audit`: `bun audit`');
    expect(message).not.toContain('bun audit');
  });

  test('says the repository has no gates after gate none, and with no pipeline stored', () => {
    for (const gates of [[], null]) {
      const noGates = buildMessageOf(gates);

      expect(noGates).toContain('This repository has no gates: nothing to pass before you report, and your report\'s `gates` is empty.');
      expect(noGates).not.toContain('Pass every gate');
    }
  });

  test('with only overseerOnly gates, says no gate is the builder\'s and names the Overseer\'s', () => {
    const overseerOnly = buildMessageOf([{ name: 'audit', run: 'bun audit', overseerOnly: true }]);

    expect(overseerOnly).toContain('No gate is yours to run');
    expect(overseerOnly).toContain('The Overseer alone runs `audit`');
  });
});

// A review that did not hold resumes the builder's session: it is handed the findings, never the whole build prompt again.
describe('the first line of a builder resumed after its review', () => {
  const facts: JobLaunchFacts = {
    tickets:                [{ id: '012', title: 'Example basket total', body: '## Acceptance\nA1. Example basket adds up.\n' }],
    checksLine:             'bun test',
    gates:                  GATES,
    earlierSessionReplaced: false,
    reviewFindings:         { reviewSection: '## Review 1\n\n- A1 does-not-hold — the example total is off by one', resume: 1, resumesAllowed: 2 },
    intake:                 null,
    airlock:                null,
    assistant:              null,
    instructions:           BUILD_INSTRUCTIONS,
  };
  const message = RunnerWording.launchTextOf(BUILD_JOB, facts).firstMessage;

  test('carries the review\'s findings and the resume count, and not the build prompt', () => {
    expect(message).toContain('The review of #012 found a claim that does not hold');
    expect(message).toContain('(resume 1 of 2)');
    expect(message).toContain('- A1 does-not-hold — the example total is off by one');
    expect(message).not.toContain('Pass every gate on your final commit');
  });
});
