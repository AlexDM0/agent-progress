/**
 * The lifecycle components carry the names the owner decided (CLAUDE.md, Rules): no tracked file but this one, the live board and the
 * design documents names one by its retired name, in a path, an identifier or a wire literal. What matters: the scan provably read the
 * tree, the allowlist is exact both ways, and the scan catches a planted name of each kind and passes once it is gone.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { expect } from 'bun:test';

import { testWhenGitIsPresent } from './testing/ToolGuard.ts';

const REPOSITORY_ROOT = join(import.meta.dir, '..');

const THIS_FILE = 'src/ComponentNames.spec.ts';

const UNSCANNED_FOLDERS = ['.agent-progress/', 'docs/design/'];

const BINARY_FILE_PATTERN = /\.(png|jpe?g|gif|ico|woff2?)$/;

const RETIRED_NAMES = [
  'RunnerLease',
  'RunnerHandover',
  'RunnerLimits',
  'RunnerServer',
  'HostFleet',
  'HostBundle',
  'HostRecord',
  'HOST_PROTOCOL_VERSION',
  'agent-host',
  'src/services/runner',
  'cli/runner',
  'RelayInbox',
  'RelayUnderJob',
  'JobVerification',
  'verifyJob',
  'MergeSlot',
  'SlotPhase',
  'LifecyclePolicy',
  'LifecycleStep',
  'RoleCommandPolicy',
  'Reattachment',
  'BoardWatcher',
  'advanceLifecycle',
  'boot-orchestrator',
  'no-orchestrator',
  'runner-started',
  'runner-stopped',
  'runner-handover-failed',
  'host-lost',
  'host-instance',
  'host-bundle-failed',
  'lease-taken-over',
  'handing-over',
  '--login-runner',
];

/** `<file>: <retired name>` pairs a file may keep. */
const ALLOWED_RETIRED_NAMES: readonly string[] = [];

function scannedFilePaths(): string[] {
  const listing = Bun.spawnSync(['git', 'ls-files'], { cwd: REPOSITORY_ROOT });
  if (listing.exitCode !== 0) throw new Error(`git ls-files failed: ${listing.stderr.toString()}`);
  return listing.stdout.toString().split('\n').filter((filePath) => filePath !== '' && filePath !== THIS_FILE
    && !BINARY_FILE_PATTERN.test(filePath) && !UNSCANNED_FOLDERS.some((folder) => filePath.startsWith(folder)));
}

function retiredNamesIn(filePath: string, text: string): string[] {
  return RETIRED_NAMES.filter((name) => filePath.includes(name) || text.includes(name)).map((name) => `${filePath}: ${name}`);
}

testWhenGitIsPresent('the scan reads every tracked file but this one, the board and the design documents, the renamed roots among them', () => {
  const filePaths = scannedFilePaths();
  expect(filePaths.length).toBeGreaterThan(500);
  expect(filePaths).toContain('CLAUDE.md');
  expect(filePaths.some((filePath) => filePath.startsWith('src/services/overseer/'))).toBe(true);
  expect(filePaths.some((filePath) => filePath.startsWith('src/lib/watcher/'))).toBe(true);
  expect(filePaths.filter((filePath) => filePath === THIS_FILE || UNSCANNED_FOLDERS.some((folder) => filePath.startsWith(folder)))).toEqual([]);
  expect(readFileSync(join(REPOSITORY_ROOT, 'CLAUDE.md'), 'utf8')).toContain('Overseer');
});

testWhenGitIsPresent('no tracked file names a component by its retired name, beyond the exact allowlist', () => {
  const found = scannedFilePaths().flatMap((filePath) => retiredNamesIn(filePath, readFileSync(join(REPOSITORY_ROOT, filePath), 'utf8')));
  expect(found).toEqual([...ALLOWED_RETIRED_NAMES]);
});

testWhenGitIsPresent('the scan fails on a planted path, identifier and wire literal, and passes without them', () => {
  expect(retiredNamesIn('src/services/runner/Example.ts', 'export const EXAMPLE = 1;\n')).toEqual(['src/services/runner/Example.ts: src/services/runner']);
  expect(retiredNamesIn('src/Example.ts', 'import { RunnerLease } from "./Baton.ts";\n')).toEqual(['src/Example.ts: RunnerLease']);
  expect(retiredNamesIn('src/Example.ts', 'const cause = \'host-lost\';\n')).toEqual(['src/Example.ts: host-lost']);
  expect(retiredNamesIn('src/services/overseer/Example.ts', 'import { Baton } from \'./Baton.ts\';\nconst cause = \'watcher-lost\';\n')).toEqual([]);
});
