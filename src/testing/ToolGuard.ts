/**
 * The one shared guard for a spec that needs a tool, or a machine condition, the machine may lack. An unmet requirement skips the suite
 * with the requirement named in its title and records the skip for `src/testing/TestRunReport.ts`; with
 * `AGENT_PROGRESS_REQUIRE_EVERY_TOOL` set it registers a failing test naming the requirement instead.
 */
import { describe, test } from 'bun:test';

import { everyToolIsRequired }                            from '../shared/Environment.ts';
import { scratchRootLiesOutsideTheFixedTemporaryFolders } from './FixedTemporaryFolders.ts';
import { gitIsAvailable }                                 from './ScratchWorkspace.ts';

export type RequiredTool = 'git' | 'bash';

export type SpecRequirement = RequiredTool | 'scratch-root-outside-tmp';

export interface SkippedSpec {
  readonly title:            string;
  readonly unmetRequirement: SpecRequirement;
}

function bashIsAvailable(): boolean {
  return Bun.which('bash') !== null;
}

const REQUIREMENT_IS_MET: Readonly<Record<SpecRequirement, () => boolean>> = {
  'git':                      gitIsAvailable,
  'bash':                     bashIsAvailable,
  'scratch-root-outside-tmp': scratchRootLiesOutsideTheFixedTemporaryFolders,
};

const UNMET_REQUIREMENT_WORDING: Readonly<Record<SpecRequirement, string>> = {
  'git':                      'git is missing',
  'bash':                     'bash is missing',
  'scratch-root-outside-tmp': 'the scratch root lies under /tmp or /var/tmp',
};

type SpecBody = () => void | Promise<unknown>;

const skippedSpecs: SkippedSpec[] = [];

export function titleNamingTheUnmetRequirement(title: string, requirement: SpecRequirement): string {
  return `${title} [${UNMET_REQUIREMENT_WORDING[requirement]}]`;
}

function failBecauseRequirementIsUnmet(requirement: SpecRequirement): never {
  throw new Error(`Every tool is required (AGENT_PROGRESS_REQUIRE_EVERY_TOOL is set), but ${UNMET_REQUIREMENT_WORDING[requirement]} on this machine.`);
}

function describeWhenRequirementIsMet(requirement: SpecRequirement, title: string, body: () => void): void {
  if (REQUIREMENT_IS_MET[requirement]()) {
    describe(title, body);
    return;
  }
  const namedTitle = titleNamingTheUnmetRequirement(title, requirement);
  if (everyToolIsRequired()) {
    test(namedTitle, () => failBecauseRequirementIsUnmet(requirement));
    return;
  }
  skippedSpecs.push({ title, unmetRequirement: requirement });
  describe.skip(namedTitle, body);
}

function testWhenRequirementIsMet(requirement: SpecRequirement, claim: string, body: SpecBody, timeoutMilliseconds?: number): void {
  if (REQUIREMENT_IS_MET[requirement]()) {
    test(claim, body, timeoutMilliseconds);
    return;
  }
  const namedClaim = titleNamingTheUnmetRequirement(claim, requirement);
  if (everyToolIsRequired()) {
    test(namedClaim, () => failBecauseRequirementIsUnmet(requirement));
    return;
  }
  skippedSpecs.push({ title: claim, unmetRequirement: requirement });
  test.skip(namedClaim, body);
}

export function describeWhenGitIsPresent(title: string, body: () => void): void {
  describeWhenRequirementIsMet('git', title, body);
}

export function testWhenGitIsPresent(claim: string, body: SpecBody, timeoutMilliseconds?: number): void {
  testWhenRequirementIsMet('git', claim, body, timeoutMilliseconds);
}

export function testWhenBashIsPresent(claim: string, body: SpecBody, timeoutMilliseconds?: number): void {
  testWhenRequirementIsMet('bash', claim, body, timeoutMilliseconds);
}

/** For a spec whose spawned child must reach a tracker outside every temp folder: `TMPDIR` moves the child's `tmpdir()`, never these two. */
export function testWhenGitIsPresentAndTheScratchRootIsOutsideTmp(claim: string, body: SpecBody, timeoutMilliseconds?: number): void {
  if (!REQUIREMENT_IS_MET.git()) {
    testWhenRequirementIsMet('git', claim, body, timeoutMilliseconds);
    return;
  }
  testWhenRequirementIsMet('scratch-root-outside-tmp', claim, body, timeoutMilliseconds);
}

export function skippedSpecsSoFar(): readonly SkippedSpec[] {
  return [...skippedSpecs];
}
