/**
 * The Seatbelt profile a gate or install line runs under. What matters: the denied folders come after the writable ones, so a data folder
 * inside temp stays denied; a launch-file glob denies reads within one path segment only; the network is off unless asked; the argv is
 * wrapped only where `sandbox-exec` applies; and, where it does, a child really cannot write the data folder or read a launch file. With no
 * cache path stored a gate writes only worktree, admin folder and temp; a stored one is added unless it is, sits in or holds a `bin` or
 * `PATH` folder, and no `bin` beside its ancestors or inside it is ever writable, however the scratch home lies under temp.
 */
import {
  existsSync,
  mkdirSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { createScratchDirectory, removeScratchDirectory }                          from '../../testing/ScratchWorkspace.ts';
import { testWhenSandboxExecApplies }                                              from '../../testing/ToolGuard.ts';
import { type ProcessSandboxRequest, SANDBOX_EXEC_PATH, createProcessHostSandbox } from './ProcessHostSandbox.ts';

let scratch = '';

function requestIn(folder: string, network: boolean, cachePaths: readonly string[] = []): ProcessSandboxRequest {
  return {
    worktree:             join(folder, 'worktree'),
    worktreeAdminFolder:  null,
    homeDirectory:        join(folder, 'home'),
    temporaryDirectory:   null,
    cachePaths,
    executableSearchPath: [join(folder, 'home', '.local', 'tools')],
    deniedWritableRoots:  [join(folder, 'data')],
    deniedReadableRoots:  [join(folder, 'data', 'jobs', '*', 'launch-*.json')],
    network,
  };
}

function allowedWriteLineOf(profile: string): string {
  return profile.split('\n').find((line) => line.startsWith('(allow file-write*')) ?? '';
}

beforeEach(() => {
  scratch = createScratchDirectory('sandbox');
  mkdirSync(join(scratch, 'worktree'), { recursive: true });
  mkdirSync(join(scratch, 'data', 'jobs', 'J1'), { recursive: true });
  writeFileSync(join(scratch, 'data', 'jobs', 'J1', 'launch-1.json'), 'example secret');
  writeFileSync(join(scratch, 'data', 'jobs', 'J1', 'events-1.ndjson'), 'example events');
});

afterEach(() => {
  removeScratchDirectory(scratch);
});

describe('the profile text', () => {
  test('denies writes to the denied roots after allowing the writable ones, and reads of a launch-file glob within one segment', () => {
    const profile = createProcessHostSandbox().profileTextOf(requestIn(scratch, false));
    const lines = profile.split('\n');
    const allowIndex = lines.findIndex((line) => line.startsWith('(allow file-write*'));
    const denyIndex = lines.findIndex((line) => line.startsWith('(deny file-write* (subpath'));
    expect(allowIndex).toBeGreaterThan(0);
    expect(denyIndex).toBeGreaterThan(allowIndex);
    expect(lines[denyIndex]).toContain('/data"');
    expect(profile).toMatch(/\(deny file-read\* \(regex #"\^.*\/jobs\/\[\^\/\]\*\/launch-\[\^\/\]\*\\\.json\$"\)\)/);
  });

  test('with no cache path stored, lets a gate write exactly its worktree, its admin folder and temp', () => {
    const request = { ...requestIn(scratch, false), worktreeAdminFolder: join(scratch, 'admin'), temporaryDirectory: join(scratch, 'temp') };
    const resolvedScratch = realpathSync(scratch);
    expect(allowedWriteLineOf(createProcessHostSandbox().profileTextOf(request))).toBe(
      `(allow file-write* (subpath "${resolvedScratch}/worktree") (subpath "${resolvedScratch}/admin") (subpath "${resolvedScratch}/temp")`
      + ' (subpath "/private/tmp") (subpath "/private/var/folders") (regex #"^/dev/"))',
    );
  });

  test('adds a stored cache path, home-relative or absolute, and drops one that is, sits in or holds a bin or PATH folder', () => {
    mkdirSync(join(scratch, 'home', '.bun', 'bin'), { recursive: true });
    const absoluteCache = join(scratch, 'shared-cache');
    const profile = createProcessHostSandbox().profileTextOf(requestIn(scratch, false, [
      '~/.bun/install/cache', absoluteCache, '~/.bun', '~/.bun/bin', '~/.local', '~/.local/tools/cache',
    ]));
    const resolvedHome = join(realpathSync(scratch), 'home');
    const allowed = allowedWriteLineOf(profile);
    expect(allowed).toContain(`(subpath "${resolvedHome}/.bun/install/cache")`);
    expect(allowed).toContain(`(subpath "${realpathSync(scratch)}/shared-cache")`);
    expect(allowed).not.toContain(`(subpath "${resolvedHome}/.bun")`);
    expect(allowed).not.toContain('/.bun/bin');
    expect(allowed).not.toContain('/.local');
    expect(profile).toContain(`(subpath "${resolvedHome}/.bun/bin")`);
  });

  test('turns the network off unless the request asks for it', () => {
    const sandbox = createProcessHostSandbox();
    expect(sandbox.profileTextOf(requestIn(scratch, false))).toContain('(deny network-outbound (remote ip))');
    expect(sandbox.profileTextOf(requestIn(scratch, true))).not.toContain('network-outbound');
  });

  test('wraps the argv in sandbox-exec exactly when the sandbox applies here', () => {
    const sandbox = createProcessHostSandbox();
    const argv = sandbox.sandboxedArgvOf('/example/profile.sb', ['/bin/sh', '-c', 'true']);
    expect(argv).toEqual(sandbox.isUsable() ? [SANDBOX_EXEC_PATH, '-f', '/example/profile.sb', '/bin/sh', '-c', 'true'] : ['/bin/sh', '-c', 'true']);
  });
});

describe('a child under the profile', () => {
  test('writes its worktree but not the data folder, and reads an event log but not a launch file, where the sandbox applies', () => {
    const sandbox = createProcessHostSandbox();
    const profilePath = join(scratch, 'profile.sb');
    writeFileSync(profilePath, sandbox.profileTextOf(requestIn(scratch, false)));
    const script = [
      `echo example > "${scratch}/worktree/written" && echo worktree-written`,
      `echo example > "${scratch}/data/written" && echo data-written`,
      `cat "${scratch}/data/jobs/J1/events-1.ndjson" >/dev/null && echo events-read`,
      `cat "${scratch}/data/jobs/J1/launch-1.json" >/dev/null && echo launch-read`,
    ].join('; ');
    const output = Bun.spawnSync({ cmd: sandbox.sandboxedArgvOf(profilePath, ['/bin/sh', '-c', script]), stderr: 'ignore' }).stdout.toString().split('\n');
    const expected = sandbox.isUsable() ? ['worktree-written', 'events-read'] : ['worktree-written', 'data-written', 'events-read', 'launch-read'];
    expect(output.filter((line) => line !== '')).toEqual(expected);
  });

  testWhenSandboxExecApplies('writes a stored cache path but no bin folder beside its ancestors or inside it', () => {
    const sandbox = createProcessHostSandbox();
    const home = join(scratch, 'home');
    for (const folder of [join('.bun', 'bin'), join('.bun', 'install', 'bin'), join('.bun', 'install', 'cache')]) mkdirSync(join(home, folder), { recursive: true });
    const profilePath = join(scratch, 'profile.sb');
    writeFileSync(profilePath, sandbox.profileTextOf(requestIn(scratch, false, ['~/.bun/install/cache'])));
    const script = [
      `echo example > "${home}/.bun/install/cache/written" && echo cache-written`,
      `echo example > "${home}/.bun/bin/bun" && echo bun-bin-written`,
      `echo example > "${home}/.bun/install/bin/tool" && echo install-bin-written`,
      `mkdir -p "${home}/.bun/install/cache/package/bin" && echo example > "${home}/.bun/install/cache/package/bin/tool" && echo cache-bin-written`,
    ].join('; ');
    const output = Bun.spawnSync({ cmd: sandbox.sandboxedArgvOf(profilePath, ['/bin/sh', '-c', script]), stderr: 'ignore' }).stdout.toString().split('\n');
    expect(output.filter((line) => line !== '')).toEqual(['cache-written']);
    expect(existsSync(join(home, '.bun', 'bin', 'bun'))).toBe(false);
  });
});
