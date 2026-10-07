/**
 * What a Copilot CLI session's `events.jsonl` says each of its agents cost once the session shut down, beside the prompt
 * that started the agent. As the copilot-cli building block's main module it stands for its siblings. The package
 * depends on `src/lib/json-record`.
 */
import { readFileSync }   from 'node:fs';
import { join }           from 'node:path';
import { JsonRecordUtil } from '../json-record/JsonRecordUtil.ts';

export interface CopilotTokenUsage {
  inputTokens:      number;
  outputTokens:     number;
  cacheReadTokens:  number;
  cacheWriteTokens: number;
}

export interface CopilotSessionAgent {
  agentId:      string;
  agentName:    string | undefined;
  displayName:  string | undefined;
  prompt:       string;
  requestCount: number;
  usage:        CopilotTokenUsage;
}

export type CopilotSessionReading =
  | { verdict: 'shut-down'; agents: CopilotSessionAgent[] }
  | { verdict: 'not-shut-down' }
  | { verdict: 'malformed'; lineNumber: number };

type AgentMetrics = Omit<CopilotSessionAgent, 'agentId' | 'prompt'>;

const SHUTDOWN_EVENT_TYPE = 'session.shutdown';

const USER_MESSAGE_EVENT_TYPE = 'user.message';

const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const;

/** A session id names one folder, so a separator or a parent step in it is no session id at all. */
const SESSION_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** A non-negative whole count, or `undefined` for anything else. */
export function wholeCountOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** A usage object whose four counts are all whole, a missing one read as zero. */
export function copilotTokenUsageOf(value: unknown): CopilotTokenUsage | undefined {
  const usageRecord = JsonRecordUtil.recordOf(value);
  if (usageRecord === undefined) return undefined;
  const usage: CopilotTokenUsage = {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0
  };
  for (const field of USAGE_FIELDS) {
    const count = wholeCountOf(usageRecord[field] ?? 0);
    if (count === undefined) return undefined;
    usage[field] = count;
  }
  return usage;
}

export function sessionEventsPathOf(homeDirectory: string, sessionIdentifier: string): string | undefined {
  if (!SESSION_IDENTIFIER_PATTERN.test(sessionIdentifier)) return undefined;
  return join(homeDirectory, '.copilot', 'session-state', sessionIdentifier, 'events.jsonl');
}

export function sessionEventsTextAt(eventsPath: string): string | undefined {
  try {
    return readFileSync(eventsPath, 'utf8');
  } catch {
    return undefined;
  }
}

function optionalTextOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Every model the agent called adds to one total; an agent that failed before its first call has no model at all. */
function agentMetricsOf(value: unknown): AgentMetrics | undefined {
  const metrics      = JsonRecordUtil.recordOf(value);
  const modelMetrics = metrics === undefined ? undefined : JsonRecordUtil.recordOf(metrics['modelMetrics'] ?? {});
  if (metrics === undefined || modelMetrics === undefined) return undefined;
  const usage: CopilotTokenUsage = {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0
  };
  let requestCount = 0;
  for (const modelMetric of Object.values(modelMetrics)) {
    const metric     = JsonRecordUtil.recordOf(modelMetric);
    const modelUsage = metric === undefined ? undefined : copilotTokenUsageOf(metric['usage'] ?? {});
    if (metric === undefined || modelUsage === undefined) return undefined;
    for (const field of USAGE_FIELDS) usage[field] += modelUsage[field];
    requestCount += wholeCountOf(JsonRecordUtil.recordOf(metric['requests'])?.['count']) ?? 0;
  }
  return {
    agentName:   optionalTextOf(metrics['agentName']),
    displayName: optionalTextOf(metrics['agentDisplayName']),
    requestCount,
    usage,
  };
}

/**
 * A later shutdown's `agentMetrics` holds an agent's running totals, so the newest one naming an agent wins. An agent no
 * shutdown names, and the main conversation, which receives no prompt of its own, are left out. An agent's prompt is
 * the first `user.message` carrying its `agentId`.
 */
export function readCopilotSession(eventsText: string): CopilotSessionReading {
  const promptByAgent  = new Map<string, string>();
  const metricsByAgent = new Map<string, AgentMetrics>();
  let sessionWasShutDown = false;
  const lines = eventsText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim().length === 0) continue;
    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(line);
    } catch {
      return { verdict: 'malformed', lineNumber: i + 1 };
    }
    const event = JsonRecordUtil.recordOf(parsedLine);
    if (event === undefined) return { verdict: 'malformed', lineNumber: i + 1 };
    const data = JsonRecordUtil.recordOf(event['data']);

    if (event['type'] === USER_MESSAGE_EVENT_TYPE) {
      const agentIdentifier = optionalTextOf(event['agentId']);
      const prompt          = data?.['content'];
      if (agentIdentifier !== undefined && typeof prompt === 'string' && !promptByAgent.has(agentIdentifier)) promptByAgent.set(agentIdentifier, prompt);
    } else if (event['type'] === SHUTDOWN_EVENT_TYPE) {
      const agentMetricsRecord = data === undefined ? undefined : JsonRecordUtil.recordOf(data['agentMetrics'] ?? {});
      if (agentMetricsRecord === undefined) return { verdict: 'malformed', lineNumber: i + 1 };
      sessionWasShutDown = true;
      for (const [agentIdentifier, value] of Object.entries(agentMetricsRecord)) {
        const metrics = agentMetricsOf(value);
        if (metrics === undefined) return { verdict: 'malformed', lineNumber: i + 1 };
        metricsByAgent.set(agentIdentifier, metrics);
      }
    }
  }
  if (!sessionWasShutDown) return { verdict: 'not-shut-down' };

  const agents = [...metricsByAgent].flatMap(([agentIdentifier, metrics]) => {
    const prompt = promptByAgent.get(agentIdentifier);
    return prompt === undefined ? [] : [{ agentId: agentIdentifier, prompt, ...metrics }];
  });
  return { verdict: 'shut-down', agents };
}
