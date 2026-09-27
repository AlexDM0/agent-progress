/** The globals the Workflow tool hands a script, declared for `dispatcher/DispatchFromWorkflowGlobals.ts`, the one module that names them. */
import type { WorkflowRuntime } from './WorkflowRuntime.ts';

export {};

declare global {
  const agent: WorkflowRuntime['agent'];
  const phase: WorkflowRuntime['phase'];
  const log: WorkflowRuntime['log'];
  const args: WorkflowRuntime['args'];
}
