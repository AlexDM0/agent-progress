/** The subset of Copilot CLI's dynamic workflow context `dispatcher/DispatchFromCopilotWorkflow.ts` touches, from `@github/copilot-sdk/extension`. */
import type { JsonSchema } from './WorkflowRuntime.ts';

export interface CopilotWorkflowAgentOptions {
  label?:           string;
  schema?:          JsonSchema;
  model?:           string;
  reasoningEffort?: string;
  agent?:           string;
}

export interface CopilotWorkflowContext {
  /** Resolves the parsed reply, or `null` when the agent failed. */
  agent(prompt: string, options?: CopilotWorkflowAgentOptions): Promise<unknown>;
  phase(title: string): void;
  log(message: string): void;
  readonly args: unknown;
}
