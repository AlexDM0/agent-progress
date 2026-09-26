/** Reads the three numbers `templates/AgentBrief.md` states that the dispatcher's prompts repeat, for the specs that hold them together. */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import { expect }       from 'bun:test';

export interface AgentBriefNumbers {
  builderApiCallBudget:  number;
  reviewerApiCallBudget: number;
  reworkThresholdLines:  number;
}

function numberIn(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  expect(match, `${pattern} is found`).not.toBeNull();
  return Number(match?.[1]);
}

function agentBriefPath(): string {
  return join(import.meta.dir, '..', '..', 'templates', 'AgentBrief.md');
}

export function agentBriefNumbers(): AgentBriefNumbers {
  const brief = readFileSync(agentBriefPath(), 'utf8');
  return {
    builderApiCallBudget:  numberIn(brief, /or at about (\d+) API calls/),
    reviewerApiCallBudget: numberIn(brief, /up to about (\d+) API calls/),
    reworkThresholdLines:  numberIn(brief, /Over (\d+) lines of code reworked/),
  };
}
