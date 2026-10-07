/**
 * The Copilot adapter, held over every agent call the frozen trace table recorded: each reaches Copilot as a model id Copilot ran in the
 * spike, with no effort for a model that rejects one and the call's own effort for every other, its label and agent type unchanged. A
 * `null` reply must throw, since `AgentStarter` reads a throw as the failed agent Claude Code reports, and phase, log and args pass through.
 */
import { describe, expect, test } from 'bun:test';

import type { CopilotWorkflowAgentOptions, CopilotWorkflowContext } from './@types/CopilotWorkflowContext.d.ts';
import type { AgentOptions, DispatchPhaseTitle }                    from './@types/WorkflowRuntime.ts';
import { COPILOT_MODEL_OF_TIER, workflowRuntimeOfCopilot }          from './DispatchFromCopilotWorkflow.ts';
import { readFrozenDispatchTraces }                                 from './testing/DispatchTraceCapture.ts';

// Seen running in Copilot CLI 1.0.92's session state; haiku failed a call given `reasoningEffort` (`docs/development.md`, Copilot CLI host).
const COPILOT_MODEL_IDS_SEEN_RUNNING = ['claude-haiku-4.5', 'claude-sonnet-5', 'claude-opus-4.8'];

const COPILOT_MODEL_IDS_REJECTING_AN_EFFORT = ['claude-haiku-4.5'];

const RECORDED_CALL_FIELD_COUNT = 13;

// The positions in `dispatcher/testing/utils/DispatchTraceUtil.ts`'s call text.
const CALL_FIELD_INDEX = {
  MODEL: 4, EFFORT: 5, LABEL: 6, PHASE: 7, AGENT_TYPE: 12
} as const;

const EXAMPLE_SCHEMA = { type: 'object' };

interface RecordedCall {
  callText: string;
  options:  AgentOptions;
}

function fieldOf(fields: readonly string[], index: number): string {
  return fields[index] ?? '';
}

function recordedCalls(): readonly RecordedCall[] {
  const calls: RecordedCall[] = [];
  for (const trace of Object.values(readFrozenDispatchTraces().traces)) {
    for (const callText of trace.calls) {
      const fields = callText.split('|');
      if (fields.length !== RECORDED_CALL_FIELD_COUNT) throw new Error(`A recorded call has ${fields.length} fields: ${callText}`);
      const agentType = fieldOf(fields, CALL_FIELD_INDEX.AGENT_TYPE);
      calls.push({
        callText,
        options: {
          label:  fieldOf(fields, CALL_FIELD_INDEX.LABEL),
          phase:  fieldOf(fields, CALL_FIELD_INDEX.PHASE) as DispatchPhaseTitle,
          schema: EXAMPLE_SCHEMA,
          model:  fieldOf(fields, CALL_FIELD_INDEX.MODEL),
          effort: fieldOf(fields, CALL_FIELD_INDEX.EFFORT),
          ...(agentType === 'undefined' ? {} : { agentType }),
        },
      });
    }
  }
  return calls;
}

interface RecordingContext {
  context:    CopilotWorkflowContext;
  agentCalls: { prompt: string; options: CopilotWorkflowAgentOptions | undefined }[];
  phases:     string[];
  logs:       string[];
}

function recordingContext(reply: unknown): RecordingContext {
  const recording: RecordingContext = {
    agentCalls: [],
    phases:     [],
    logs:       [],
    context:    {
      agent: async (prompt, options) => {
        recording.agentCalls.push({ prompt, options });
        return reply;
      },
      phase: (title) => {
        recording.phases.push(title);
      },
      log: (message) => {
        recording.logs.push(message);
      },
      args: { mainLine: 'main' },
    },
  };
  return recording;
}

const RECORDED_CALLS = recordedCalls();

