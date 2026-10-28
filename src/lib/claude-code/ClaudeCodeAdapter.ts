/**
 * The launcher port's Claude Code adapter: renders a job's `claude -p` command line, settings, agents, MCP and role files from a neutral
 * profile, and writes the stream-json lines a host sends the session. Pure: the host writes the files and spawns the argv.
 */
import { createHash }    from 'node:crypto';
import { dirname, join } from 'node:path';

import type { AgentAdapter }                             from '../agent-launch/AgentAdapter.ts';
import type { AgentLaunchPlan, StandingReply }           from '../agent-launch/AgentLaunchPlan.ts';
import type { AgentLaunchRequest }                       from '../agent-launch/AgentLaunchRequest.ts';
import type { AgentDefinition, WorkerProfile }           from '../agent-launch/WorkerProfile.ts';
import { CLAUDE_CODE_CAPABILITIES, CLAUDE_STREAM_LINES } from './ClaudeStreamLines.ts';

export const CLAUDE_CODE_VENDOR = 'claude-code';

export const CLAUDE_JOB_FILE_NAMES = {
  settings:     'settings.json',
  agents:       'agents.json',
  mcp:          'mcp.json',
  role:         'role.md',
  reportSchema: 'report.schema.json',
} as const;

/** A parent Claude Code session's variables, which change a nested session's tools; a launched session never carries them. */
export const CLAUDE_NESTING_VARIABLES = ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_SIMPLE'] as const;

const QUESTION_TOOL_NAME = 'AskUserQuestion';
const INSTRUCTION_FILE_NAMES = ['CLAUDE.md', 'CLAUDE.local.md', join('.claude', 'CLAUDE.md')] as const;
const UUID_HEXADECIMAL_DIGITS = 32;
const UUID_GROUPS = /^(.{8})(.{4})(.{4})(.{4})(.{12})$/;
const UUID_VERSION_DIGIT_INDEX = 12;
const UUID_VARIANT_DIGIT_INDEX = 16;
/** RFC 9562 version 8, a vendor-specific layout: the digits are a hash, not random. */
const UUID_NAME_HASH_VERSION = '8';
const UUID_VARIANT_BITS = 0b1000;
const UUID_VARIANT_MASK = 0b0011;
const HEXADECIMAL_RADIX = 16;
const LOOPBACK_DOMAINS = ['localhost', '127.0.0.1'] as const;
const STANDING_DENIAL_MESSAGE = 'Permission requests are not answered for this session; work within the tools and paths already allowed.';

/** The session id a job keeps across every host instance and resume: a UUID formatted from `sha256(scope + "\n" + jobId)`. */
export function claudeSessionIdOf(scope: string, jobId: string): string {
  const digits = createHash('sha256').update(`${scope}\n${jobId}`).digest('hex').slice(0, UUID_HEXADECIMAL_DIGITS).split('');
  digits[UUID_VERSION_DIGIT_INDEX] = UUID_NAME_HASH_VERSION;
  const variantDigit = Number.parseInt(digits[UUID_VARIANT_DIGIT_INDEX] ?? '0', HEXADECIMAL_RADIX);
  digits[UUID_VARIANT_DIGIT_INDEX] = (UUID_VARIANT_BITS | (variantDigit & UUID_VARIANT_MASK)).toString(HEXADECIMAL_RADIX);
  return digits.join('').replace(UUID_GROUPS, '$1-$2-$3-$4-$5');
}

/** In a settings file a single leading slash anchors at the file's folder; `//` anchors at the filesystem root. */
function rootAnchored(absolutePath: string): string {
  return `/${absolutePath}`;
}

function commandPatternOf(prefix: readonly string[]): string {
  return `Bash(${prefix.join(' ')} *)`;
}

function fileRulesOf(tools: readonly string[], path: string): string[] {
  return tools.flatMap((tool) => [`${tool}(${rootAnchored(path)})`, `${tool}(${rootAnchored(path)}/**)`]);
}

function allowRulesOf(profile: WorkerProfile, workingDirectory: string): string[] {
  const webDomains = Array.isArray(profile.webNetworkDomains) ? profile.webNetworkDomains : [];
  return [
    'Read',
    'Agent',
    `Edit(${rootAnchored(workingDirectory)}/**)`,
    `Write(${rootAnchored(workingDirectory)}/**)`,
    ...profile.allowedCommandPrefixes.map(commandPatternOf),
    ...webDomains.map((domain) => `WebFetch(domain:${domain})`),
  ];
}

