/** Reads the three numbers `templates/AgentBrief.md` states that the dispatcher's prompts repeat, for the specs that hold them together. */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import { expect }       from 'bun:test';

const AGENT_BRIEF_PATH = join(import.meta.dir, '..', '..', 'templates', 'AgentBrief.md');

export interface AgentBriefNumbers {
  builderBudget:        number;
  reviewerBudget:       number;
  reworkThresholdLines: number;
}

export function numberIn(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  expect(match, `${pattern} is found`).not.toBeNull();
  return Number(match?.[1]);
}

export function agentBriefNumbers(): AgentBriefNumbers {
  const brief = readFileSync(AGENT_BRIEF_PATH, 'utf8');
  return {
    builderBudget:        numberIn(brief, /or at about (\d+) API calls/),
    reviewerBudget:       numberIn(brief, /up to about (\d+) API calls/),
    reworkThresholdLines: numberIn(brief, /Over (\d+) lines of code reworked/),
  };
}
