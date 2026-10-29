/**
 * The per-job confinement of design section 4.4, as the launcher port's neutral `WorkerProfile`: what a builder's sandbox and permission
 * rules deny and allow, from the paths and refs as they stand at launch. The adapter renders it; the process-host sandbox reuses its denies.
 */
import { existsSync } from 'node:fs';
import {
  basename,
  isAbsolute,
  join,
  resolve
} from 'node:path';

import type { CommitSigning, NetworkDomainGuard, WorkerProfile } from '../../lib/agent-launch/WorkerProfile.ts';
import { GitProcess }                                            from '../../lib/git/GitProcess.ts';
import { PRODUCT_NAMES }                                         from '../../shared/constants/ProductNames.ts';

/** Everything a job's confinement names, read once at launch; every path absolute. */
export interface SandboxFacts {
  dataFolder:                string;
  monitorFolder:             string;
  homeDirectory:             string;
  worktree:                  string;
  /** The repository's shared `.git`, which a linked worktree's sandbox may write except where denied. */
  commonGitDirectory:        string;
  /** The main line and every live `group-<name>` branch: the refs only a runner landing moves. */
  targetBranches:            readonly string[];
  /** Every `ticket-<id>` branch but the job's own. */
  otherTicketBranches:       readonly string[];
  /** `<common>/worktrees/<name>/` of every linked worktree but the job's own. */
  otherWorktreeAdminFolders: readonly string[];
  relayDirectory:            string;
  repositoryRoot:            string;
  gitHooksDirectory:         string;
  commitSigning:             CommitSigning;
}

export type ProfiledRole = 'builder' | 'reviewer' | 'resolver' | 'product-owner' | 'orchestrator';

const GPG_FOLDER = '.gnupg';
const GPG_PRIVATE_KEYS_FOLDER = 'private-keys-v1.d';
const GPG_AGENT_SOCKET = 'S.gpg-agent';
const CREDENTIAL_FOLDERS = ['.ssh', '.aws'] as const;
const PRODUCT_OWNER_ROLE: ProfiledRole = 'product-owner';

/** The read-only git verbs and the git a worker commits with; the toolchain comes from the board, the agent-progress verbs are the relay's. */
const WORKER_ALLOWED_COMMAND_PREFIXES: readonly (readonly string[])[] = [
  ['git', 'status'],
  ['git', 'diff'],
  ['git', 'log'],
  ['git', 'show'],
  ['git', 'add'],
  ['git', 'commit'],
];

const WORKER_DENIED_GIT_SUBCOMMANDS: readonly (readonly string[])[] = [
  ['push'],
  ['rebase'],
  ['reset'],
  ['commit', '--amend'],
  ['worktree'],
  ['update-ref'],
  ['branch', '-f'],
  ['branch', '-D'],
  ['branch', '-m'],
  ['-C'],
];

/** `||` before `|`, so it is one separator rather than two with an empty command between. */
const SHELL_COMMAND_SEPARATORS = ['&&', '||', ';', '|', '(', ')'] as const;
const SHELL_QUOTES = ['\'', '"'] as const;
const SINGLE_QUOTE = '\'';
const ESCAPE_CHARACTER = '\\';
const ENVIRONMENT_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The commands of a shell line, split on the separators and parentheses outside quotes; a backslash outside single quotes escapes one character. */
function shellCommandsOf(line: string): string[] {
  const commands: string[] = [];
  let command = '';
  let openQuote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const character = line.charAt(i);
    const separator = openQuote === null ? SHELL_COMMAND_SEPARATORS.find((candidate) => line.startsWith(candidate, i)) : undefined;
    if (character === ESCAPE_CHARACTER && openQuote !== SINGLE_QUOTE) {
      command += line.slice(i, i + 2);
      i++;
    } else if (separator !== undefined) {
      commands.push(command);
      command = '';
      i += separator.length - 1;
    } else {
      if (openQuote === null && SHELL_QUOTES.some((quote) => quote === character)) openQuote = character;
      else if (character === openQuote) openQuote = null;
      command += character;
    }
  }
  return [...commands, command];
}

/** The first word of each command in a stored shell line, split outside quotes on `&&`, `||`, `;`, `|` and parentheses, past any leading `NAME=value`. */
function executablesOf(line: string): string[] {
  return shellCommandsOf(line).flatMap((command) => {
    const executable = command.trim().split(/\s+/).find((word) => !ENVIRONMENT_ASSIGNMENT.test(word));
    return executable === undefined || executable === '' ? [] : [executable];
  });
}

