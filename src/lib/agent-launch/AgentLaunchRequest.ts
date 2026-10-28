import type { WorkerProfile } from './WorkerProfile.ts';

export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AgentLaunchRequest {
  readonly sessionId:         string;
  /** Continue the session `sessionId` names instead of starting it. */
  readonly resume:            boolean;
  readonly workingDirectory:  string;
  readonly firstMessage:      string;
  readonly roleBrief:         string;
  readonly model:             string;
  readonly effort:            AgentEffort;
  /** The whole child environment, already narrowed to an allowlist (`launchEnvironmentOf`): nothing is inherited. */
  readonly environment:       Readonly<Record<string, string>>;
  readonly profile:           WorkerProfile;
  /** Where the plan's files go; every rendered path the plan names lies in it. */
  readonly jobFilesDirectory: string;
  /** Null for a session that ends without a report. */
  readonly reportSchema:      object | null;
}
