export interface AgentLaunchPlan {
  /** Spawned directly, with no shell. */
  readonly argv:            readonly string[];
  readonly environment:     Readonly<Record<string, string>>;
  readonly files:           readonly LaunchFile[];
  readonly standingReplies: readonly StandingReply[];
}

export interface LaunchFile {
  readonly path: string;
  readonly text: string;
}

/**
 * How a Watcher answers a session while nobody is there: a stdout line whose every `whenAllEqual` dotted path holds its value, and none of whose
 * `whenNoneEqual` paths does, is answered with `replyTemplate`, its `{{request_id}}` filled from the line's `request_id`.
 */
export interface StandingReply {
  readonly whenAllEqual:  Readonly<Record<string, string | boolean>>;
  readonly whenNoneEqual: Readonly<Record<string, string | boolean>>;
  readonly replyTemplate: string;
}
