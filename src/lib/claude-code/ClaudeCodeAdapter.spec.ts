/**
 * The adapter is the whole of what a launched session may do, so these cases hold its rendering per role as a table: the command line
 * of design section 4.2, the settings that confine the session (sandbox sets as `//`-anchored paths, git denies, no attribution, no
 * memory, no instruction file above the repository), the subagents, the git configuration, the scrubbed environment, the one standing
 * reply, and the lines a host sends, against the ones the probes recorded.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { describe, expect, test } from 'bun:test';

import type { AgentLaunchPlan, StandingReply }                              from '../agent-launch/AgentLaunchPlan.ts';
import type { AgentLaunchRequest }                                          from '../agent-launch/AgentLaunchRequest.ts';
import type { WorkerProfile }                                               from '../agent-launch/WorkerProfile.ts';
import { CLAUDE_CODE_ADAPTER, CLAUDE_NESTING_VARIABLES, claudeSessionIdOf } from './ClaudeCodeAdapter.ts';

const REPOSITORY = '/Users/example/development/example-repository';
const WORKTREE = `${REPOSITORY}/.example-worktrees/ticket-7`;
const JOB_FILES = `${REPOSITORY}/.example-data/jobs/J1`;
const RELAY = `${REPOSITORY}/.example-worktrees/relay/J1`;
const FIXTURES_FOLDER = join(import.meta.dir, 'testing', 'fixtures');

type Role = 'builder' | 'reviewer' | 'merge-fix' | 'resolver' | 'product-owner' | 'orchestrator';

const GIT_DENIES = [
  ['git', 'push'], ['git', 'rebase'], ['git', 'reset'], ['git', 'commit', '--amend'], ['git', 'worktree'], ['git', 'update-ref'], ['git', 'branch', '-f'], ['git', '-C'],
];

function profileOf(role: Role): WorkerProfile {
  const workerRole = role !== 'product-owner' && role !== 'orchestrator';
  return {
    writableRoots:       [],
    deniedWritableRoots: [`${REPOSITORY}/.example-data`, `${WORKTREE}/.claude`, `${REPOSITORY}/.git/packed-refs`],
    deniedReadableRoots: [`${REPOSITORY}/.example-data/jobs/*/launch-*.json`, '/Users/example/.ssh', '/Users/example/.gnupg/private-keys-v1.d'],
    bashNetworkDomains:  role === 'builder' ? ['registry.example.com'] : [],
    webNetworkDomains:   {
      'builder': ['registry.example.com'], 'reviewer': 'none', 'merge-fix': 'none', 'resolver': 'none', 'product-owner': 'any', 'orchestrator': 'none'
    }[role] as WorkerProfile['webNetworkDomains'],
    relayDirectory:         RELAY,
    allowedCommandPrefixes: [['uv'], ['git', 'commit']],
    deniedCommandPrefixes:  workerRole ? GIT_DENIES : [],
    askUser:                role === 'builder' || role === 'reviewer' || role === 'product-owner',
    skills:                 role === 'product-owner',
    subagents:              [{
      name: 'coder', model: 'opus', effort: 'medium', readOnly: false
    }, {
      name: 'explorer', model: 'haiku', effort: 'low', readOnly: true
    }],
    attribution:        'none',
    instructionsRoot:   REPOSITORY,
    gitHooksDirectory:  `${REPOSITORY}/.example-worktrees/git-hooks/J1`,
    commitSigning:      { kind: 'agent-sockets', sockets: ['/Users/example/.gnupg/S.gpg-agent', '/Users/example/.gnupg/S.keyboxd'] },
    networkDomainGuard: null,
  };
}

const GUARD_ARGV = ['example-program', 'guard', '--allow', 'registry.example.com,*.docs.example.org'];
const GUARD_COMMAND = 'example-program guard --allow \'registry.example.com,*.docs.example.org\'';

function guardedRequestOf(role: Role): AgentLaunchRequest {
  const profile: WorkerProfile = {
    ...profileOf(role),
    networkDomainGuard: { allowedDomains: ['registry.example.com', '*.docs.example.org'], commandArgv: GUARD_ARGV },
  };
  return requestOf(role, { profile });
}

function requestOf(role: Role, overrides: Partial<AgentLaunchRequest> = {}): AgentLaunchRequest {
  return {
    sessionId:         claudeSessionIdOf('tracker-example', 'J1'),
    resume:            false,
    workingDirectory:  WORKTREE,
    firstMessage:      'Build the ticket.',
    roleBrief:         'You are a builder.',
    model:             'opus',
    effort:            'medium',
    environment:       { HOME: '/Users/example', PATH: '/usr/bin:/bin', USER: 'example' },
    profile:           profileOf(role),
    jobFilesDirectory: JOB_FILES,
    reportSchema:      role === 'product-owner' || role === 'orchestrator' ? null : { type: 'object', required: ['role'] },
    ...overrides,
  };
}

function fileText(plan: AgentLaunchPlan, fileName: string): string {
  const file = plan.files.find((candidate) => candidate.path === join(JOB_FILES, fileName));
  if (file === undefined) throw new Error(`no ${fileName} in the plan`);
  return file.text;
}

interface RenderedSettings {
  includeCoAuthoredBy: boolean;
  attribution:         unknown;
  autoMemoryEnabled:   boolean;
  claudeMdExcludes:    string[];
  sandbox:             {
    network:    { allowedDomains: string[]; strictAllowlist: boolean; allowUnixSockets?: string[] };
    filesystem: { allowWrite: string[]; denyWrite: string[]; denyRead: string[] };
  } & Record<string, unknown>;
  permissions: { allow: string[]; deny: string[] };
}

function settingsOf(plan: AgentLaunchPlan): RenderedSettings {
  return JSON.parse(fileText(plan, 'settings.json')) as RenderedSettings;
}

function valueAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

describe('claudeSessionIdOf', () => {
  test('formats sha256(scope, job) as a stable version-8 UUID that differs per job and per scope', () => {
    const sessionId = claudeSessionIdOf('tracker-example', 'J1');
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // `printf 'tracker-example\nJ1' | shasum -a 256` is bca52fe829c10cec534d7b95…, its version and variant digits replaced.
    expect(sessionId).toBe('bca52fe8-29c1-8cec-934d-7b95d410277d');
    expect(claudeSessionIdOf('tracker-example', 'J1')).toBe(sessionId);
    expect(claudeSessionIdOf('tracker-example', 'J2')).not.toBe(sessionId);
    expect(claudeSessionIdOf('tracker-other', 'J1')).not.toBe(sessionId);
  });
});

describe('the command line, per role', () => {
  const ROLE_TABLE: readonly { role: Role; slashCommandsOff: boolean; disallowedTools: string | undefined; reportSchema: boolean }[] = [
    {
      role: 'builder', slashCommandsOff: true, disallowedTools: 'WebSearch', reportSchema: true
    },
    {
      role: 'reviewer', slashCommandsOff: true, disallowedTools: 'WebSearch,WebFetch', reportSchema: true
    },
    {
      role: 'merge-fix', slashCommandsOff: true, disallowedTools: 'WebSearch,WebFetch,AskUserQuestion', reportSchema: true
    },
    {
      role: 'resolver', slashCommandsOff: true, disallowedTools: 'WebSearch,WebFetch,AskUserQuestion', reportSchema: true
    },
    {
      role: 'product-owner', slashCommandsOff: false, disallowedTools: undefined, reportSchema: false
    },
    {
      role: 'orchestrator', slashCommandsOff: true, disallowedTools: 'WebSearch,WebFetch,AskUserQuestion', reportSchema: false
    },
  ];

  for (const row of ROLE_TABLE) {
    const schemaWording = row.reportSchema ? 'with' : 'without';
    test(`${row.role}: slash commands ${row.slashCommandsOff ? 'off' : 'on'}, disallowed ${row.disallowedTools ?? 'nothing'}, ${schemaWording} a report schema`, () => {
      const { argv } = CLAUDE_CODE_ADAPTER.planOf(requestOf(row.role));
      expect(argv.includes('--disable-slash-commands')).toBe(row.slashCommandsOff);
      expect(valueAfter(argv, '--disallowedTools')).toBe(row.disallowedTools);
      expect(argv.includes('--json-schema')).toBe(row.reportSchema);
    });
  }

  test('a fresh builder runs the exact command line of design section 4.2', () => {
    const request = requestOf('builder');
    expect(CLAUDE_CODE_ADAPTER.planOf(request).argv).toEqual([
      'claude',
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--session-id',
      request.sessionId,
      '--model',
      'opus',
      '--effort',
      'medium',
      '--setting-sources',
      'project',
      '--strict-mcp-config',
      '--mcp-config',
      `${JOB_FILES}/mcp.json`,
      '--settings',
      `${JOB_FILES}/settings.json`,
      '--agents',
      `${JOB_FILES}/agents.json`,
      '--append-system-prompt-file',
      `${JOB_FILES}/role.md`,
      '--json-schema',
      fileText(CLAUDE_CODE_ADAPTER.planOf(request), 'report.schema.json'),
      '--permission-mode',
      'auto',
      '--permission-prompt-tool',
      'stdio',
      '--disable-slash-commands',
      '--disallowedTools',
      'WebSearch',
    ]);
  });

  test('a resume passes --resume with the same id alone, never --session-id beside it', () => {
    const request = requestOf('builder', { resume: true });
    const { argv } = CLAUDE_CODE_ADAPTER.planOf(request);
    expect(valueAfter(argv, '--resume')).toBe(request.sessionId);
    expect(argv.includes('--session-id')).toBe(false);
    expect(argv.includes('--fork-session')).toBe(false);
  });

  test('the job\'s files are the settings, agents, MCP, role and report schema files the command line names', () => {
    const plan = CLAUDE_CODE_ADAPTER.planOf(requestOf('builder'));
    expect(plan.files.map((file) => file.path)).toEqual(['settings.json', 'agents.json', 'mcp.json', 'role.md', 'report.schema.json'].map((name) => join(JOB_FILES, name)));
    expect(JSON.parse(fileText(plan, 'mcp.json'))).toEqual({ mcpServers: {} });
    expect(fileText(plan, 'role.md')).toBe('You are a builder.');
    expect(JSON.parse(fileText(plan, 'report.schema.json'))).toEqual({ type: 'object', required: ['role'] });
  });
});

describe('the rendered settings', () => {
  const ROLES: readonly Role[] = ['builder', 'reviewer', 'merge-fix', 'resolver', 'product-owner', 'orchestrator'];

  for (const role of ROLES) {
    test(`${role}: no attribution, no auto-memory, and every instruction file above the repository excluded`, () => {
      const settings = settingsOf(CLAUDE_CODE_ADAPTER.planOf(requestOf(role)));
      expect(settings.includeCoAuthoredBy).toBe(false);
      expect(settings.attribution).toEqual({ commit: '', pr: '' });
      expect(settings.autoMemoryEnabled).toBe(false);
      expect(settings.claudeMdExcludes).toContain('/Users/example/.claude/CLAUDE.md');
      expect(settings.claudeMdExcludes).toContain('/Users/example/development/CLAUDE.md');
      expect(settings.claudeMdExcludes).toContain('/Users/example/development/CLAUDE.local.md');
      expect(settings.claudeMdExcludes).toContain('/CLAUDE.md');
      expect(settings.claudeMdExcludes.some((path) => path.startsWith(`${REPOSITORY}/`))).toBe(false);
    });
  }

  test('the sandbox carries the write and read sets as //-anchored paths, the relay writable, the network strict', () => {
    const { sandbox } = settingsOf(CLAUDE_CODE_ADAPTER.planOf(requestOf('builder')));
    expect(sandbox).toMatchObject({
      enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: true
    });
    expect(sandbox.filesystem.allowWrite).toEqual([`/${RELAY}`]);
    expect(sandbox.filesystem.denyWrite).toEqual([`/${REPOSITORY}/.example-data`, `/${WORKTREE}/.claude`, `/${REPOSITORY}/.git/packed-refs`]);
    expect(sandbox.filesystem.denyRead).toEqual([`/${REPOSITORY}/.example-data/jobs/*/launch-*.json`, '//Users/example/.ssh', '//Users/example/.gnupg/private-keys-v1.d']);
    expect(sandbox.network).toMatchObject({ allowedDomains: ['registry.example.com'], strictAllowlist: true });
  });

  test('the gates\' writes the profile names are writable beside the relay, //-anchored', () => {
    const request = requestOf('builder');
    const plan    = CLAUDE_CODE_ADAPTER.planOf({ ...request, profile: { ...request.profile, writableRoots: ['/Users/example/.cache/example-uv'] } });
    expect(settingsOf(plan).sandbox.filesystem.allowWrite).toEqual([`/${RELAY}`, '//Users/example/.cache/example-uv']);
  });

  test('the signing allowance is the agent sockets alone, with the key folder\'s private keys read-denied, and no unsigned fallback', () => {
    const plan = CLAUDE_CODE_ADAPTER.planOf(requestOf('builder'));
    expect(settingsOf(plan).sandbox.network.allowUnixSockets).toEqual(['//Users/example/.gnupg/S.gpg-agent', '//Users/example/.gnupg/S.keyboxd']);
    expect(settingsOf(plan).sandbox.filesystem.allowWrite.some((path) => path.includes('.gnupg'))).toBe(false);
    expect(Object.values(plan.environment)).not.toContain('commit.gpgsign');
  });

  test('the permission rules deny the git verbs, the denied roots for Edit and Write and the read set for Read, all //-anchored', () => {
    const { permissions } = settingsOf(CLAUDE_CODE_ADAPTER.planOf(requestOf('builder')));
    expect(permissions.deny).toEqual(expect.arrayContaining([
      'Bash(git push *)',
      'Bash(git rebase *)',
      'Bash(git reset *)',
      'Bash(git commit --amend *)',
      'Bash(git worktree *)',
      'Bash(git update-ref *)',
      'Bash(git branch -f *)',
      'Bash(git -C *)',
      `Edit(/${REPOSITORY}/.example-data/**)`,
      `Write(/${REPOSITORY}/.example-data/**)`,
      `Write(/${WORKTREE}/.claude/**)`,
      `Read(/${REPOSITORY}/.example-data/jobs/*/launch-*.json)`,
      'Read(//Users/example/.ssh/**)',
    ]));
    expect(permissions.allow).toEqual([
      'Read', 'Agent', `Edit(/${WORKTREE}/**)`, `Write(/${WORKTREE}/**)`, 'Bash(uv *)', 'Bash(git commit *)', 'WebFetch(domain:registry.example.com)',
    ]);
  });

  test('a session whose WebFetch reaches any domain is still denied the loopback names', () => {
    const { permissions } = settingsOf(CLAUDE_CODE_ADAPTER.planOf(requestOf('product-owner')));
    expect(permissions.deny).toEqual(expect.arrayContaining(['WebFetch(domain:localhost)', 'WebFetch(domain:127.0.0.1)']));
  });

  test('a profile with a network domain guard runs it, shell-quoted, before every Bash and every WebFetch call, once each', () => {
    const settings = JSON.parse(fileText(CLAUDE_CODE_ADAPTER.planOf(guardedRequestOf('builder')), 'settings.json')) as { hooks: unknown };
    expect(settings.hooks).toEqual({
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: GUARD_COMMAND }] },
        { matcher: 'WebFetch', hooks: [{ type: 'command', command: GUARD_COMMAND }] },
      ],
    });
  });

  test('a profile without a guard renders no hooks key, the settings text unchanged but for it', () => {
    const unguarded = fileText(CLAUDE_CODE_ADAPTER.planOf(requestOf('builder')), 'settings.json');
    const guarded = JSON.parse(fileText(CLAUDE_CODE_ADAPTER.planOf(guardedRequestOf('builder')), 'settings.json')) as Record<string, unknown>;
    expect(Object.hasOwn(JSON.parse(unguarded) as object, 'hooks')).toBe(false);
    const { hooks: _hooks, ...guardedWithoutHooks } = guarded;
    expect(unguarded).toBe(`${JSON.stringify(guardedWithoutHooks, null, 2)}\n`);
  });

  test('the agents are the coder, with edit tools, and the explorer, with Read and the rg, grep and find allow rules, each naming its model', () => {
    const agents = JSON.parse(fileText(CLAUDE_CODE_ADAPTER.planOf(requestOf('builder')), 'agents.json')) as Record<string, { model: string; effort: string; tools: string[] }>;
    expect(Object.keys(agents)).toEqual(['coder', 'explorer']);
    expect(agents['coder']).toMatchObject({ model: 'opus', effort: 'medium', tools: ['Read', 'Edit', 'Write', 'Bash'] });
    expect(agents['explorer']).toMatchObject({ model: 'haiku', effort: 'low', tools: ['Read', 'Bash(rg *)', 'Bash(grep *)', 'Bash(find *)'] });
  });
});

describe('the child environment', () => {
  test('sets the per-job commit-msg hook folder through GIT_CONFIG_* and drops every nesting variable it was given', () => {
    const nestingVariables = Object.fromEntries(CLAUDE_NESTING_VARIABLES.map((name) => [name, '1']));
    const plan = CLAUDE_CODE_ADAPTER.planOf(requestOf('builder', { environment: { HOME: '/Users/example', ...nestingVariables } }));
    expect(plan.environment).toEqual({
      HOME:               '/Users/example',
      GIT_CONFIG_COUNT:   '1',
      GIT_CONFIG_KEY_0:   'core.hooksPath',
      GIT_CONFIG_VALUE_0: `${REPOSITORY}/.example-worktrees/git-hooks/J1`,
    });
  });

  test('turns signing off through the same triple only when no signing allowance works', () => {
    const profile = { ...profileOf('builder'), commitSigning: { kind: 'unsigned' } as const };
    const plan = CLAUDE_CODE_ADAPTER.planOf(requestOf('builder', { profile }));
    expect(plan.environment).toMatchObject({ GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'false' });
    expect(settingsOf(plan).sandbox.network.allowUnixSockets).toBeUndefined();
  });
});

function replyFor(line: string, standingReplies: readonly StandingReply[]): string | null {
  const record = JSON.parse(line) as Record<string, unknown>;
  const valueAt = (path: string): unknown => path.split('.')
    .reduce<unknown>((value, key) => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined), record);
  const reply = standingReplies.find((candidate) => Object.entries(candidate.whenAllEqual).every(([path, value]) => valueAt(path) === value)
    && !Object.entries(candidate.whenNoneEqual).some(([path, value]) => valueAt(path) === value));
  return reply === undefined ? null : reply.replyTemplate.replace('{{request_id}}', String(record['request_id']));
}

function fixtureLines(name: string): string[] {
  return readFileSync(join(FIXTURES_FOLDER, name), 'utf8').split('\n').filter((line) => line.length > 0);
}

describe('the standing reply', () => {
  const { standingReplies } = CLAUDE_CODE_ADAPTER.planOf(requestOf('builder'));

  test('denies a can_use_tool for any tool but AskUserQuestion, under its own request id', () => {
    const reply = replyFor('{"type":"control_request","request_id":"r-7","request":{"subtype":"can_use_tool","tool_name":"WebFetch","input":{}}}', standingReplies);
    expect(JSON.parse(reply ?? 'null')).toMatchObject({ type: 'control_response', response: { subtype: 'success', request_id: 'r-7', response: { behavior: 'deny' } } });
  });

  test('leaves the recorded AskUserQuestion request, and every other recorded line, unanswered', () => {
    const lines = fixtureLines('ask-user-question-live-answer.stdout.jsonl');
    expect(lines.map((line) => replyFor(line, standingReplies)).filter((reply) => reply !== null)).toEqual([]);
  });
});

describe('the lines a host sends', () => {
  const recordedStdin = fixtureLines('ask-user-question-live-answer.stdin.jsonl');

  test('a chat line is the recorded user line, byte for byte', () => {
    const recordedFirstLine = recordedStdin[0] ?? '';
    const text = (JSON.parse(recordedFirstLine) as { message: { content: string } }).message.content;
    expect(CLAUDE_CODE_ADAPTER.chatLineOf(text)).toBe(recordedFirstLine);
  });

  test('an answer line is the recorded control_response allow with the question echoed and the answers keyed by question text', () => {
    const [question] = CLAUDE_CODE_ADAPTER.eventsOf(fixtureLines('ask-user-question-live-answer.stdout.jsonl').find((line) => line.includes('"can_use_tool"')) ?? '');
    if (question?.kind !== 'question') throw new Error('the fixture holds no question');
    const answerLine = CLAUDE_CODE_ADAPTER.answerLineOf(question.requestId, question.questions, { 'Which colour should the button be?': 'Blue' });
    expect(JSON.parse(answerLine)).toEqual(JSON.parse(recordedStdin[1] ?? ''));
  });

  test('an interrupt is a control_request of subtype interrupt', () => {
    expect(JSON.parse(CLAUDE_CODE_ADAPTER.interruptLineOf())).toMatchObject({ type: 'control_request', request: { subtype: 'interrupt' } });
  });
});
