/**
 * The one claim no fixture can hold: a plan the adapter renders actually runs. It launches a real `claude -p` session in a scratch folder,
 * through the plan's argv, environment and files, and maps its stdout until a schema-valid report arrives. It spends the machine's
 * subscription, so it runs only with the product's `REAL_AGENT_SPECS` switch set (`AGENT_PROGRESS_REAL_AGENT_SPECS=1`) and `claude`
 * present, and is skipped, named, otherwise.
 */
import { randomUUID }                             from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join }                          from 'node:path';

import { afterAll, expect } from 'bun:test';

import { environmentCopy }                                         from '../../shared/Environment.ts';
import { createCanonicalScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { testWhenRealClaudeSpecsAreOn }                            from '../../testing/ToolGuard.ts';
import type { AgentSessionEvent }                                  from '../agent-launch/AgentSessionEvent.ts';
import { launchEnvironmentOf }                                     from '../agent-launch/LaunchEnvironment.ts';
import { CLAUDE_CODE_ADAPTER, claudeSessionIdOf }                  from './ClaudeCodeAdapter.ts';

const REAL_SESSION_TIMEOUT_MILLISECONDS = 240_000;
const REPORT_SCHEMA = JSON.parse(readFileSync(join(import.meta.dir, 'testing', 'fixtures', 'button-colour.schema.json'), 'utf8')) as { properties: { colour: { enum: string[] } } };

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

async function* linesOf(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    yield* lines;
  }
  if (pending.length > 0) yield pending;
}

testWhenRealClaudeSpecsAreOn('a real claude -p session launched from the rendered plan returns a schema-valid structured report', async () => {
  const scratch = createCanonicalScratchDirectory('real-claude-session');
  scratchDirectories.push(scratch);
  const workingDirectory = join(scratch, 'work');
  mkdirSync(workingDirectory, { recursive: true });
  const plan = CLAUDE_CODE_ADAPTER.planOf({
    sessionId:         claudeSessionIdOf('real-agent-spec', randomUUID()),
    resume:            false,
    workingDirectory,
    firstMessage:      '',
    roleBrief:         'You answer in as few tool calls as possible.',
    model:             'haiku',
    effort:            'low',
    environment:       launchEnvironmentOf(environmentCopy(), {}),
    jobFilesDirectory: join(scratch, 'job'),
    reportSchema:      REPORT_SCHEMA,
    profile:           {
      writableRoots:          [],
      deniedWritableRoots:    [join(scratch, 'job')],
      deniedReadableRoots:    [],
      bashNetworkDomains:     [],
      webNetworkDomains:      'none',
      relayDirectory:         join(scratch, 'relay'),
      allowedCommandPrefixes: [],
      deniedCommandPrefixes:  [['git', 'push']],
      askUser:                false,
      skills:                 false,
      subagents:              [{
        name: 'explorer', model: 'haiku', effort: 'low', readOnly: true
      }],
      attribution:       'none',
      instructionsRoot:  workingDirectory,
      gitHooksDirectory: join(scratch, 'git-hooks'),
      commitSigning:     { kind: 'unsigned' },
    },
  });
  for (const file of plan.files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.text);
  }
  mkdirSync(join(scratch, 'relay'), { recursive: true });

  const session = Bun.spawn([...plan.argv], {
    cwd: workingDirectory, env: plan.environment, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe'
  });
  session.stdin.write(`${CLAUDE_CODE_ADAPTER.chatLineOf('Report the colour Blue as your structured output, without using any other tool.')}\n`);
  const events: AgentSessionEvent[] = [];
  for await (const line of linesOf(session.stdout)) {
    events.push(...CLAUDE_CODE_ADAPTER.eventsOf(line));
    if (events.at(-1)?.kind === 'result') break;
  }
  await session.stdin.end();
  await session.exited;

  const result = events.find((event) => event.kind === 'result');
  expect(events.find((event) => event.kind === 'started')).toMatchObject({ kind: 'started', model: expect.stringContaining('haiku') });
  expect(result).toMatchObject({ kind: 'result', isError: false });
  const report = result?.kind === 'result' ? result.structuredReport as { colour?: string } | null : null;
  expect(REPORT_SCHEMA.properties.colour.enum).toContain(report?.colour ?? '');
}, REAL_SESSION_TIMEOUT_MILLISECONDS);