/** What a worker may run unasked: the executables the board's checks and install lines invoke, then the git verbs. */
function workerAllowedCommandPrefixesOf(toolchainLines: readonly string[]): (readonly string[])[] {
  const executables = [...new Set(toolchainLines.flatMap(executablesOf))].filter((executable) => executable !== 'git');
  return [...executables.map((executable) => [executable]), ...WORKER_ALLOWED_COMMAND_PREFIXES];
}

/** The gpg-agent socket when one is there, so a worker's commit is signed with its key folder readable and only its private keys denied. */
function commitSigningOf(homeDirectory: string): CommitSigning {
  const socket = join(homeDirectory, GPG_FOLDER, GPG_AGENT_SOCKET);
  return existsSync(socket) ? { kind: 'agent-sockets', sockets: [socket] } : { kind: 'unsigned' };
}

function deniedWritableRootsOf(facts: SandboxFacts): string[] {
  const headsFolder = join(facts.commonGitDirectory, 'refs', 'heads');
  return [
    facts.dataFolder,
    facts.monitorFolder,
    join(facts.worktree, '.claude'),
    join(facts.commonGitDirectory, 'packed-refs'),
    ...facts.targetBranches.map((branch) => join(headsFolder, branch)),
    ...facts.otherTicketBranches.map((branch) => join(headsFolder, branch)),
    ...facts.otherWorktreeAdminFolders,
  ];
}

/** The launch files are named by a glob, which the sandbox and the permission rules both read as one. */
function deniedReadableRootsOf(facts: SandboxFacts): string[] {
  const gpgDenied = facts.commitSigning.kind === 'agent-sockets'
    ? join(facts.homeDirectory, GPG_FOLDER, GPG_PRIVATE_KEYS_FOLDER)
    : join(facts.homeDirectory, GPG_FOLDER);
  return [
    join(facts.dataFolder, 'runner', 'token'),
    join(facts.dataFolder, 'jobs', '*', 'launch-*.json'),
    join(facts.monitorFolder, 'hosts'),
    ...CREDENTIAL_FOLDERS.map((folder) => join(facts.homeDirectory, folder)),
    gpgDenied,
  ];
}

function webNetworkDomainsOf(role: ProfiledRole, networkDomains: readonly string[]): WorkerProfile['webNetworkDomains'] {
  if (role === PRODUCT_OWNER_ROLE) return 'any';
  return networkDomains.length === 0 ? 'none' : [...networkDomains];
}

/**
 * A builder or reviewer of a ticket: writes only its worktree (the sandbox's default) and its own relay folder, the network its line names,
 * and runs unasked the executables of `toolchainLines`, the board's stored checks and install lines.
 */
function profileOf(role: ProfiledRole, facts: SandboxFacts, networkDomains: readonly string[], toolchainLines: readonly string[]): WorkerProfile {
  const isWorker = role === 'builder' || role === 'reviewer';
  if (role === 'resolver') return resolverProfileOf(facts);
  return {
    writableRoots:          [],
    deniedWritableRoots:    deniedWritableRootsOf(facts),
    deniedReadableRoots:    deniedReadableRootsOf(facts),
    bashNetworkDomains:     isWorker ? [...networkDomains] : [],
    webNetworkDomains:      role === 'orchestrator' ? 'none' : webNetworkDomainsOf(role, networkDomains),
    relayDirectory:         facts.relayDirectory,
    allowedCommandPrefixes: isWorker ? workerAllowedCommandPrefixesOf(toolchainLines) : [],
    deniedCommandPrefixes:  isWorker ? WORKER_DENIED_GIT_SUBCOMMANDS.map((subcommand) => ['git', ...subcommand]) : [],
    askUser:                role !== 'orchestrator',
    skills:                 role === PRODUCT_OWNER_ROLE,
    subagents:              [],
    attribution:            'none',
    instructionsRoot:       facts.repositoryRoot,
    gitHooksDirectory:      facts.gitHooksDirectory,
    commitSigning:          facts.commitSigning,
    networkDomainGuard:     isWorker ? networkDomainGuardOf(networkDomains) : null,
  };
}

/**
 * The Airlock's resolver: a builder's denies and signing in the worktree it resolves, committing with the git verbs alone, never asking,
 * never reaching the network, whatever its ticket's `network` line.
 */
