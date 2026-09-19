/**
 * The one module that reads `process.env`; a guard spec fails the build on a read anywhere else.
 * Every read is a getter rather than a value captured at import, and nothing is memoised, so a spec
 * can redirect a variable in-process.
 */

const ROOT_OVERRIDE_VARIABLE = 'AGENT_PROGRESS_ROOT';

/** Overrides the walk `lib/platform/Workspace.ts` would do; an empty or whitespace-only value reads as unset, because an empty root is a relative path. */
export function agentProgressRootOverride(): string | undefined {
  const value = process.env[ROOT_OVERRIDE_VARIABLE];
  if (value === undefined || value.trim().length === 0) return undefined;
  return value;
}
