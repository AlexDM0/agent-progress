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

import type { CommitSigning, WorkerProfile } from '../../lib/agent-launch/WorkerProfile.ts';
import { GitProcess }                        from '../../lib/git/GitProcess.ts';

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

export type ProfiledRole = 'builder' | 'reviewer' | 'product-owner' | 'orchestrator';

const GPG_FOLDER = '.gnupg';
const GPG_PRIVATE_KEYS_FOLDER = 'private-keys-v1.d';
const GPG_AGENT_SOCKET = 'S.gpg-agent';
const CREDENTIAL_FOLDERS = ['.ssh', '.aws'] as const;
const PRODUCT_OWNER_ROLE: ProfiledRole = 'product-owner';

/** Toolchain and the git a worker commits with; the agent-progress verbs are the relay's to judge. */
const WORKER_ALLOWED_COMMAND_PREFIXES: readonly (readonly string[])[] = [
  ['bun'],
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

/** A builder or reviewer of a ticket: writes only its worktree (the sandbox's default) and its own relay folder, the network its line names. */
function profileOf(role: ProfiledRole, facts: SandboxFacts, networkDomains: readonly string[]): WorkerProfile {
  const isWorker = role === 'builder' || role === 'reviewer';
  return {
    writableRoots:          [],
    deniedWritableRoots:    deniedWritableRootsOf(facts),
    deniedReadableRoots:    deniedReadableRootsOf(facts),
    bashNetworkDomains:     isWorker ? [...networkDomains] : [],
    webNetworkDomains:      role === 'orchestrator' ? 'none' : webNetworkDomainsOf(role, networkDomains),
    relayDirectory:         facts.relayDirectory,
    allowedCommandPrefixes: isWorker ? WORKER_ALLOWED_COMMAND_PREFIXES : [],
    deniedCommandPrefixes:  isWorker ? WORKER_DENIED_GIT_SUBCOMMANDS.map((subcommand) => ['git', ...subcommand]) : [],
    askUser:                role !== 'orchestrator',
    skills:                 role === PRODUCT_OWNER_ROLE,
    subagents:              [],
    attribution:            'none',
    instructionsRoot:       facts.repositoryRoot,
    gitHooksDirectory:      facts.gitHooksDirectory,
    commitSigning:          facts.commitSigning,
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
