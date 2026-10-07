/** The Copilot CLI dynamic workflow's entry: maps the workflow context to the dispatcher's runtime and runs the same `runDispatcher` as on Claude Code. */
import type { AgentEffort, AgentModel }                             from '../src/lib/tracker-model/@types/Ticket.ts';
import { AGENT_EFFORTS }                                            from '../src/lib/tracker-model/constants/AgentSettings.ts';
import type { CopilotWorkflowAgentOptions, CopilotWorkflowContext } from './@types/CopilotWorkflowContext.d.ts';
import type { DispatchSummary }                                     from './@types/DispatchOutcome.ts';
import type { AgentOptions, WorkflowRuntime }                       from './@types/WorkflowRuntime.ts';
import { runDispatcher }                                            from './Dispatcher.ts';

export interface CopilotModel {
  modelId:              string;
  /** A model that rejects `reasoningEffort` fails the call at once, so the effort is left out for it. */
  takesReasoningEffort: boolean;
}

// Copilot has no fable tier; its heaviest Claude model stands in for it.
export const COPILOT_MODEL_OF_TIER: Readonly<Record<AgentModel, CopilotModel>> = {
  haiku:  { modelId: 'claude-haiku-4.5', takesReasoningEffort: false },
  sonnet: { modelId: 'claude-sonnet-5', takesReasoningEffort: true },
  opus:   { modelId: 'claude-opus-4.8', takesReasoningEffort: true },
  fable:  { modelId: 'claude-opus-4.8', takesReasoningEffort: true },
};

function copilotModelOf(tier: string): CopilotModel {
  if (!Object.hasOwn(COPILOT_MODEL_OF_TIER, tier)) throw new Error(`No Copilot model is mapped to the tier "${tier}".`);
  return COPILOT_MODEL_OF_TIER[tier as AgentModel];
}

function isAgentEffort(effort: string): effort is AgentEffort {
  return (AGENT_EFFORTS as readonly string[]).includes(effort);
}

export function copilotAgentOptionsOf(options: AgentOptions): CopilotWorkflowAgentOptions {
  const copilotModel = copilotModelOf(options.model);
  if (copilotModel.takesReasoningEffort && !isAgentEffort(options.effort)) throw new Error(`The effort "${options.effort}" is not a reasoning effort.`);
  return {
    label:  options.label,
    schema: options.schema,
    model:  copilotModel.modelId,
    ...(copilotModel.takesReasoningEffort ? { reasoningEffort: options.effort } : {}),
    ...(options.agentType === undefined ? {} : { agent: options.agentType }),
  };
}

/** A `null` reply becomes a throw, which `AgentStarter` logs and reads as a failed agent, as it does a throw on Claude Code. */
export function workflowRuntimeOfCopilot(context: CopilotWorkflowContext): WorkflowRuntime {
  return {
    agent: async (prompt, options) => {
      const copilotOptions = copilotAgentOptionsOf(options);
      const reply = await context.agent(prompt, copilotOptions);
      if (reply === null) throw new Error(`The Copilot agent "${options.label}" on ${copilotOptions.model ?? options.model} failed: its call resolved null.`);
      return reply;
    },
    phase: (title) => {
      context.phase(title);
    },
    log: (message) => {
      context.log(message);
    },
    args: context.args,
  };
}

export async function dispatchFromCopilotWorkflow(context: CopilotWorkflowContext): Promise<DispatchSummary> {
  return runDispatcher(workflowRuntimeOfCopilot(context));
}
