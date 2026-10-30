/**
 * The one module that reads `process.env`; nothing else may.
 * Every read is a getter rather than a value captured at import, and nothing is memoised, so a spec
 * can redirect a variable in-process. The product's own variables are named from its environment prefix, so a build linked beside the
 * released program never reads the released program's root.
 */
import { PRODUCT_NAMES, type ProductNames } from './constants/ProductNames.ts';

export function rootOverrideVariableOf({ ENVIRONMENT_PREFIX }: Pick<ProductNames, 'ENVIRONMENT_PREFIX'>): string {
  return `${ENVIRONMENT_PREFIX}ROOT`;
}

export function everyToolRequiredVariableOf({ ENVIRONMENT_PREFIX }: Pick<ProductNames, 'ENVIRONMENT_PREFIX'>): string {
  return `${ENVIRONMENT_PREFIX}REQUIRE_EVERY_TOOL`;
}

export function fakeAgentVariableOf({ ENVIRONMENT_PREFIX }: Pick<ProductNames, 'ENVIRONMENT_PREFIX'>): string {
  return `${ENVIRONMENT_PREFIX}FAKE_AGENT`;
}

export const FAKE_AGENT_VARIABLE = fakeAgentVariableOf(PRODUCT_NAMES);

/**
 * Launches every session the runner starts as the scripted fake agent rather than a vendor's CLI, so a spec-spawned binary spends no
 * subscription; `cli/testing/CliProcess.ts` sets it on every child. Read like the every-tool switch.
 */
export function fakeAgentIsOn(): boolean {
  return switchIsOn(FAKE_AGENT_VARIABLE);
}

export const ROOT_OVERRIDE_VARIABLE = rootOverrideVariableOf(PRODUCT_NAMES);

export const EVERY_TOOL_REQUIRED_VARIABLE = everyToolRequiredVariableOf(PRODUCT_NAMES);

const USER_SHELL_VARIABLE = 'SHELL';
const EXECUTABLE_SEARCH_PATH_VARIABLE = 'PATH';
const EXECUTABLE_SEARCH_PATH_SEPARATOR = ':';

/**
 * Turns every spec the tool guard (`src/testing/ToolGuard.ts`) would skip for a missing tool into a failure, for a run on a machine that
 * must prove every claim. Any value but empty, whitespace or `0` requires, so a `true` or `yes` is never a silent skip.
 */
export function everyToolIsRequired(): boolean {
  return switchIsOn(EVERY_TOOL_REQUIRED_VARIABLE);
}

/** A copy of the whole environment, for a child process that should inherit it with a variable or two replaced; a variable without a value is left out. */
export function environmentCopy(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function switchIsOn(variable: string): boolean {
  const value = process.env[variable]?.trim();
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

export function jobIdVariableOf({ ENVIRONMENT_PREFIX }: Pick<ProductNames, 'ENVIRONMENT_PREFIX'>): string {
  return `${ENVIRONMENT_PREFIX}JOB_ID`;
}

export function relayDirectoryVariableOf({ ENVIRONMENT_PREFIX }: Pick<ProductNames, 'ENVIRONMENT_PREFIX'>): string {
  return `${ENVIRONMENT_PREFIX}RELAY_DIRECTORY`;
}

export const JOB_ID_VARIABLE = jobIdVariableOf(PRODUCT_NAMES);

export const RELAY_DIRECTORY_VARIABLE = relayDirectoryVariableOf(PRODUCT_NAMES);

/** The runner's job this process runs under, set on every session it launches; empty or whitespace-only reads as unset. */
export function runnerJobId(): string | undefined {
  return nonBlankValueOf(JOB_ID_VARIABLE);
}

/** The job's relay folder, the one place outside its working directory the session may write; empty or whitespace-only reads as unset. */
export function relayDirectory(): string | undefined {
  return nonBlankValueOf(RELAY_DIRECTORY_VARIABLE);
}

function nonBlankValueOf(variable: string): string | undefined {
  const value = process.env[variable];
  if (value === undefined || value.trim().length === 0) return undefined;
  return value;
}

/** The folders of `PATH`, in order, empty entries left out: the executables a gate's cache path must never let a branch replace. */
export function executableSearchPath(): string[] {
  return (process.env[EXECUTABLE_SEARCH_PATH_VARIABLE] ?? '').split(EXECUTABLE_SEARCH_PATH_SEPARATOR).filter((folder) => folder !== '');
}

/** The one write to this process's environment outside a spec, for the test preload that puts the `claude` trap ahead of every real `claude`. */
export function prependToExecutableSearchPath(folder: string): void {
  process.env[EXECUTABLE_SEARCH_PATH_VARIABLE] = [folder, ...executableSearchPath()].join(EXECUTABLE_SEARCH_PATH_SEPARATOR);
}

/** The user's shell, which runs a gate's checks line; an empty or whitespace-only value reads as unset, and the caller picks a default. */
export function userShell(): string | undefined {
  const value = process.env[USER_SHELL_VARIABLE];
  if (value === undefined || value.trim().length === 0) return undefined;
  return value;
}
