/**
 * The Seatbelt profile a process host's child runs under (design section 5.2): gates and install lines run worker-written code, so it
 * writes only the worktree, temp and the package caches, never `<data>/`, the monitor folder or the shared refs, reads none of the denied
 * paths, and reaches the network only when asked. Where `sandbox-exec` cannot apply a profile the child runs unconfined, and the caller
 * keeps its gate cache in memory.
 */
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join }  from 'node:path';

export interface ProcessSandboxRequest {
  worktree:            string;
  /** The worktree's own `<common>/worktrees/<name>/`, whose index git refreshes; `null` for a main checkout. */
  worktreeAdminFolder: string | null;
  homeDirectory:       string;
  temporaryDirectory:  string | null;
  deniedWritableRoots: readonly string[];
  /** A `*` in a path matches within one path segment. */
  deniedReadableRoots: readonly string[];
  network:             boolean;
}

export interface ProcessHostSandbox {
  /** Probed once: whether `sandbox-exec` exists and may apply a profile from inside this process. */
  isUsable:        () => boolean;
  profileTextOf:   (request: ProcessSandboxRequest) => string;
  /** `argv` unchanged when the sandbox is not usable. */
  sandboxedArgvOf: (profilePath: string, argv: readonly string[]) => string[];
}

export const SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec';

const PERMISSIVE_PROBE_PROFILE = '(version 1)(allow default)';
const PROBED_EXECUTABLE = '/usr/bin/true';
const SYSTEM_TEMPORARY_FOLDERS = ['/private/tmp', '/private/var/folders'] as const;
const PACKAGE_CACHE_FOLDERS = ['.bun', '.npm', '.cache', join('Library', 'Caches')] as const;
const REGEX_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;
const GLOB_STAR = '*';

/** Seatbelt matches resolved paths, so `/var` must read as `/private/var`; a path not there yet resolves through its nearest folder. */
function resolvedPathOf(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(resolvedPathOf(parent), basename(path));
}

function quoted(text: string): string {
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function regexEscaped(text: string): string {
  return text.replace(REGEX_SPECIAL_CHARACTERS, '\\$&');
}

/** A raw `#"…"` regex for a glob, its folder before the first `*` resolved; a plain path is a subpath. */
function filterOf(path: string): string {
  const starIndex = path.indexOf(GLOB_STAR);
  if (starIndex < 0) return `(subpath ${quoted(resolvedPathOf(path))})`;
  const fixedFolderEnd = path.lastIndexOf('/', starIndex);
  const fixedFolder = resolvedPathOf(path.slice(0, fixedFolderEnd));
  const pattern = path.slice(fixedFolderEnd).split(GLOB_STAR).map(regexEscaped).join('[^/]*');
  return `(regex #"^${regexEscaped(fixedFolder)}${pattern}$")`;
}

function profileTextOf(request: ProcessSandboxRequest): string {
  const writable = [
    request.worktree,
    ...request.worktreeAdminFolder === null ? [] : [request.worktreeAdminFolder],
    ...request.temporaryDirectory === null ? [] : [request.temporaryDirectory],
    ...SYSTEM_TEMPORARY_FOLDERS,
    ...PACKAGE_CACHE_FOLDERS.map((folder) => join(request.homeDirectory, folder)),
  ];
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${writable.map(filterOf).join(' ')} (regex #"^/dev/"))`,
    // Last, so they win over the writable folders a denied one sits inside, such as a data folder under temp.
    `(deny file-write* ${request.deniedWritableRoots.map(filterOf).join(' ')})`,
    `(deny file-read* ${request.deniedReadableRoots.map(filterOf).join(' ')})`,
    ...request.network ? [] : ['(deny network-outbound (remote ip))'],
    '',
  ].join('\n');
}

function sandboxExecApplies(): boolean {
  if (!existsSync(SANDBOX_EXEC_PATH)) return false;
  try {
    return Bun.spawnSync({ cmd: [SANDBOX_EXEC_PATH, '-p', PERMISSIVE_PROBE_PROFILE, PROBED_EXECUTABLE], stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
  } catch {
    return false;
  }
}

export function createProcessHostSandbox(): ProcessHostSandbox {
  let usable: boolean | null = null;
  const isUsable = (): boolean => {
    usable ??= sandboxExecApplies();
    return usable;
  };
  return {
    isUsable,
    profileTextOf,
    sandboxedArgvOf: (profilePath, argv) => (isUsable() ? [SANDBOX_EXEC_PATH, '-f', profilePath, ...argv] : [...argv]),
  };
}
