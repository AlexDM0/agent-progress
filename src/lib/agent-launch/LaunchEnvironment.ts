/** The variables a launched agent keeps from the environment it was launched from; every other one, a parent session's included, stays behind. */
export const INHERITED_VARIABLE_NAMES = ['HOME', 'PATH', 'USER', 'LANG', 'TMPDIR'] as const;

/** The child environment: the allowlisted inherited variables that are set, then the job's own variables, which win a clash. */
export function launchEnvironmentOf(
  inherited: Readonly<Record<string, string | undefined>>,
  jobVariables: Readonly<Record<string, string>>
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of INHERITED_VARIABLE_NAMES) {
    const value = Object.hasOwn(inherited, name) ? inherited[name] : undefined;
    if (value !== undefined) environment[name] = value;
  }
  return { ...environment, ...jobVariables };
}
