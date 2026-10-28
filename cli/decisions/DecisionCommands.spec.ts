/**
 * `decisions`, `decide` and `await` on an initialised scratch repository with no runner. What matters: `decisions` letters each option
 * as `decide` takes it and writes nothing; `decide` answers through the write pipeline with the runner down, storing `{question: answer}`
 * and logging it with its request, and the second answer is refused because the first wins; free text is refused on a decision of several
 * questions; and `await` wakes on a `decision-opened` past its position, waiting for one opened after it started.
 */
import { readFileSync } from 'node:fs';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                             from 'bun:test';
import type { DecisionOpening }               from '../../src/lib/tracker-model/@types/Decision.ts';
import { createRenderState }                  from '../../src/services/render/RenderState.ts';
import { writeTracker }                       from '../../src/services/tracker/TrackerPipeline.ts';
import { workspacePathsFor }                  from '../../src/services/tracker/Workspace.ts';
import { removeScratchDirectory }             from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../Main.ts';
import { createCapturedCommandContext }       from '../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../testing/InitializedScratchRepository.ts';
import { fileReadyTicket }                    from '../testing/ReadyTicketFiling.ts';

const FROZEN_NOW = new Date('2026-10-28T09:00:00Z');
const OPENED_AT  = '2026-10-28T10:00:00+01:00';

const EXAMPLE_DECISION = {
  kind:      'agent-question',
  ticketIds: ['001'],
  jobId:     null,
  askedBy:   'builder',
  requestId: 'request-1',
  questions: [
    {
      question: 'Which export format?', header: 'Format', multiSelect: false, options: [{ label: 'CSV', description: 'Comma separated' }, { label: 'JSON', description: '' }],
    },
    {
      question: 'Which columns?', header: 'Columns', multiSelect: true, options: [{ label: 'Name', description: '' }, { label: 'Total', description: '' }],
    },
  ],
  context: '',
} satisfies DecisionOpening;

let repositoryDirectory = '';

async function runWithExit(commandLineArguments: readonly string[]): Promise<{ exitCode: number; context: ReturnType<typeof createCapturedCommandContext> }> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  return { exitCode, context };
}

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const { exitCode, context } = await runWithExit(commandLineArguments);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

async function openTheExampleDecision(): Promise<void> {
  await writeTracker({
    workspace:   workspacePathsFor(repositoryDirectory),
    at:          OPENED_AT,
    now:         () => FROZEN_NOW,
    renderState: createRenderState(),
    mutate:      (change) => change.board.openDecision(EXAMPLE_DECISION, change.at),
  });
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('decision-commands', ['--project', 'Example Agency'], () => FROZEN_NOW);
  await fileReadyTicket(run, ['ticket', 'add', 'Example export', '--type', 'ticket']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('the decision commands', () => {
  test('decisions letters each option as decide takes it, and reads without writing', async () => {
    await openTheExampleDecision();
    const progressPath = workspacePathsFor(repositoryDirectory).progressFilePath;
    const before = readFileSync(progressPath, 'utf8');

    const listed = await run(['decisions']);
    expect(listed.outputText()).toContain('E1 agent-question on #001 (asked by builder');
    expect(listed.outputText()).toContain('  1. [Format] Which export format?\n     a. CSV: Comma separated\n     b. JSON');
    expect(listed.outputText()).toContain('  2. [Columns] Which columns? (several letters)');
    expect(JSON.parse((await run(['decisions', '--json'])).outputText())).toMatchObject({ decisions: [{ id: 'E1', requestId: 'request-1' }] });
    expect(readFileSync(progressPath, 'utf8')).toBe(before);
  });

  test('decide answers with the runner down, stores {question: answer}, logs it with its request, and the first answer wins', async () => {
    await openTheExampleDecision();
    const answered = await run(['decide', 'E1', 'b', 'ab', '--json']);
    expect(JSON.parse(answered.outputText())).toEqual({ decisionId: 'E1', answer: { 'Which export format?': 'JSON', 'Which columns?': 'Name, Total' } });
    const log = readFileSync(workspacePathsFor(repositoryDirectory).logFilePath, 'utf8');
    const storedAnswer = '{"answer":{"Which export format?":"JSON","Which columns?":"Name, Total"},"requestId":"request-1"}';
    expect(log).toContain(`"kind":"decision-answered","decisionId":"E1","fields":${storedAnswer}`);
    expect(JSON.parse((await run(['decisions', '--json'])).outputText())).toEqual({ decisions: [] });

    const second = await runWithExit(['decide', 'E1', 'a', 'a']);
    expect(second.exitCode).toBe(1);
    expect(second.context.errorText()).toContain('the first answer wins');
  });

  test('free text on a decision of two questions is refused, and nothing is written', async () => {
    await openTheExampleDecision();
    const refused = await runWithExit(['decide', 'E1', '--', 'Whatever', 'is', 'simplest']);
    expect(refused.exitCode).toBe(1);
    expect(refused.context.errorText()).toContain('free text is given in the UI');
    expect(JSON.parse((await run(['decisions', '--json'])).outputText())).toMatchObject({ decisions: [{ id: 'E1' }] });
  });

  test('await wakes on a decision-opened past its position, and waits for one opened after it started', async () => {
    const logLength = readFileSync(workspacePathsFor(repositoryDirectory).logFilePath, 'utf8').split('\n').filter((line) => line !== '').length;
    const waiting = run(['await', '--json', '--after', String(logLength)]);
    await Bun.sleep(1);
    await openTheExampleDecision();
    const woken = JSON.parse((await waiting).outputText()) as { after: number; position: number; records: { kind: string; position: number }[] };
    expect(woken.records.map((record) => record.kind)).toEqual(['decision-opened']);
    expect(woken.records[0]?.position).toBe(woken.position);

    const replayed = JSON.parse((await run(['await', '--json', '--after', String(woken.after)])).outputText()) as typeof woken;
    expect(replayed.records).toEqual(woken.records);
  });
});
