/**
 * Preloaded by `bunfig.toml`: after the whole run, removes the scratch templates and prints every spec the tool guard skipped, by
 * name and unmet requirement or opt-in left off, with the count, so a skip is never silent. Its one statement is its own registration,
 * the reason it may do work at load.
 */
import { afterAll } from 'bun:test';

import { EVERY_TOOL_REQUIRED_VARIABLE }                      from '../shared/Environment.ts';
import { removeScratchTemplates }                            from './ScratchWorkspace.ts';
import { skippedSpecsSoFar, titleNamingTheUnmetRequirement } from './ToolGuard.ts';

afterAll(() => {
  removeScratchTemplates();
  const skippedSpecs = skippedSpecsSoFar();
  if (skippedSpecs.length === 0) return;
  const failInstead = `set ${EVERY_TOOL_REQUIRED_VARIABLE}=1 to fail all but the opt-ins instead`;
  console.log(`${skippedSpecs.length} spec(s) skipped for a missing tool or machine condition, or an opt-in left off (${failInstead}):`);
  for (const skippedSpec of skippedSpecs) {
    console.log(`  ${titleNamingTheUnmetRequirement(skippedSpec.title, skippedSpec.unmetRequirement)}`);
  }
});
