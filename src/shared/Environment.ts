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

export function realAgentSpecsVariableOf({ ENVIRONMENT_PREFIX }: Pick<ProductNames, 'ENVIRONMENT_PREFIX'>): string {
  return `${ENVIRONMENT_PREFIX}REAL_AGENT_SPECS`;
}

export const ROOT_OVERRIDE_VARIABLE = rootOverrideVariableOf(PRODUCT_NAMES);

export const REAL_AGENT_SPECS_VARIABLE = realAgentSpecsVariableOf(PRODUCT_NAMES);

export const EVERY_TOOL_REQUIRED_VARIABLE = everyToolRequiredVariableOf(PRODUCT_NAMES);

const USER_SHELL_VARIABLE = 'SHELL';

/**
 * Turns every spec the tool guard (`src/testing/ToolGuard.ts`) would skip for a missing tool into a failure, for a run on a machine that
 * must prove every claim. Any value but empty, whitespace or `0` requires, so a `true` or `yes` is never a silent skip.
 */
export function everyToolIsRequired(): boolean {
  return switchIsOn(EVERY_TOOL_REQUIRED_VARIABLE);
}

/**
 * Opts into the specs that launch a real coding agent, which spend the machine's subscription; read like the every-tool switch. Requiring
 * every tool never opts in: a spec left off by this switch is skipped, not failed.
 */
export function realAgentSpecsAreOn(): boolean {
  return switchIsOn(REAL_AGENT_SPECS_VARIABLE);
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

/** The user's shell, which runs the check command `release` runs; an empty or whitespace-only value reads as unset, and the caller picks a default. */
export function userShell(): string | undefined {
  const value = process.env[USER_SHELL_VARIABLE];
  if (value === undefined || value.trim().length === 0) return undefined;
  return value;
}
