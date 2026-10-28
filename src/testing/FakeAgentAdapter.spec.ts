/**
 * The fake agent stands in for a vendor in every runner, host and crash spec, so it must behave as a session does where those specs
 * look: it takes its first line, asks, waits for the answer, reports, and exits; and it can die without a result, as a killed session does.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join }            from 'node:path';

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import type { AgentAdapter }                       from '../lib/agent-launch/AgentAdapter.ts';
import type { AgentSessionEvent }                  from '../lib/agent-launch/AgentSessionEvent.ts';
import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS } from './ChildProcessCaseTimeout.ts';
import {
  fakeAgentAdapter,
  fakeQuestionLine,
  fakeResultLine,
  fakeStartedLine
} from './FakeAgentAdapter.ts';
import { createCanonicalScratchDirectory, removeScratchDirectory } from './ScratchWorkspace.ts';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

const QUESTION = {
  question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Blue', description: 'Blue.' }]
};

function launched(adapter: AgentAdapter): ReturnType<typeof Bun.spawn<'pipe', 'pipe', 'pipe'>> {
  const scratch = createCanonicalScratchDirectory('fake-agent');
  scratchDirectories.push(scratch);
  const plan = adapter.planOf({
    sessionId:         'fake-session',
    resume:            false,
    workingDirectory:  scratch,
    firstMessage:      'Start.',
    roleBrief:         '',
    model:             'fake-model',
    effort:            'low',
    environment:       {},
    jobFilesDirectory: join(scratch, 'job'),
    reportSchema:      null,
    profile:           {
      writableRoots:          [],
      deniedWritableRoots:    [],
      deniedReadableRoots:    [],
      bashNetworkDomains:     [],
      webNetworkDomains:      'none',
      relayDirectory:         scratch,
      allowedCommandPrefixes: [],
      deniedCommandPrefixes:  [],
      askUser:                true,
      skills:                 false,
      subagents:              [],
      attribution:            'none',
      instructionsRoot:       scratch,
      gitHooksDirectory:      scratch,
      commitSigning:          { kind: 'unsigned' },
    },
  });
  for (const file of plan.files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.text);
  }
  return Bun.spawn([...plan.argv], {
    cwd: scratch, env: plan.environment, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe'
  });
}

describe('the fake agent session', () => {
  test('takes its first line, asks, waits for the answer, reports and exits 0', async () => {
    const adapter = fakeAgentAdapter([
      { kind: 'await-line' },
      { kind: 'print', line: fakeStartedLine('fake-session') },
      { kind: 'print', line: fakeQuestionLine('request-1', [QUESTION]) },
      { kind: 'await-line' },
      { kind: 'print', line: fakeResultLine({ colour: 'Blue' }) },
      { kind: 'exit', code: 0 },
    ]);
    const session = launched(adapter);
    session.stdin.write(`${adapter.chatLineOf('Start.')}\n`);
    session.stdin.write(`${adapter.answerLineOf('request-1', [QUESTION], { 'Which colour?': 'Blue' })}\n`);
    await session.stdin.end();
    const events: AgentSessionEvent[] = (await new Response(session.stdout).text()).split('\n').flatMap((line) => [...adapter.eventsOf(line)]);
    expect(await session.exited).toBe(0);
    expect(events.map((event) => event.kind)).toEqual(['started', 'question', 'result']);
    expect(events.at(-1)).toMatchObject({ kind: 'result', isError: false, structuredReport: { colour: 'Blue' } });
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('dies without a result when its scenario crashes, as a killed session does', async () => {
    const session = launched(fakeAgentAdapter([{ kind: 'print', line: fakeStartedLine('fake-session') }, { kind: 'crash' }]));
    await session.stdin.end();
    const output = await new Response(session.stdout).text();
    await session.exited;
    expect(session.signalCode).toBe('SIGKILL');
    expect(output).not.toContain('"result"');
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});