function resolverProfileOf(facts: SandboxFacts): WorkerProfile {
  return {
    writableRoots:          [],
    deniedWritableRoots:    deniedWritableRootsOf(facts),
    deniedReadableRoots:    deniedReadableRootsOf(facts),
    bashNetworkDomains:     [],
    webNetworkDomains:      'none',
    relayDirectory:         facts.relayDirectory,
    allowedCommandPrefixes: [...WORKER_ALLOWED_COMMAND_PREFIXES],
    deniedCommandPrefixes:  WORKER_DENIED_GIT_SUBCOMMANDS.map((subcommand) => ['git', ...subcommand]),
    askUser:                false,
    skills:                 false,
    subagents:              [],
    attribution:            'none',
    instructionsRoot:       facts.repositoryRoot,
    gitHooksDirectory:      facts.gitHooksDirectory,
    commitSigning:          facts.commitSigning,
    networkDomainGuard:     null,
  };
}

/** The `hook bash-domains` guard of design section 4.4, for a worker whose ticket has a `network` line; none without one. */
function networkDomainGuardOf(networkDomains: readonly string[]): NetworkDomainGuard | null {
  if (networkDomains.length === 0) return null;
  return {
    allowedDomains: [...networkDomains],
    commandArgv:    [PRODUCT_NAMES.PROGRAM, 'hook', 'bash-domains', '--allow', networkDomains.join(',')],
  };
}

function gitLinesOf(directory: string, gitArguments: readonly string[]): string[] {
  const run = GitProcess.run(directory, gitArguments);
  return GitProcess.succeeded(run) ? run.standardOutput.split('\n').filter((line) => line !== '') : [];
}

function commonGitDirectoryOf(repositoryRoot: string): string {
  const [commonDirectory = '.git'] = gitLinesOf(repositoryRoot, ['rev-parse', '--git-common-dir']);
  return isAbsolute(commonDirectory) ? commonDirectory : resolve(repositoryRoot, commonDirectory);
}

/** The worktree's own admin folder name, which git keeps as `<common>/worktrees/<name>`; `null` before the worktree exists. */
function adminFolderOf(worktree: string): string | null {
  const [gitDirectory] = gitLinesOf(worktree, ['rev-parse', '--absolute-git-dir']);
  return gitDirectory === undefined ? null : gitDirectory;
}

export interface SandboxFactsRequest {
  repositoryRoot: string;
  dataFolder:     string;
  monitorFolder:  string;
  homeDirectory:  string;
  worktree:       string;
  ownBranch:      string;
  mainLine:       string;
  groupPrefix:    string;
  relayDirectory: string;
}

/** Read from git at launch: a ref or worktree created later is V14's to catch, never this list's. */
function sandboxFactsOf(request: SandboxFactsRequest): SandboxFacts {
  const commonGitDirectory = commonGitDirectoryOf(request.repositoryRoot);
  const branches = gitLinesOf(request.repositoryRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
  const ownAdminFolder = adminFolderOf(request.worktree);
  const worktreesFolder = join(commonGitDirectory, 'worktrees');
  const adminFolders = gitLinesOf(request.repositoryRoot, ['worktree', 'list', '--porcelain'])
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
    .flatMap((path) => adminFolderOf(path) ?? [])
    .filter((folder) => folder.startsWith(`${worktreesFolder}/`) && folder !== ownAdminFolder)
    .map((folder) => join(worktreesFolder, basename(folder)));
  return {
    dataFolder:                request.dataFolder,
    monitorFolder:             request.monitorFolder,
    homeDirectory:             request.homeDirectory,
    worktree:                  request.worktree,
    commonGitDirectory,
    targetBranches:            [request.mainLine, ...branches.filter((branch) => branch.startsWith(request.groupPrefix))],
    otherTicketBranches:       branches.filter((branch) => branch.startsWith('ticket-') && branch !== request.ownBranch),
    otherWorktreeAdminFolders: adminFolders,
    relayDirectory:            request.relayDirectory,
    repositoryRoot:            request.repositoryRoot,
    gitHooksDirectory:         join(request.repositoryRoot, '.githooks'),
    commitSigning:             commitSigningOf(request.homeDirectory),
  };
}

export const WorkerProfiles = Object.freeze({
  profileOf,
  sandboxFactsOf,
  deniedWritableRootsOf,
  deniedReadableRootsOf,
});
