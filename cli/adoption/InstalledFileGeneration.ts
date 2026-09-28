/**
 * The text of every file `init` and `update` install, computed before any of them is written, so a failure here leaves the repository
 * as it was. The dispatcher is bundled from `dispatcher/` by path, and the markdown is read from `resources/templates/` and filled.
 */
import { readFileSync } from 'node:fs';

import { bundleWorkflowScript, type WorkflowScriptBundle }           from '../../src/lib/claude-code/WorkflowScriptBundle.ts';
import type { AgentModel }                                           from '../../src/lib/tracker-model/@types/Ticket.ts';
import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL }                 from '../../src/lib/tracker-model/constants/AgentSettings.ts';
import { dispatcherDirectoryPath, dispatcherScriptBuildRequestWith } from '../../src/shared/DispatcherScriptBuildRequest.ts';
import { OperationRefusal }                                          from '../../src/shared/OperationRefusal.ts';
import { resourceFilePathOf }                                        from '../../src/shared/ResourceFilePath.ts';
import { DISPATCH_PROTOCOL }                                         from '../../src/shared/constants/DispatchProtocol.ts';
import { filledTemplateOf }                                          from '../FilledTemplate.ts';

// The brief is prose, so it names the model the way a person writes it; the agent definition keeps the id Claude Code reads.
const AGENT_MODEL_DISPLAY_NAMES: Readonly<Record<AgentModel, string>> = Object.freeze({
  haiku:  'Haiku',
  sonnet: 'Sonnet',
  opus:   'Opus',
  fable:  'Fable',
});

export interface InstalledFileTexts {
  agentBrief:                  string;
  builderBrief:                string;
  reviewBrief:                 string;
  claudeInstructionsBlockBody: string;
  agentDefinition:             string;
  /** Null when `--no-workflow` asked for no dispatcher, so nothing is bundled. */
  dispatcherScript:            string | null;
}

/** A bundle that fails is a defect of this checkout, not of the repository being written to, so it is unrepaired. */
export function dispatcherScriptTextOf(bundle: WorkflowScriptBundle): string {
  if (bundle.verdict === 'failed') {
    throw new OperationRefusal(
      'unrepaired',
      `The dispatcher script could not be generated from ${dispatcherDirectoryPath()} (${bundle.reason}: ${bundle.detail}), so nothing was written.`,
    );
  }
  return bundle.scriptText;
}

function templateTextOf(templateFileName: string): string {
  return readFileSync(resourceFilePathOf('templates', templateFileName), 'utf8');
}

export async function installedFileTextsFor(request: { generatesTheDispatcherScript: boolean }): Promise<InstalledFileTexts> {
  const dispatcherScript = request.generatesTheDispatcherScript
    ? dispatcherScriptTextOf(await bundleWorkflowScript(dispatcherScriptBuildRequestWith([])))
    : null;
  // The dispatcher's prompts state the same numbers from the same constant, so the brief, the block and the prompts cannot disagree.
  const reworkThresholdLines = String(DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES);
  // The definition takes the default pair and the brief its display word, so neither can drift from the tool's defaults.
  const defaultAgentPair = { model: DEFAULT_AGENT_MODEL, effort: DEFAULT_AGENT_EFFORT };
  const agentBrief = filledTemplateOf(templateTextOf('AgentBrief.md'), {
    modelDisplayName: AGENT_MODEL_DISPLAY_NAMES[DEFAULT_AGENT_MODEL],
    effort:           DEFAULT_AGENT_EFFORT,
  });
  const builderBrief = filledTemplateOf(templateTextOf('BuilderBrief.md'), { builderApiCallBudget: String(DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET) });
  const reviewBrief  = filledTemplateOf(templateTextOf('ReviewBrief.md'), {
    reviewerApiCallBudget: String(DISPATCH_PROTOCOL.REVIEWER_API_CALL_BUDGET),
    reworkThresholdLines,
  });
  const claudeInstructionsBlock = filledTemplateOf(templateTextOf('ClaudeInstructionsBlock.md'), { reworkThresholdLines });
  return {
    agentBrief,
    builderBrief,
    reviewBrief,
    claudeInstructionsBlockBody: claudeInstructionsBlock.replace(/\n+$/, ''),
    agentDefinition:             filledTemplateOf(templateTextOf('AgentProgressWorker.md'), defaultAgentPair),
    dispatcherScript,
  };
}
