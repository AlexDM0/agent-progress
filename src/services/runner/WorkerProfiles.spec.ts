/**
 * The per-job profile table of design section 4.4, as the neutral data every adapter renders. What matters: every write and read deny the
 * design names is there as an absolute path; writes outside the worktree reach only the job's own relay folder; the gpg folder is narrowed
 * only when an agent socket signs; and a ticket's `network` line is the only network a worker gets, any domain staying the product
 * owner's alone. The Claude Code adapter's own spec holds that each of these paths renders `//`-anchored into the sandbox and the
 * permission rules, and how `none`, a list and `any` become `--disallowedTools`; the guard on the vendor's seam keeps that adapter out of
 * this spec.
 */
import { isAbsolute }             from 'node:path';
import { describe, expect, test } from 'bun:test';

import { type ProfiledRole, type SandboxFacts, WorkerProfiles } from './WorkerProfiles.ts';

const FACTS: SandboxFacts = {
  dataFolder:                '/example/repository/.agent-progress-v2',
  monitorFolder:             '/home/alex-example/.agent-progress-v2-monitor',
  homeDirectory:             '/home/alex-example',
  worktree:                  '/example/repository/.agent-progress-v2-worktrees/ticket-007',
  commonGitDirectory:        '/example/repository/.git',
  targetBranches:            ['main', 'group-example'],
  otherTicketBranches:       ['ticket-003', 'ticket-009'],
  otherWorktreeAdminFolders: ['/example/repository/.git/worktrees/ticket-003'],
  relayDirectory:            '/example/repository/.agent-progress-v2-worktrees/relay/J4',
  repositoryRoot:            '/example/repository',
  gitHooksDirectory:         '/example/repository/.githooks',
  commitSigning:             { kind: 'unsigned' },
};

const THIS_REPOSITORY_TOOLCHAIN_LINES = ['bun run verify', 'bun install'];

function profileOf(role: ProfiledRole, networkDomains: readonly string[] = [], facts: SandboxFacts = FACTS, toolchainLines = THIS_REPOSITORY_TOOLCHAIN_LINES) {
  return WorkerProfiles.profileOf(role, facts, networkDomains, toolchainLines);
}

describe('the allowed commands', () => {
  test('are the executables a uv board\'s checks and install lines invoke, never bun, then the git verbs', () => {
    const profile = profileOf('builder', [], FACTS, ['uv run pytest && uv run ruff check', 'uv sync']);
    expect(profile.allowedCommandPrefixes).toEqual([
      ['uv'], ['git', 'status'], ['git', 'diff'], ['git', 'log'], ['git', 'show'], ['git', 'add'], ['git', 'commit'],
    ]);
  });

  test('hold bun for this repository\'s bun run verify', () => {
    expect(profileOf('reviewer').allowedCommandPrefixes).toContainEqual(['bun']);
  });

  test('take the first word of each command split on &&, ||, ; and |, past an assignment, leaving git to its verbs', () => {
    const profile = profileOf('builder', [], FACTS, ['CI=1 make check || ./scripts/lint.sh; git diff --check | grep -q . && npx tsc']);
    expect(profile.allowedCommandPrefixes.slice(0, 4)).toEqual([['make'], ['./scripts/lint.sh'], ['grep'], ['npx']]);
    expect(profile.allowedCommandPrefixes).not.toContainEqual(['git']);
  });

  test('are none with no stored lines but the git verbs, and none at all for the orchestrator', () => {
    expect(profileOf('builder', [], FACTS, []).allowedCommandPrefixes[0]).toEqual(['git', 'status']);
    expect(profileOf('orchestrator').allowedCommandPrefixes).toEqual([]);
  });
});

