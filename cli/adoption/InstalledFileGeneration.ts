/**
 * The text of every file `init` and `update` install, computed before any of them is written, so a failure here leaves the repository
 * as it was. The dispatcher is bundled from `dispatcher/` by path, and the markdown is read from `resources/templates/` and filled.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { bundleWorkflowScript, type WorkflowScriptBundle } from '../../src/lib/claude-code/WorkflowScriptBundle';
import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL }       from '../../src/lib/tracker-model/constants/AgentSettings';
import { OperationRefusal }                                from '../../src/shared/OperationRefusal';
import { resourceFilePathOf }                              from '../../src/shared/ResourceFilePath';
import { DISPATCH_PROTOCOL }                               from '../../src/shared/constants/DispatchProtocol';
import { TemplatePlaceholderUtil }                         from '../utils/TemplatePlaceholderUtil';

const DISPATCHER_DIRECTORY = join(import.meta.dir, '..', '..', 'dispatcher');

export interface InstalledFileTexts {
  agentBrief:                  string;
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
      `The dispatcher script could not be generated from ${DISPATCHER_DIRECTORY} (${bundle.reason}: ${bundle.detail}), so nothing was written.`,
    );
  }
  return bundle.scriptText;
}

function templateTextOf(templateFileName: string): string {
  return readFileSync(resourceFilePathOf('templates', templateFileName), 'utf8');
}

export async function installedFileTextsFor(request: { generatesTheDispatcherScript: boolean }): Promise<InstalledFileTexts> {
  const dispatcherScript = request.generatesTheDispatcherScript
    ? dispatcherScriptTextOf(await bundleWorkflowScript({
      entryPath:      join(DISPATCHER_DIRECTORY, 'DispatchScript.ts'),
      metaModulePath: join(DISPATCHER_DIRECTORY, 'DispatchMeta.ts'),
      metaExportName: 'DISPATCH_META',
    }))
    : null;
  // The dispatcher's prompts state the same numbers from the same constant, so the brief, the block and the prompts cannot disagree.
  const reworkThresholdLines = String(DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES);
  const agentBrief = TemplatePlaceholderUtil.filledTemplateOf(templateTextOf('AgentBrief.md'), {
    builderApiCallBudget:  String(DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET),
    reviewerApiCallBudget: String(DISPATCH_PROTOCOL.REVIEWER_API_CALL_BUDGET),
    reworkThresholdLines,
  });
  const claudeInstructionsBlock = TemplatePlaceholderUtil.filledTemplateOf(templateTextOf('ClaudeInstructionsBlock.md'), { reworkThresholdLines });
  return {
    agentBrief,
    claudeInstructionsBlockBody: claudeInstructionsBlock.replace(/\n+$/, ''),
    // The template names its model and effort as placeholders, so the installed definition and the tool's default pair cannot drift apart.
    agentDefinition:             TemplatePlaceholderUtil.filledTemplateOf(templateTextOf('AgentProgressWorker.md'), {
      model:  DEFAULT_AGENT_MODEL,
      effort: DEFAULT_AGENT_EFFORT,
    }),
    dispatcherScript,
  };
}
