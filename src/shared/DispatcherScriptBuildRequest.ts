/**
 * The one build request for each host's dispatcher, the Claude Code Workflow script and the Copilot CLI extension, so what `init` and
 * `update` install is what the specs test.
 */
import { join } from 'node:path';

import type { WorkflowScriptBundleRequest } from '../lib/claude-code/WorkflowScriptBundle.ts';
import type { ExtensionBundleRequest }      from '../lib/copilot-cli/ExtensionBundle.ts';

export const DISPATCHER_SCRIPT_BUILD = {
  ENTRY_FILE_NAME:       'DispatchFromWorkflowGlobals.ts',
  META_MODULE_FILE_NAME: 'DispatchMeta.ts',
  META_EXPORT_NAME:      'DISPATCH_META',
} as const;

export const COPILOT_EXTENSION_BUILD = {
  ENTRY_FILE_NAME:                     'DispatchFromCopilotWorkflow.ts',
  RUNNER_EXPORT_NAME:                  'dispatchFromCopilotWorkflow',
  SETTLE_COMMAND:                      ['agent-progress', 'hook', 'copilot-agent-settled'],
  // The extension is installed at `.github/extensions/agent-progress/extension.mjs`, three folders below the repository root.
  REPOSITORY_ROOT_FROM_EXTENSION_FILE: '../../..',
} as const;

/** Resolves from the installed package, as `resourceFilePathOf` does, because the `bun link`ed binary runs from any repository. */
export function dispatcherDirectoryPath(): string {
  return join(import.meta.dir, '..', '..', 'dispatcher');
}

export function dispatcherScriptBuildRequestWith(plugins: readonly Bun.BunPlugin[]): WorkflowScriptBundleRequest {
  return {
    entryPath:      join(dispatcherDirectoryPath(), DISPATCHER_SCRIPT_BUILD.ENTRY_FILE_NAME),
    metaModulePath: join(dispatcherDirectoryPath(), DISPATCHER_SCRIPT_BUILD.META_MODULE_FILE_NAME),
    metaExportName: DISPATCHER_SCRIPT_BUILD.META_EXPORT_NAME,
    plugins,
  };
}

export function copilotExtensionBuildRequestWith(plugins: readonly Bun.BunPlugin[]): ExtensionBundleRequest {
  return {
    workflowModulePath:              join(dispatcherDirectoryPath(), COPILOT_EXTENSION_BUILD.ENTRY_FILE_NAME),
    workflowRunnerExportName:        COPILOT_EXTENSION_BUILD.RUNNER_EXPORT_NAME,
    metaModulePath:                  join(dispatcherDirectoryPath(), DISPATCHER_SCRIPT_BUILD.META_MODULE_FILE_NAME),
    metaExportName:                  DISPATCHER_SCRIPT_BUILD.META_EXPORT_NAME,
    settleCommand:                   COPILOT_EXTENSION_BUILD.SETTLE_COMMAND,
    repositoryRootFromExtensionFile: COPILOT_EXTENSION_BUILD.REPOSITORY_ROOT_FROM_EXTENSION_FILE,
    plugins,
  };
}