describe('a builder\'s profile', () => {
  const profile = profileOf('builder');

  test.each([
    ['the data folder', '/example/repository/.agent-progress-v2'],
    ['the monitor folder', '/home/alex-example/.agent-progress-v2-monitor'],
    ['the worktree\'s .claude folder', '/example/repository/.agent-progress-v2-worktrees/ticket-007/.claude'],
    ['packed-refs', '/example/repository/.git/packed-refs'],
    ['the main line\'s ref', '/example/repository/.git/refs/heads/main'],
    ['a live group\'s ref', '/example/repository/.git/refs/heads/group-example'],
    ['another ticket branch', '/example/repository/.git/refs/heads/ticket-003'],
    ['a third ticket branch', '/example/repository/.git/refs/heads/ticket-009'],
    ['another worktree\'s admin folder', '/example/repository/.git/worktrees/ticket-003'],
  ])('denies writes to %s', (_name, path) => {
    expect(profile.deniedWritableRoots).toContain(path);
  });

  test.each([
    ['the runner token', '/example/repository/.agent-progress-v2/runner/token'],
    ['the launch files', '/example/repository/.agent-progress-v2/jobs/*/launch-*.json'],
    ['the host sockets', '/home/alex-example/.agent-progress-v2-monitor/hosts'],
    ['~/.ssh', '/home/alex-example/.ssh'],
    ['~/.aws', '/home/alex-example/.aws'],
    ['~/.gnupg, whole while commits go unsigned', '/home/alex-example/.gnupg'],
  ])('denies reads of %s', (_name, path) => {
    expect(profile.deniedReadableRoots).toContain(path);
  });

  test('writes outside its worktree only to its own relay folder, never to its own branch\'s ref or admin folder by a deny', () => {
    expect(profile.writableRoots).toEqual([]);
    expect(profile.relayDirectory).toBe('/example/repository/.agent-progress-v2-worktrees/relay/J4');
    expect(profile.deniedWritableRoots.filter((path) => path.endsWith('/ticket-007'))).toEqual([]);
  });

  test('names every path absolutely, so the adapter can anchor each at the filesystem root', () => {
    const paths = [...profile.deniedWritableRoots, ...profile.deniedReadableRoots, profile.relayDirectory, profile.instructionsRoot, profile.gitHooksDirectory];
    expect(paths.filter((path) => !isAbsolute(path))).toEqual([]);
  });

  test('narrows the ~/.gnupg read deny to the private keys when the gpg-agent socket signs, and carries the socket', () => {
    const signing = profileOf('builder', [], { ...FACTS, commitSigning: { kind: 'agent-sockets', sockets: ['/home/alex-example/.gnupg/S.gpg-agent'] } });
    expect(signing.deniedReadableRoots).toContain('/home/alex-example/.gnupg/private-keys-v1.d');
    expect(signing.deniedReadableRoots).not.toContain('/home/alex-example/.gnupg');
    expect(signing.commitSigning).toEqual({ kind: 'agent-sockets', sockets: ['/home/alex-example/.gnupg/S.gpg-agent'] });
  });

  test('may ask, runs no skills, and denies the git verbs that move history or other refs', () => {
    expect(profile).toMatchObject({ askUser: true, skills: false });
    expect(profile.deniedCommandPrefixes).toEqual(expect.arrayContaining([['git', 'push'], ['git', 'rebase'], ['git', 'branch', '-f'], ['git', '-C']]));
  });
});

describe('the network line', () => {
  test('becomes the Bash allowed domains and the WebFetch domains of a builder', () => {
    const profile = profileOf('builder', ['registry.example.com', 'docs.example.org']);
    expect(profile.bashNetworkDomains).toEqual(['registry.example.com', 'docs.example.org']);
    expect(profile.webNetworkDomains).toEqual(['registry.example.com', 'docs.example.org']);
  });

  test('absent, leaves a builder no domain and no web tool', () => {
    expect(profileOf('builder')).toMatchObject({ bashNetworkDomains: [], webNetworkDomains: 'none' });
  });

  test.each(['builder', 'reviewer', 'orchestrator'] as const)('never gives the %s every domain, which is what lets WebSearch through', (role) => {
    expect(profileOf(role, ['docs.example.org']).webNetworkDomains).not.toBe('any');
  });

  test('gives the product owner every web domain and Bash none', () => {
    expect(profileOf('product-owner', ['docs.example.org'])).toMatchObject({ webNetworkDomains: 'any', bashNetworkDomains: [] });
  });
});
