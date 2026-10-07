/** The agent hosts a repository can adopt, as `init --host` takes them and `.agent-progress/version.json` stores them. */
export const AGENT_HOSTS = ['claude-code', 'copilot-cli'] as const;

export type AgentHost = typeof AGENT_HOSTS[number];

/** What a manifest without an `agentHost` key means, so a repository installed before the key stays current. */
export const DEFAULT_AGENT_HOST: AgentHost = 'claude-code';