function denyRulesOf(profile: WorkerProfile): string[] {
  const loopbackFetches = profile.webNetworkDomains === 'any' ? LOOPBACK_DOMAINS.map((domain) => `WebFetch(domain:${domain})`) : [];
  return [
    ...profile.deniedWritableRoots.flatMap((root) => fileRulesOf(['Edit', 'Write'], root)),
    ...profile.deniedReadableRoots.flatMap((root) => fileRulesOf(['Read'], root)),
    ...profile.deniedCommandPrefixes.map(commandPatternOf),
    ...loopbackFetches,
  ];
}

/** Every instruction file in the folders above the repository, the home folder's own `.claude/CLAUDE.md` included, so none reaches a session. */
function instructionFileExclusionsOf(instructionsRoot: string, homeDirectory: string | undefined): string[] {
  const ancestors: string[] = [];
  for (let folder = dirname(instructionsRoot); !ancestors.includes(folder); folder = dirname(folder)) ancestors.push(folder);
  const exclusions = ancestors.flatMap((folder) => INSTRUCTION_FILE_NAMES.map((fileName) => join(folder, fileName)));
  const userInstructions = homeDirectory === undefined ? null : join(homeDirectory, '.claude', 'CLAUDE.md');
  return userInstructions === null || exclusions.includes(userInstructions) ? exclusions : [...exclusions, userInstructions];
}

function sandboxOf(profile: WorkerProfile): Record<string, unknown> {
  const signingSockets = profile.commitSigning.kind === 'agent-sockets' ? { allowUnixSockets: profile.commitSigning.sockets.map(rootAnchored) } : {};
  return {
    enabled:                  true,
    failIfUnavailable:        true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: true,
    network:                  { allowedDomains: profile.bashNetworkDomains, strictAllowlist: true, ...signingSockets },
    filesystem:               {
      allowWrite: [profile.relayDirectory, ...profile.writableRoots].map(rootAnchored),
      denyWrite:  profile.deniedWritableRoots.map(rootAnchored),
      denyRead:   profile.deniedReadableRoots.map(rootAnchored),
    },
  };
}

function settingsOf(request: AgentLaunchRequest): Record<string, unknown> {
  const { profile } = request;
  const homeDirectory = Object.hasOwn(request.environment, 'HOME') ? request.environment['HOME'] : undefined;
  return {
    includeCoAuthoredBy: false,
    attribution:         { commit: '', pr: '' },
    autoMemoryEnabled:   false,
    claudeMdExcludes:    instructionFileExclusionsOf(profile.instructionsRoot, homeDirectory),
    sandbox:             sandboxOf(profile),
    permissions:         { allow: allowRulesOf(profile, request.workingDirectory), deny: denyRulesOf(profile) },
  };
}

const READ_ONLY_SUBAGENT = {
  description: 'Named lookups: finds files and lines by searching with rg, grep or find, and reads them.',
  prompt:      'You search the working directory with Read and Bash rg, grep or find, change nothing, and report what you found briefly.',
  tools:       ['Read', 'Bash(rg *)', 'Bash(grep *)', 'Bash(find *)'],
} as const;

const EDITING_SUBAGENT = {
  description: 'Reads and edits code for a task its parent describes.',
  prompt:      'You read and edit files for the task you are given, and report what you changed briefly.',
  tools:       ['Read', 'Edit', 'Write', 'Bash'],
} as const;

function agentsOf(subagents: readonly AgentDefinition[]): Record<string, unknown> {
  return Object.fromEntries(subagents.map((subagent) => {
    const { description, prompt, tools } = subagent.readOnly ? READ_ONLY_SUBAGENT : EDITING_SUBAGENT;
    return [subagent.name, {
      description, prompt, model: subagent.model, effort: subagent.effort, tools
    }];
  }));
}

