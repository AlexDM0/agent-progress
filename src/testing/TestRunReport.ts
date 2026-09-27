/**
 * Preloaded by `bunfig.toml`: after the whole run, prints every spec the tool guard skipped, by name and missing tool, with the count, so a
 * skip is never silent. Its one statement is its own registration, the reason it may do work at load.
 */
import { afterAll } from 'bun:test';

import { skippedSpecsSoFar } from './ToolGuard.ts';

afterAll(() => {
  const skippedSpecs = skippedSpecsSoFar();
  if (skippedSpecs.length === 0) return;
  console.log(`${skippedSpecs.length} spec(s) skipped for a missing tool (set AGENT_PROGRESS_REQUIRE_EVERY_TOOL=1 to fail them instead):`);
  for (const skippedSpec of skippedSpecs) {
    console.log(`  ${skippedSpec.title} [${skippedSpec.missingTool} is missing]`);
  }
});
