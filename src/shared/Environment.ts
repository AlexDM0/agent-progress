/**
 * The one module that reads `process.env`; nothing else may.
 * Every read is a getter rather than a value captured at import, and nothing is memoised, so a spec
 * can redirect a variable in-process.
 */

const ROOT_OVERRIDE_VARIABLE = 'AGENT_PROGRESS_ROOT';

const EVERY_TOOL_REQUIRED_VARIABLE = 'AGENT_PROGRESS_REQUIRE_EVERY_TOOL';

const USER_SHELL_VARIABLE = 'SHELL';

/**
 * Turns every spec the tool guard (`src/testing/ToolGuard.ts`) would skip for a missing tool into a failure, for a run on a machine that
 * must prove every claim. Any value but empty, whitespace or `0` requires, so a `true` or `yes` is never a silent skip.
 */
export function everyToolIsRequired(): boolean {
  const value = process.env[EVERY_TOOL_REQUIRED_VARIABLE]?.trim();
  return value !== undefined && value.length > 0 && value !== '0';
}

/**
 * Overrides the walk `src/services/tracker/Workspace.ts` would do; an empty or whitespace-only value reads as unset, because an empty root is
 * a relative path.
 */
export function agentProgressRootOverride(): string | undefined {
  const value = process.env[ROOT_OVERRIDE_VARIABLE];
  if (value === undefined || value.trim().length === 0) return undefined;
  return value;
}

/** The user's shell, which runs the check command `release` runs; an empty or whitespace-only value reads as unset, and the caller picks a default. */
export function userShell(): string | undefined {
  const value = process.env[USER_SHELL_VARIABLE];
  if (value === undefined || value.trim().length === 0) return undefined;
  return value;
}