/** `core.hooksPath` always; `commit.gpgsign=false` only when no signing allowance lets the sandboxed git sign. */
function gitConfigurationOf(profile: WorkerProfile): Record<string, string> {
  const settings: (readonly [string, string])[] = [['core.hooksPath', profile.gitHooksDirectory]];
  if (profile.commitSigning.kind === 'unsigned') settings.push(['commit.gpgsign', 'false']);
  return {
    GIT_CONFIG_COUNT: String(settings.length),
    ...Object.fromEntries(settings.flatMap(([key, value], i) => [[`GIT_CONFIG_KEY_${i}`, key], [`GIT_CONFIG_VALUE_${i}`, value]])),
  };
}

function childEnvironmentOf(request: AgentLaunchRequest): Record<string, string> {
  const environment = Object.fromEntries(Object.entries(request.environment)
    .filter(([name]) => !(CLAUDE_NESTING_VARIABLES as readonly string[]).includes(name)));
  return { ...environment, ...gitConfigurationOf(request.profile) };
}

function disallowedToolsOf(profile: WorkerProfile): string[] {
  return [
    ...profile.webNetworkDomains === 'any' ? [] : ['WebSearch'],
    ...profile.webNetworkDomains === 'none' ? ['WebFetch'] : [],
    ...profile.askUser ? [] : [QUESTION_TOOL_NAME],
  ];
}

function argvOf(request: AgentLaunchRequest, pathOf: (fileName: string) => string): string[] {
  const disallowedTools = disallowedToolsOf(request.profile);
  return [
    'claude',
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    ...request.resume ? ['--resume', request.sessionId] : ['--session-id', request.sessionId],
    '--model',
    request.model,
    '--effort',
    request.effort,
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--mcp-config',
    pathOf(CLAUDE_JOB_FILE_NAMES.mcp),
    '--settings',
    pathOf(CLAUDE_JOB_FILE_NAMES.settings),
    '--agents',
    pathOf(CLAUDE_JOB_FILE_NAMES.agents),
    '--append-system-prompt-file',
    pathOf(CLAUDE_JOB_FILE_NAMES.role),
    ...request.reportSchema === null ? [] : ['--json-schema', jsonTextOf(request.reportSchema)],
    '--permission-mode',
    'auto',
    '--permission-prompt-tool',
    'stdio',
    ...request.profile.skills ? [] : ['--disable-slash-commands'],
    ...disallowedTools.length === 0 ? [] : ['--disallowedTools', disallowedTools.join(',')],
  ];
}

function jsonTextOf(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Every permission request but a question is denied at once, so no session waits on a host nobody watches. */
const DENY_EVERY_PERMISSION_BUT_A_QUESTION: StandingReply = {
  whenAllEqual:  { 'type': 'control_request', 'request.subtype': 'can_use_tool' },
  whenNoneEqual: { 'request.tool_name': QUESTION_TOOL_NAME },
  replyTemplate: JSON.stringify({
    type:     'control_response',
    response: { subtype: 'success', request_id: '{{request_id}}', response: { behavior: 'deny', message: STANDING_DENIAL_MESSAGE } },
  }),
};

function planOf(request: AgentLaunchRequest): AgentLaunchPlan {
  const pathOf = (fileName: string): string => join(request.jobFilesDirectory, fileName);
  const reportSchemaFiles = request.reportSchema === null ? [] : [{ path: pathOf(CLAUDE_JOB_FILE_NAMES.reportSchema), text: jsonTextOf(request.reportSchema) }];
  return {
    argv:        argvOf(request, pathOf),
    environment: childEnvironmentOf(request),
    files:       [
      { path: pathOf(CLAUDE_JOB_FILE_NAMES.settings), text: jsonTextOf(settingsOf(request)) },
      { path: pathOf(CLAUDE_JOB_FILE_NAMES.agents), text: jsonTextOf(agentsOf(request.profile.subagents)) },
      { path: pathOf(CLAUDE_JOB_FILE_NAMES.mcp), text: jsonTextOf({ mcpServers: {} }) },
      { path: pathOf(CLAUDE_JOB_FILE_NAMES.role), text: request.roleBrief },
      ...reportSchemaFiles,
    ],
    standingReplies: [DENY_EVERY_PERMISSION_BUT_A_QUESTION],
  };
}

export const CLAUDE_CODE_ADAPTER: AgentAdapter = Object.freeze({
  vendor:       CLAUDE_CODE_VENDOR,
  capabilities: CLAUDE_CODE_CAPABILITIES,
  planOf,
  sessionIdOf:  claudeSessionIdOf,
  ...CLAUDE_STREAM_LINES,
});
