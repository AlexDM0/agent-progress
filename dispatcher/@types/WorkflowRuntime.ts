/** The Workflow tool's contract as the dispatcher uses it: the globals it is handed, the options of an agent call, and the script's meta. */
export type DispatchPhaseTitle = 'Survey' | 'Build' | 'Review' | 'Park';

export interface JsonSchema {
  type:        string;
  properties?: Record<string, JsonSchema>;
  items?:      JsonSchema;
  required?:   readonly string[];
  enum?:       readonly string[];
  minimum?:    number;
}

export interface AgentOptions {
  label:  string;
  phase:  DispatchPhaseTitle;
  schema: JsonSchema;
  model:  string;
  effort: string;
}

export interface WorkflowRuntime {
  agent: (prompt: string, options: AgentOptions) => Promise<unknown>;
  phase: (title: DispatchPhaseTitle) => void;
  log:   (message: string) => void;
  args:  unknown;
}

export interface WorkflowPhase {
  title:  DispatchPhaseTitle;
  detail: string;
  model?: string;
}

export interface WorkflowMeta {
  name:        string;
  description: string;
  whenToUse:   string;
  phases:      readonly WorkflowPhase[];
}
