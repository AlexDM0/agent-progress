/**
 * The dispatcher's prompts point every agent at the installed copy of `templates/AgentBrief.md` for the blocks it follows, and state three numbers
 * of their own: the builder's call budget, the reviewer's, and the rework count above which a round is granted. Those three are read here from
 * the brief and from what the script actually sends, so a change to either that leaves the other behind fails.
 */
import { readFileSync }           from 'node:fs';
import { join }                   from 'node:path';
import { describe, expect, test } from 'bun:test';

import { readDispatchScript, runDispatchScript } from './DispatchScriptHarness';

const AGENT_BRIEF_PATH = join(import.meta.dir, '..', '..', '..', 'templates', 'AgentBrief.md');

function numberIn(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  expect(match, `${pattern} is found`).not.toBeNull();
  return Number(match?.[1]);
}

describe('the dispatcher and the agent brief', () => {
  const brief                 = readFileSync(AGENT_BRIEF_PATH, 'utf8');
  const builderBudget         = numberIn(brief, /or at about (\d+) API calls/);
  const reviewerBudget        = numberIn(brief, /up to about (\d+) API calls/);
  const reworkThresholdLines  = numberIn(brief, /Over (\d+) lines of code reworked/);

  test('the brief states the three numbers the prompts repeat', () => {
    expect([builderBudget, reviewerBudget, reworkThresholdLines]).toEqual([150, 75, 750]);
  });

  test('the builder is sent the brief\'s call budget and told to read the installed brief', async () => {
    const run = await runDispatchScript({ limit: 1, readyTicketIds: ['001'] });
    const builder = run.calls.find((call) => call.kind === 'build');
    expect(builder?.prompt).toContain(`or at about ${builderBudget} API calls`);
    expect(builder?.prompt).toContain('/scratch/example-repository/.agent-progress/agent-brief.md');
  });

  test('the reviewer is sent the brief\'s call budget, its rework threshold and the Review brief to follow', async () => {
    const run = await runDispatchScript({ limit: 1, readyTicketIds: ['001'] });
    const reviewer = run.calls.find((call) => call.kind === 'review');
    expect(reviewer?.prompt).toContain(`up to about ${reviewerBudget} API calls`);
    expect(reviewer?.prompt).toContain(`over ${reworkThresholdLines} lines of code`);
    expect(reviewer?.prompt).toContain('`## Review brief`');
  });

  test('the round decision counts against the brief\'s threshold', () => {
    expect(numberIn(readDispatchScript(), /const REWORK_ROUND_THRESHOLD_LINES = (\d+);/)).toBe(reworkThresholdLines);
  });
});
