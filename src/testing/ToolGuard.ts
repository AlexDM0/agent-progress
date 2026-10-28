/**
 * The one shared guard for a spec that needs a tool, or a machine condition, the machine may lack. An unmet requirement skips the suite
 * with the requirement named in its title and records the skip for `src/testing/TestRunReport.ts`; with
 * `AGENT_PROGRESS_REQUIRE_EVERY_TOOL` set it registers a failing test naming the requirement instead.
 */
import { describe, test } from 'bun:test';

import {
  EVERY_TOOL_REQUIRED_VARIABLE,
  everyToolIsRequired,
  REAL_AGENT_SPECS_VARIABLE,
  realAgentSpecsAreOn
} from '../shared/Environment.ts';
import { scratchRootLiesOutsideTheFixedTemporaryFolders } from './FixedTemporaryFolders.ts';
import {
  commitFile,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
} from './ScratchWorkspace.ts';

export type RequiredTool = 'git' | 'bash';

export type SpecRequirement = RequiredTool | 'claude' | 'git-merge-tree-stdin' | 'scratch-root-outside-tmp' | 'real-agent-opt-in';

/** Left off by choice rather than missing, so requiring every tool still skips it. */
const OPT_IN_REQUIREMENTS: readonly SpecRequirement[] = ['real-agent-opt-in'];

export interface SkippedSpec {
  readonly title:            string;
  readonly unmetRequirement: SpecRequirement;
}

function bashIsAvailable(): boolean {
  return Bun.which('bash') !== null;
}

function plantedPairMergesOnStandardInput(): boolean {
  const repositoryDirectory = createScratchGitRepository('merge-tree-stdin-probe');
  try {
    commitFile(repositoryDirectory, 'planted.txt', 'planted\n');
    const finished = Bun.spawnSync(['git', 'merge-tree', '--stdin'], {
      cwd:    repositoryDirectory,
      stdin:  new TextEncoder().encode('HEAD^ HEAD\n'),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return finished.exitCode === 0 && finished.stdout.toString().startsWith('1\0');
  } catch {
    return false;
  } finally {
    removeScratchDirectory(repositoryDirectory);
  }
}

let gitMergeTreeStandardInputAnswer: boolean | null = null;

/** Runs the feature on a planted pair, once per run, rather than reading git's version number. */
function gitMergeTreeStandardInputWorks(): boolean {
  gitMergeTreeStandardInputAnswer ??= gitIsAvailable() && plantedPairMergesOnStandardInput();
  return gitMergeTreeStandardInputAnswer;
}

function claudeIsAvailable(): boolean {
  return Bun.which('claude') !== null;
}

const REQUIREMENT_IS_MET: Readonly<Record<SpecRequirement, () => boolean>> = {
  'git':                      gitIsAvailable,
  'bash':                     bashIsAvailable,
  'claude':                   claudeIsAvailable,
  'git-merge-tree-stdin':     gitMergeTreeStandardInputWorks,
  'scratch-root-outside-tmp': scratchRootLiesOutsideTheFixedTemporaryFolders,
  'real-agent-opt-in':        realAgentSpecsAreOn,
};

const UNMET_REQUIREMENT_WORDING: Readonly<Record<SpecRequirement, string>> = {
  'git':                      'git is missing',
  'bash':                     'bash is missing',
  'claude':                   'claude is missing',
  'git-merge-tree-stdin':     'git merge-tree --stdin is missing',
  'scratch-root-outside-tmp': 'the scratch root lies under /tmp or /var/tmp',
  'real-agent-opt-in':        `${REAL_AGENT_SPECS_VARIABLE} is not set`,
};

type SpecBody = () => void | Promise<unknown>;

const skippedSpecs: SkippedSpec[] = [];

export function titleNamingTheUnmetRequirement(title: string, requirement: SpecRequirement): string {
  return `${title} [${UNMET_REQUIREMENT_WORDING[requirement]}]`;
}

function failBecauseRequirementIsUnmet(requirement: SpecRequirement): never {
  throw new Error(`Every tool is required (${EVERY_TOOL_REQUIRED_VARIABLE} is set), but ${UNMET_REQUIREMENT_WORDING[requirement]} on this machine.`);
}

function describeWhenRequirementIsMet(requirement: SpecRequirement, title: string, body: () => void): void {
  if (REQUIREMENT_IS_MET[requirement]()) {
    describe(title, body);
    return;
  }
  const namedTitle = titleNamingTheUnmetRequirement(title, requirement);
  if (everyToolIsRequired() && !OPT_IN_REQUIREMENTS.includes(requirement)) {
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
  if (everyToolIsRequired() && !OPT_IN_REQUIREMENTS.includes(requirement)) {
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

/** For a spec predicting merges: git with `merge-tree --write-tree` and `--stdin`. */
export function describeWhenGitMergeTreeStdinIsPresent(title: string, body: () => void): void {
  describeWhenRequirementIsMet('git-merge-tree-stdin', title, body);
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

/** For a spec that launches a real Claude Code session: skipped unless opted into, and failed when opted into without `claude` present. */
export function testWhenRealClaudeSpecsAreOn(claim: string, body: SpecBody, timeoutMilliseconds?: number): void {
  if (!REQUIREMENT_IS_MET['real-agent-opt-in']()) {
    testWhenRequirementIsMet('real-agent-opt-in', claim, body, timeoutMilliseconds);
    return;
  }
  testWhenRequirementIsMet('claude', claim, body, timeoutMilliseconds);
}

export function skippedSpecsSoFar(): readonly SkippedSpec[] {
  return [...skippedSpecs];
}
