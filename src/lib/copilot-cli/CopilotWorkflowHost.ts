/**
 * Hosts one dynamic workflow in a Copilot CLI extension and runs a given command once per settled agent, with the agent's prompt and running
 * token totals on its stdin. `AgentSettlementLedger.ts` keeps the per-agent readings and `ExtensionBundle.ts` bundles it into an extension.
 */
import { spawn } from 'node:child_process';

import {
  AgentSettlementLedger,
  type AgentOutcome,
  type AgentUsageTotals,
  type SettledAgent
} from './AgentSettlementLedger.ts';

export interface HostedWorkflowPhase {
  title:   string;
  detail?: string;
}

export interface HostedWorkflow {
  meta: { name: string; description: string; phases: readonly HostedWorkflowPhase[] };
  run(context: unknown): Promise<unknown>;
}

export type CommandRunner = (commandLine: readonly string[], stdinText: string) => void;

export interface CopilotWorkflowHostRequest {
  /** The `@github/copilot-sdk/extension` module, read for `joinSession` and `defineWorkflow`. */
  sdk:            Readonly<Record<string, unknown>>;
  workflow:       HostedWorkflow;
  /** Run once per settled agent with its JSON on stdin, and once at startup with `--session <id>` appended and only the repository root on stdin. */
  settleCommand:  readonly string[];
  repositoryRoot: string;
  runCommand?:    CommandRunner;
  /** Never stdout, which carries the extension's JSON-RPC. */
  reportLine?:    (line: string) => void;
}

export type CopilotWorkflowHosting =
  | { verdict: 'hosted'; sessionId: string }
  | { verdict: 'sdk-shape-unexpected' | 'session-shape-unexpected'; detail: string };

export interface SettledAgentInput extends SettledAgent {
  repositoryRoot: string;
  sessionId:      string;
}

interface CopilotSessionSubset {
  sessionId: string;
  on:        (handler: (event: unknown) => void) => unknown;
}

type JoinSession = (config: { workflows: unknown[] }) => Promise<unknown>;

type DefineWorkflow = (definition: { meta: HostedWorkflow['meta']; run: (context: unknown) => Promise<unknown> }) => unknown;

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function textField(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = Object.hasOwn(record, key) ? record[key] : undefined;
  return typeof value === 'string' ? value : null;
}

function countField(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = Object.hasOwn(record, key) ? record[key] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function usageOf(data: Readonly<Record<string, unknown>>): AgentUsageTotals {
  return {
    inputTokens:      countField(data, 'inputTokens'),
    outputTokens:     countField(data, 'outputTokens'),
    cacheReadTokens:  countField(data, 'cacheReadTokens'),
    cacheWriteTokens: countField(data, 'cacheWriteTokens'),
  };
}

function sessionShapeOf(session: unknown): CopilotSessionSubset | null {
  const { on, sessionId } = recordOf(session);
  if (typeof on !== 'function' || typeof sessionId !== 'string') return null;
  return { sessionId, on: (handler) => on.call(session, handler) };
}

/** Copilot's meta holds only these keys; a phase's other keys are the Claude Code host's. */
function copilotMetaOf(meta: HostedWorkflow['meta']): HostedWorkflow['meta'] {
  return {
    name:        meta.name,
    description: meta.description,
    phases:      meta.phases.map((phase) => (phase.detail === undefined ? { title: phase.title } : { title: phase.title, detail: phase.detail })),
  };
}

function spawningRunnerIn(workingDirectory: string, reportLine: (line: string) => void): CommandRunner {
  return (commandLine, stdinText) => {
    const [executable, ...commandArguments] = commandLine;
    if (executable === undefined) return;
    // stdout is ignored, never inherited: the extension's own stdout is its JSON-RPC channel.
    const child = spawn(executable, commandArguments, { cwd: workingDirectory, stdio: ['pipe', 'ignore', 'inherit'] });
    child.on('error', (error) => {
      reportLine(`${commandLine.join(' ')} could not run: ${error.message}`);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdinText);
  };
}

function settleEventHandler(ledger: AgentSettlementLedger, settled: (agent: SettledAgent) => void): (event: unknown) => void {
  return (event) => {
    const record = recordOf(event);
    const data = recordOf(record['data']);
    const agentId = textField(record, 'agentId');
    switch (textField(record, 'type')) {
      case 'user.message': {
        const prompt = textField(data, 'content');
        if (agentId !== null && prompt !== null) ledger.recordPrompt(agentId, prompt);
        return;
      }
      case 'subagent.started': {
        const startedAgentId = textField(data, 'toolCallId') ?? agentId;
        if (startedAgentId !== null) ledger.recordStart(startedAgentId, textField(data, 'agentDisplayName') ?? '');
        return;
      }
      case 'assistant.usage':
        if (agentId !== null) ledger.addUsage(agentId, usageOf(data));
        return;
      case 'subagent.completed':
      case 'subagent.failed': {
        const settledAgentId = textField(data, 'toolCallId') ?? agentId;
        if (settledAgentId === null) return;
        const outcome: AgentOutcome = textField(record, 'type') === 'subagent.completed' ? 'completed' : 'failed';
        const agent = ledger.settle(settledAgentId, outcome, textField(data, 'agentDisplayName') ?? '');
        if (agent !== null) settled(agent);
        return;
      }
      default:
    }
  };
}

function writeToStandardError(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** A missing or unexpected SDK is a verdict and one reported line, never a throw that keeps the extension from loading. */
export async function hostCopilotWorkflow(request: CopilotWorkflowHostRequest): Promise<CopilotWorkflowHosting> {
  const reportLine = request.reportLine ?? writeToStandardError;
  const joinSession = Object.hasOwn(request.sdk, 'joinSession') ? request.sdk['joinSession'] : undefined;
  const defineWorkflow = Object.hasOwn(request.sdk, 'defineWorkflow') ? request.sdk['defineWorkflow'] : undefined;
  if (typeof joinSession !== 'function' || typeof defineWorkflow !== 'function') {
    const detail = `the Copilot SDK offers no joinSession and defineWorkflow, so the workflow ${request.workflow.meta.name} is not registered`;
    reportLine(detail);
    return { verdict: 'sdk-shape-unexpected', detail };
  }
  const workflowHandle = (defineWorkflow as DefineWorkflow)({ meta: copilotMetaOf(request.workflow.meta), run: (context) => request.workflow.run(context) });
  const session = sessionShapeOf(await (joinSession as JoinSession)({ workflows: [workflowHandle] }));
  if (session === null) {
    const detail = `the Copilot session offers no sessionId and on(), so no agent of the workflow ${request.workflow.meta.name} is credited`;
    reportLine(detail);
    return { verdict: 'session-shape-unexpected', detail };
  }
  const runCommand = request.runCommand ?? spawningRunnerIn(request.repositoryRoot, reportLine);
  session.on(settleEventHandler(new AgentSettlementLedger(), (agent) => {
    const input: SettledAgentInput = {
      repositoryRoot: request.repositoryRoot,
      sessionId:      session.sessionId,
      agentId:        agent.agentId,
      label:          agent.label,
      prompt:         agent.prompt,
      outcome:        agent.outcome,
      usage:          agent.usage,
    };
    runCommand(request.settleCommand, JSON.stringify(input));
  }));
  runCommand([...request.settleCommand, '--session', session.sessionId], JSON.stringify({ repositoryRoot: request.repositoryRoot }));
  return { verdict: 'hosted', sessionId: session.sessionId };
}
