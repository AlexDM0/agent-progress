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
import {
  AGENT_HOST_INSTALLS,
  type AgentHost,
  type InstalledFile,
  type InstalledFileName,
  type InstalledPart
}                                                                    from './constants/AgentHostInstalls.ts';

// The brief is prose, so it names the model the way a person writes it; the agent definition keeps the id Claude Code reads.
const AGENT_MODEL_DISPLAY_NAMES: Readonly<Record<AgentModel, string>> = Object.freeze({
  haiku:  'Haiku',
  sonnet: 'Sonnet',
  opus:   'Opus',
  fable:  'Fable',
});

/** A managed block's file holds the block's body, without the template's closing newlines. The dispatcher is absent when none was asked for. */
export type InstalledFileTexts = Readonly<Partial<Record<InstalledFileName, string>>>;

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

function filesOf(part: InstalledPart): readonly InstalledFile[] {
  if (part.writing === 'managed-block') return [part.file];
  if (part.writing === 'claude-settings-hooks') return [];
  return part.files;
}

export async function installedFileTextsFor(request: { agentHost: AgentHost; generatesTheDispatcherScript: boolean }): Promise<InstalledFileTexts> {
  const hostInstall = AGENT_HOST_INSTALLS[request.agentHost];
  // The dispatcher's prompts state the same numbers from the same constant, so the briefs, the block and the prompts cannot disagree; the
  // definition takes the default pair and the brief its display word, so neither can drift from the tool's defaults.
  const templateValues: Readonly<Record<string, string>> = {
    modelDisplayName:      AGENT_MODEL_DISPLAY_NAMES[DEFAULT_AGENT_MODEL],
    model:                 DEFAULT_AGENT_MODEL,
    effort:                DEFAULT_AGENT_EFFORT,
    builderApiCallBudget:  String(DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET),
    reviewerApiCallBudget: String(DISPATCH_PROTOCOL.REVIEWER_API_CALL_BUDGET),
    reworkThresholdLines:  String(DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES),
    ...hostInstall.hostSentences,
  };
  const texts: Partial<Record<InstalledFileName, string>> = {};
  for (const part of hostInstall.parts) {
    for (const file of filesOf(part)) {
      if (file.text.kind === 'dispatcher-bundle') {
        if (request.generatesTheDispatcherScript) texts[file.name] = dispatcherScriptTextOf(await bundleWorkflowScript(dispatcherScriptBuildRequestWith([])));
        continue;
      }
      const filledText = filledTemplateOf(templateTextOf(file.text.templateFileName), templateValues);
      texts[file.name] = part.writing === 'managed-block' ? filledText.replace(/\n+$/, '') : filledText;
    }
  }
  return texts;
}
