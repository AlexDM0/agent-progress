/** The globals the Workflow tool hands a script, declared for `dispatcher/DispatchScript.ts`, the one module that names them. */
import type { WorkflowRuntime } from './WorkflowRuntime.ts';

export {};

declare global {
  const agent: WorkflowRuntime['agent'];
  const parallel: unknown;
  const pipeline: unknown;
  const phase: WorkflowRuntime['phase'];
  const log: WorkflowRuntime['log'];
  const args: WorkflowRuntime['args'];
  const budget: unknown;
  const workflow: unknown;
}