describe('every agent call in the frozen trace table, through the Copilot adapter', () => {
  test('the table holds over a thousand calls, across every tier the dispatcher asks for', () => {
    expect(RECORDED_CALLS.length).toBeGreaterThan(1000);
    expect(new Set(RECORDED_CALLS.map((call) => call.options.model))).toEqual(new Set(['haiku', 'sonnet', 'opus']));
  });

  test('reaches Copilot as a model it runs, with an effort only where the model takes one, and its label and agent type unchanged', async () => {
    const problems: string[] = [];
    for (const call of RECORDED_CALLS) {
      const recording = recordingContext({ verdict: 'done' });
      await workflowRuntimeOfCopilot(recording.context).agent('Example prompt', call.options);
      const sent = recording.agentCalls[0]?.options ?? {};
      const model = sent.model ?? '';
      const rejectsAnEffort = COPILOT_MODEL_IDS_REJECTING_AN_EFFORT.includes(model);
      if (!COPILOT_MODEL_IDS_SEEN_RUNNING.includes(model)) problems.push(`${call.callText}: model ${model}`);
      if (rejectsAnEffort && Object.hasOwn(sent, 'reasoningEffort')) problems.push(`${call.callText}: an effort sent to ${model}`);
      if (!rejectsAnEffort && sent.reasoningEffort !== call.options.effort) problems.push(`${call.callText}: effort ${String(sent.reasoningEffort)}`);
      if (sent.label !== call.options.label) problems.push(`${call.callText}: label ${String(sent.label)}`);
      if (sent.agent !== call.options.agentType) problems.push(`${call.callText}: agent ${String(sent.agent)}`);
      if (sent.schema !== EXAMPLE_SCHEMA) problems.push(`${call.callText}: schema not passed`);
    }
    expect(problems).toEqual([]);
  });
});

describe('the tier table', () => {
  test('maps every tier to a model Copilot runs, and says it takes an effort exactly where Copilot accepts one', () => {
    for (const copilotModel of Object.values(COPILOT_MODEL_OF_TIER)) {
      expect(COPILOT_MODEL_IDS_SEEN_RUNNING).toContain(copilotModel.modelId);
      expect(copilotModel.takesReasoningEffort).toBe(!COPILOT_MODEL_IDS_REJECTING_AN_EFFORT.includes(copilotModel.modelId));
    }
  });
});

describe('workflowRuntimeOfCopilot', () => {
  const exampleOptions: AgentOptions = {
    label: 'build #001', phase: 'Build', schema: EXAMPLE_SCHEMA, model: 'opus', effort: 'medium'
  };

  test('a null reply throws, naming the agent, so the dispatcher logs a failed agent', async () => {
    const recording = recordingContext(null);
    await expect(workflowRuntimeOfCopilot(recording.context).agent('Example prompt', exampleOptions)).rejects.toThrow('build #001');
  });

  test('a reply passes through as it came', async () => {
    const reply = { verdict: 'done' };
    expect(await workflowRuntimeOfCopilot(recordingContext(reply).context).agent('Example prompt', exampleOptions)).toBe(reply);
  });

  test('a tier with no Copilot model, or an effort that is none, throws before any agent starts', async () => {
    const recording = recordingContext({});
    const runtime = workflowRuntimeOfCopilot(recording.context);
    await expect(runtime.agent('Example prompt', { ...exampleOptions, model: 'unknown-tier' })).rejects.toThrow('unknown-tier');
    await expect(runtime.agent('Example prompt', { ...exampleOptions, effort: 'extreme' })).rejects.toThrow('extreme');
    expect(recording.agentCalls).toEqual([]);
  });

  test('passes the prompt, phases, log lines and arguments through', async () => {
    const recording = recordingContext({});
    const runtime = workflowRuntimeOfCopilot(recording.context);
    await runtime.agent('Example prompt', exampleOptions);
    runtime.phase('Review');
    runtime.log('Example log line');
    expect(recording.agentCalls.map((call) => call.prompt)).toEqual(['Example prompt']);
    expect(recording.phases).toEqual(['Review']);
    expect(recording.logs).toEqual(['Example log line']);
    expect(runtime.args).toEqual({ mainLine: 'main' });
  });
});
