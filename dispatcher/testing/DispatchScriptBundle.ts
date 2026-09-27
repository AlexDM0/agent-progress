/** The specs' bundle of the dispatcher's entry: the package's Workflow script build, memoised per process, or built from a `SourceMutant`. */
import { join } from 'node:path';

import { bundleWorkflowScript, type WorkflowScriptBundle } from '../../src/lib/claude-code/WorkflowScriptBundle.ts';
import { DISPATCHER_SCRIPT_BUILD }                         from '../../src/shared/constants/DispatcherScriptBuild.ts';
import { mutantPluginFor, type SourceMutant }              from './SourceMutant.ts';

export type DispatchScriptBundle = WorkflowScriptBundle;

let pendingUnmutatedBundle: Promise<DispatchScriptBundle> | null = null;

export const DispatchScriptBundleBookkeeping = {
  buildCount: 0,
  forgetMemoisedBundle(): void {
    pendingUnmutatedBundle                     = null;
    DispatchScriptBundleBookkeeping.buildCount = 0;
  },
};

function buildDispatchScript(mutant: SourceMutant | undefined): Promise<DispatchScriptBundle> {
  DispatchScriptBundleBookkeeping.buildCount += 1;
  const dispatcherDirectory = join(import.meta.dir, '..');
  return bundleWorkflowScript({
    entryPath:      join(dispatcherDirectory, DISPATCHER_SCRIPT_BUILD.ENTRY_FILE_NAME),
    metaModulePath: join(dispatcherDirectory, DISPATCHER_SCRIPT_BUILD.META_MODULE_FILE_NAME),
    metaExportName: DISPATCHER_SCRIPT_BUILD.META_EXPORT_NAME,
    plugins:        mutant === undefined ? [] : [mutantPluginFor(mutant)],
  });
}

/** For a spec: the text of a bundle that built, while a failed one throws its reason so the test fails on it. */
export function builtScriptTextOf(bundle: DispatchScriptBundle): string {
  if (bundle.verdict === 'failed') throw new Error(`${bundle.reason}: ${bundle.detail}`);
  return bundle.scriptText;
}

/** The unmutated bundle is built once per process; a mutant's is built each time. A failure is returned, never thrown. */
export function bundleDispatchScript(mutant?: SourceMutant): Promise<DispatchScriptBundle> {
  if (mutant !== undefined) return buildDispatchScript(mutant);
  pendingUnmutatedBundle ??= buildDispatchScript(undefined);
  return pendingUnmutatedBundle;
}
