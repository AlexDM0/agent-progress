/**
 * The one shared guard for a spec that needs a tool the machine may lack. A missing tool skips the suite with the tool named in its
 * title and records the skip for `src/testing/TestRunReport.ts`; with `AGENT_PROGRESS_REQUIRE_EVERY_TOOL` set it registers a failing
 * test naming the tool instead.
 */
import { describe, test } from 'bun:test';

import { everyToolIsRequired, liveCopilotRunIsAllowed } from '../shared/Environment.ts';
import { gitIsAvailable }                               from './ScratchWorkspace.ts';

/** `copilot-live-run` is `copilot` on the path with `AGENT_PROGRESS_LIVE_COPILOT_RUN` set, since its one spec spends real model tokens. */
export type RequiredTool = 'git' | 'bash' | 'copilot-live-run';

export interface SkippedSpec {
  readonly title:       string;
  readonly missingTool: RequiredTool;
}

function bashIsAvailable(): boolean {
  return Bun.which('bash') !== null;
}

function copilotLiveRunIsAvailable(): boolean {
  return Bun.which('copilot') !== null && liveCopilotRunIsAllowed();
}

const TOOL_IS_PRESENT: Readonly<Record<RequiredTool, () => boolean>> = {
  'git':              gitIsAvailable,
  'bash':             bashIsAvailable,
  'copilot-live-run': copilotLiveRunIsAvailable,
};

type SpecBody = () => void | Promise<unknown>;

const skippedSpecs: SkippedSpec[] = [];

function titleNamingTheMissingTool(title: string, tool: RequiredTool): string {
  return `${title} [${tool} is missing]`;
}

function failBecauseToolIsMissing(tool: RequiredTool): never {
  throw new Error(`Every tool is required (AGENT_PROGRESS_REQUIRE_EVERY_TOOL is set), but "${tool}" is not on this machine.`);
}

function describeWhenToolIsPresent(tool: RequiredTool, title: string, body: () => void): void {
  if (TOOL_IS_PRESENT[tool]()) {
    describe(title, body);
    return;
  }
  const namedTitle = titleNamingTheMissingTool(title, tool);
  if (everyToolIsRequired()) {
    test(namedTitle, () => failBecauseToolIsMissing(tool));
    return;
  }
  skippedSpecs.push({ title, missingTool: tool });
  describe.skip(namedTitle, body);
}

function testWhenToolIsPresent(tool: RequiredTool, claim: string, body: SpecBody, timeoutMilliseconds?: number): void {
  if (TOOL_IS_PRESENT[tool]()) {
    test(claim, body, timeoutMilliseconds);
    return;
  }
  const namedClaim = titleNamingTheMissingTool(claim, tool);
  if (everyToolIsRequired()) {
    test(namedClaim, () => failBecauseToolIsMissing(tool));
    return;
  }
  skippedSpecs.push({ title: claim, missingTool: tool });
  test.skip(namedClaim, body);
}

export function describeWhenGitIsPresent(title: string, body: () => void): void {
  describeWhenToolIsPresent('git', title, body);
}

export function testWhenGitIsPresent(claim: string, body: SpecBody, timeoutMilliseconds?: number): void {
  testWhenToolIsPresent('git', claim, body, timeoutMilliseconds);
}

export function testWhenBashIsPresent(claim: string, body: SpecBody, timeoutMilliseconds?: number): void {
  testWhenToolIsPresent('bash', claim, body, timeoutMilliseconds);
}

export function testWhenCopilotLiveRunIsPresent(claim: string, body: SpecBody, timeoutMilliseconds?: number): void {
  testWhenToolIsPresent('copilot-live-run', claim, body, timeoutMilliseconds);
}

export function skippedSpecsSoFar(): readonly SkippedSpec[] {
  return [...skippedSpecs];
}
