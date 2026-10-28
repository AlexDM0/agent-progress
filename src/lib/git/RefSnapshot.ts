/**
 * Every ref and every worktree's HEAD at one moment, and the difference between two such moments: what moved that the caller did not
 * allow to move, so a ref changed behind the caller's back is named rather than missed.
 */
import { GitProcess } from './GitProcess.ts';

const FIELD_SEPARATOR = '\0';

const WORKTREE_LINE_PREFIX = 'worktree ';
const HEAD_LINE_PREFIX     = 'HEAD ';

export interface RefSnapshot {
  refs:          Readonly<Record<string, string>>;
  worktreeHeads: Readonly<Record<string, string>>;
}

export type RefSnapshotReading =
  | { verdict: 'read'; snapshot: RefSnapshot }
  | { verdict: 'git-failed'; reason: string };

export interface AllowedMovements {
  refs:          readonly string[];
  worktreePaths: readonly string[];
}

export interface RefMovement {
  kind:   'ref' | 'worktree-head';
  name:   string;
  before: string | null;
  after:  string | null;
}

function refsOf(output: string): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const [refName, objectName] = line.split(FIELD_SEPARATOR);
    if (refName !== undefined && objectName !== undefined && refName !== '') refs[refName] = objectName;
  }
  return refs;
}

// `-z` ends each attribute line with NUL and each worktree with an empty field; a worktree with no HEAD yet (unborn) is left out.
function worktreeHeadsOf(output: string): Record<string, string> {
  const worktreeHeads: Record<string, string> = {};
  let worktreePath: string | null = null;
  for (const field of output.split('\0')) {
    if (field.startsWith(WORKTREE_LINE_PREFIX)) worktreePath = field.slice(WORKTREE_LINE_PREFIX.length);
    else if (field.startsWith(HEAD_LINE_PREFIX) && worktreePath !== null) worktreeHeads[worktreePath] = field.slice(HEAD_LINE_PREFIX.length);
    else if (field === '') worktreePath = null;
  }
  return worktreeHeads;
}

export function takeRefSnapshot(repositoryDirectory: string): RefSnapshotReading {
  const refArguments = ['for-each-ref', '--format=%(refname)%00%(objectname)'];
  const refRun       = GitProcess.run(repositoryDirectory, refArguments);
  if (!GitProcess.succeeded(refRun)) return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(refRun, refArguments) };
  const worktreeArguments = ['worktree', 'list', '--porcelain', '-z'];
  const worktreeRun       = GitProcess.run(repositoryDirectory, worktreeArguments);
  if (!GitProcess.succeeded(worktreeRun)) return { verdict: 'git-failed', reason: GitProcess.failureReasonOf(worktreeRun, worktreeArguments) };
  return { verdict: 'read', snapshot: { refs: refsOf(refRun.standardOutput), worktreeHeads: worktreeHeadsOf(worktreeRun.standardOutput) } };
}

function movementsBetween(
  kind: RefMovement['kind'],
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
  allowedNames: readonly string[],
): RefMovement[] {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return names.flatMap((name) => {
    const beforeCommit = Object.hasOwn(before, name) ? before[name] ?? null : null;
    const afterCommit  = Object.hasOwn(after, name) ? after[name] ?? null : null;
    if (beforeCommit === afterCommit || allowedNames.includes(name)) return [];
    return [{
      kind, name, before: beforeCommit, after: afterCommit
    }];
  });
}

/** A ref created or deleted moves too, from or to `null`. */
export function refsMovedOutside(before: RefSnapshot, after: RefSnapshot, allowed: AllowedMovements): RefMovement[] {
  return [
    ...movementsBetween('ref', before.refs, after.refs, allowed.refs),
    ...movementsBetween('worktree-head', before.worktreeHeads, after.worktreeHeads, allowed.worktreePaths),
  ];
}
