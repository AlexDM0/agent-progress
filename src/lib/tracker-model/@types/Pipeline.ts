/** The board's gate pipeline, stored in `pipeline.json` beside the progress file: absent until a `gate` verb first writes it. */

export interface PipelineStep {
  name: string;
  run:  string;
}

export interface PipelineGate {
  name:          string;
  run:           string;
  /** The shell line that repairs what the gate reports, such as a formatter; absent when the gate has none. */
  fix?:          string;
  /** The folder, relative to the worktree, the gate runs in; absent runs it at the worktree's root. */
  in?:           string;
  /** The git pathspec-style patterns of the files that define the gate. */
  definedBy?:    string[];
  /** The domains the gate may reach. */
  network?:      string[];
  /** The folders the gate may write besides the worktree and temp, absolute or `~/`. */
  writes?:       string[];
  /** Run by the Overseer alone, never by an agent in its worktree. */
  overseerOnly?: true;
}

export interface PipelineReview {
  name:    string;
  model?:  string;
  effort?: string;
}

export type PipelineAgentRole = 'builder' | 'reviewer' | 'merger' | 'productOwner' | 'onboarder' | 'assistant';

export interface Pipeline {
  prepare:       PipelineStep[];
  /** In run order; an empty list is no gates on purpose, which counts as set. */
  gates:         PipelineGate[];
  review?:       PipelineReview;
  constitution?: string[];
  agents?:       Partial<Record<PipelineAgentRole, string[]>>;
}
