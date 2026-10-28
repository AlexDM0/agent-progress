/**
 * Maps one stdout line of a `claude -p --output-format stream-json` session to the launcher port's events. A line that is not JSON, or a
 * record the runner has no use for (hooks, summaries, thinking estimates), maps to none.
 */
import type {
  AgentQuestion,
  AgentSessionEvent,
  AgentTurnUsage,
  AgentUsageTotals
} from '../agent-launch/AgentSessionEvent.ts';

type StreamRecord = Readonly<Record<string, unknown>>;

const INPUT_SUMMARY_CHARACTERS = 200;
const MILLISECONDS_PER_SECOND = 1000;
const QUESTION_TOOL_NAME = 'AskUserQuestion';

function isRecord(value: unknown): value is StreamRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldOf(record: StreamRecord | null, key: string): unknown {
  return record !== null && Object.hasOwn(record, key) ? record[key] : undefined;
}

function recordAt(record: StreamRecord | null, key: string): StreamRecord | null {
  const value = fieldOf(record, key);
  return isRecord(value) ? value : null;
}

function stringAt(record: StreamRecord | null, key: string): string {
  const value = fieldOf(record, key);
  return typeof value === 'string' ? value : '';
}

function nullableStringAt(record: StreamRecord | null, key: string): string | null {
  const value = fieldOf(record, key);
  return typeof value === 'string' ? value : null;
}

function numberAt(record: StreamRecord | null, key: string): number {
  const value = fieldOf(record, key);
  return typeof value === 'number' ? value : 0;
}

function arrayAt(record: StreamRecord | null, key: string): readonly unknown[] {
  const value = fieldOf(record, key);
  return Array.isArray(value) ? value : [];
}

function recordsAt(record: StreamRecord | null, key: string): StreamRecord[] {
  return arrayAt(record, key).filter(isRecord);
}

function parsedRecordOf(line: string): StreamRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function turnUsageOf(usage: StreamRecord | null): AgentTurnUsage | null {
  if (usage === null) return null;
  return {
    inputTokens:              numberAt(usage, 'input_tokens'),
    outputTokens:             numberAt(usage, 'output_tokens'),
    cacheCreationInputTokens: numberAt(usage, 'cache_creation_input_tokens'),
    cacheReadInputTokens:     numberAt(usage, 'cache_read_input_tokens'),
  };
}

function startedEventsOf(record: StreamRecord): AgentSessionEvent[] {
  if (stringAt(record, 'subtype') !== 'init') return [];
  return [{
    kind:          'started',
    sessionId:     stringAt(record, 'session_id'),
    vendorVersion: stringAt(record, 'claude_code_version'),
    model:         stringAt(record, 'model'),
    tools:         arrayAt(record, 'tools').filter((tool): tool is string => typeof tool === 'string'),
  }];
}

function inputSummaryOf(input: unknown): string {
  return (JSON.stringify(input) ?? '').slice(0, INPUT_SUMMARY_CHARACTERS);
}

function assistantEventsOf(record: StreamRecord): AgentSessionEvent[] {
  const message = recordAt(record, 'message');
  const parentToolUseId = nullableStringAt(record, 'parent_tool_use_id');
  const turn: AgentSessionEvent = {
    kind:      'assistant-turn',
    messageId: stringAt(message, 'id'),
    parentToolUseId,
    model:     stringAt(message, 'model'),
    usage:     turnUsageOf(recordAt(message, 'usage')),
  };
  const toolCalls = recordsAt(message, 'content')
    .filter((content) => stringAt(content, 'type') === 'tool_use')
    .map((content): AgentSessionEvent => ({
      kind: 'tool-call', toolName: stringAt(content, 'name'), inputSummary: inputSummaryOf(fieldOf(content, 'input')), parentToolUseId
    }));
  return [turn, ...toolCalls];
}

function questionOf(question: StreamRecord): AgentQuestion {
  return {
    question:    stringAt(question, 'question'),
    header:      stringAt(question, 'header'),
    multiSelect: fieldOf(question, 'multiSelect') === true,
    options:     recordsAt(question, 'options').map((option) => ({ label: stringAt(option, 'label'), description: stringAt(option, 'description') })),
  };
}

