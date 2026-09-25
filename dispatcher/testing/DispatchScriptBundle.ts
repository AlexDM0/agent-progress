/**
 * Builds the Workflow script text from `dispatcher/DispatchScript.ts`: one plain module body with no import or export, the meta as a literal in
 * front of it and the runner's call as its last statement, as the Workflow tool runs a script.
 */
import { join } from 'node:path';

import { DISPATCH_META }                      from '../DispatchMeta.ts';
import { mutantPluginFor, type SourceMutant } from './SourceMutant';

export type DispatchScriptBundle = { verdict: 'built'; scriptText: string } | { verdict: 'failed'; reason: string };

const BUNDLER_PATH_COMMENT_LINE = /^\/\/ [\w@./-]+\.[jt]s\n/gm;

const FINAL_EXPORT_STATEMENT = /\nexport \{\s*(\w+)(?:\s+as\s+\w+)?\s*\};\n*$/;

const TOP_LEVEL_META_DECLARATION = /^(?:var|let|const|class|function\*?|async function\*?) meta\b/m;

const META_INDENT_SPACES = 2;

let pendingUnmutatedBundle: Promise<DispatchScriptBundle> | null = null;

export const DispatchScriptBundleBookkeeping = {
  buildCount: 0,
  forgetMemoisedBundle(): void {
    pendingUnmutatedBundle                     = null;
    DispatchScriptBundleBookkeeping.buildCount = 0;
  },
};

function failed(reason: string): DispatchScriptBundle {
  return { verdict: 'failed', reason };
}

async function buildDispatchScript(mutant: SourceMutant | undefined): Promise<DispatchScriptBundle> {
  DispatchScriptBundleBookkeeping.buildCount += 1;
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, '..', 'DispatchScript.ts')],
    format:      'esm',
    target:      'browser',
    minify:      false,
    splitting:   false,
    sourcemap:   'none',
    throw:       false,
    plugins:     mutant === undefined ? [] : [mutantPluginFor(mutant)],
  });
  if (!result.success) return failed(`the dispatcher bundle failed: ${result.logs.map((message) => String(message)).join('; ')}`);
  const [output] = result.outputs;
  if (output === undefined) return failed('the dispatcher bundle succeeded but produced no output file');
  const moduleText = (await output.text()).replace(BUNDLER_PATH_COMMENT_LINE, '');
  const finalExport = FINAL_EXPORT_STATEMENT.exec(moduleText);
  const runnerLocalName = finalExport?.[1];
  if (finalExport === null || runnerLocalName === undefined) return failed('the dispatcher bundle does not end in the single export of its runner');
  const body = `${moduleText.slice(0, finalExport.index)}\n`;
  const { imports, exports } = new Bun.Transpiler({ loader: 'js' }).scan(body);
  if (imports.length > 0 || exports.length > 0) {
    return failed(`the dispatcher bundle keeps imports or exports at run time: ${JSON.stringify({ imports: imports.map((entry) => entry.path), exports })}`);
  }
  if (TOP_LEVEL_META_DECLARATION.test(body)) return failed('the dispatcher bundle declares a top-level meta of its own');
  return { verdict: 'built', scriptText: `export const meta = ${JSON.stringify(DISPATCH_META, null, META_INDENT_SPACES)};\n${body}return await ${runnerLocalName}();\n` };
}

/** For a spec: the text of a bundle that built, while a failed one throws its reason so the test fails on it. */
export function builtScriptTextOf(bundle: DispatchScriptBundle): string {
  if (bundle.verdict === 'failed') throw new Error(bundle.reason);
  return bundle.scriptText;
}

/** The unmutated bundle is built once per process; a mutant's is built each time. A failure is returned, never thrown. */
export function bundleDispatchScript(mutant?: SourceMutant): Promise<DispatchScriptBundle> {
  if (mutant !== undefined) return buildDispatchScript(mutant);
  pendingUnmutatedBundle ??= buildDispatchScript(undefined);
  return pendingUnmutatedBundle;
}
