/** The one build request for the dispatcher's Workflow script, so the script `init` and `update` install is the one the specs test. */
import { join } from 'node:path';

import type { WorkflowScriptBundleRequest } from '../lib/claude-code/WorkflowScriptBundle.ts';

export const DISPATCHER_SCRIPT_BUILD = {
  ENTRY_FILE_NAME:       'DispatchFromWorkflowGlobals.ts',
  META_MODULE_FILE_NAME: 'DispatchMeta.ts',
  META_EXPORT_NAME:      'DISPATCH_META',
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