/** Only a question surfaces: every other permission request is answered by the plan's standing reply and counted at the result. */
function controlRequestEventsOf(record: StreamRecord): AgentSessionEvent[] {
  const request = recordAt(record, 'request');
  if (stringAt(request, 'subtype') !== 'can_use_tool' || stringAt(request, 'tool_name') !== QUESTION_TOOL_NAME) return [];
  return [{ kind: 'question', requestId: stringAt(record, 'request_id'), questions: recordsAt(recordAt(request, 'input'), 'questions').map(questionOf) }];
}

function isoStampOfEpochSeconds(epochSeconds: number): string {
  return new Date(epochSeconds * MILLISECONDS_PER_SECOND).toISOString();
}

/** The top-level status is the one that refuses requests; a rejected window under allowed overage stays a warning. */
function usageWindowEventsOf(record: StreamRecord): AgentSessionEvent[] {
  const information = recordAt(record, 'rate_limit_info');
  if (information === null) return [];
  const window = stringAt(information, 'rateLimitType');
  const windowInformation = recordAt(recordAt(information, 'unifiedWindows'), window);
  const status = stringAt(information, 'status');
  return [{
    kind:            'usage-window',
    window,
    utilization:     typeof fieldOf(information, 'utilization') === 'number' ? numberAt(information, 'utilization') : numberAt(windowInformation, 'utilization'),
    resetsAt:        isoStampOfEpochSeconds(numberAt(information, 'resetsAt')),
    status,
    requestsRefused: status === 'rejected',
  }];
}

function usageTotalsOf(modelUsage: StreamRecord | null): AgentUsageTotals | null {
  if (modelUsage === null) return null;
  const byModel: Record<string, AgentTurnUsage> = {};
  for (const [model, usage] of Object.entries(modelUsage)) {
    if (!isRecord(usage)) continue;
    byModel[model] = {
      inputTokens:              numberAt(usage, 'inputTokens'),
      outputTokens:             numberAt(usage, 'outputTokens'),
      cacheCreationInputTokens: numberAt(usage, 'cacheCreationInputTokens'),
      cacheReadInputTokens:     numberAt(usage, 'cacheReadInputTokens'),
    };
  }
  return { byModel };
}

/** The context the last API call of the turn read: its input, cache creation and cache read tokens. */
function contextTokensOf(usage: StreamRecord | null): number | null {
  const lastIteration = recordsAt(usage, 'iterations').at(-1);
  if (lastIteration === undefined) return null;
  return numberAt(lastIteration, 'input_tokens') + numberAt(lastIteration, 'cache_creation_input_tokens') + numberAt(lastIteration, 'cache_read_input_tokens');
}

function resultEventsOf(record: StreamRecord): AgentSessionEvent[] {
  const denials = recordsAt(record, 'permission_denials')
    .map((denial): AgentSessionEvent => ({ kind: 'permission-denied', toolName: stringAt(denial, 'tool_name') }));
  const structuredOutput = fieldOf(record, 'structured_output');
  return [...denials, {
    kind:             'result',
    isError:          fieldOf(record, 'is_error') === true || stringAt(record, 'subtype') !== 'success',
    structuredReport: structuredOutput ?? null,
    usageTotals:      usageTotalsOf(recordAt(record, 'modelUsage')),
    contextTokens:    contextTokensOf(recordAt(record, 'usage')),
  }];
}

const EVENTS_OF_RECORD_TYPE: Readonly<Record<string, (record: StreamRecord) => AgentSessionEvent[]>> = {
  system:           startedEventsOf,
  assistant:        assistantEventsOf,
  control_request:  controlRequestEventsOf,
  rate_limit_event: usageWindowEventsOf,
  result:           resultEventsOf,
};

export function claudeStreamEventsOf(line: string): readonly AgentSessionEvent[] {
  const record = parsedRecordOf(line);
  const type = stringAt(record, 'type');
  if (record === null || !Object.hasOwn(EVENTS_OF_RECORD_TYPE, type)) return [];
  return EVENTS_OF_RECORD_TYPE[type]?.(record) ?? [];
}
