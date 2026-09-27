/**
 * Builds a Workflow tool script from a TypeScript entry module: one plain module body with no import or export, the meta as a literal in
 * front of it and the runner's call as its last statement, as the Workflow tool runs a script.
 */
import { dirname } from 'node:path';

export interface WorkflowScriptBundleRequest {
  entryPath:      string;
  /** Imported by path at build time, so the meta is the value the module exports rather than its source text. */
  metaModulePath: string;
  metaExportName: string;
  plugins?:       readonly Bun.BunPlugin[];
}

export type WorkflowScriptBundleFailure =
  | 'build-failed'
  | 'no-output'
  | 'no-single-runner-export'
  | 'imports-or-exports-remain'
  | 'declares-top-level-meta'
  | 'meta-module-unloadable'
  | 'meta-export-missing'
  | 'names-a-local-path';

export type WorkflowScriptBundle =
  | { verdict: 'built'; scriptText: string }
  | { verdict: 'failed'; reason: WorkflowScriptBundleFailure; detail: string };

/** The bundler's `// <path>` line before each module, relative to the working directory; any characters, since a checkout path may hold a space. */
const BUNDLER_PATH_COMMENT_LINE = /^\/\/ .*\.m?[jt]s\n/gm;

const FINAL_EXPORT_STATEMENT = /\nexport \{\s*(\w+)(?:\s+as\s+\w+)?\s*\};\n*$/;

const TOP_LEVEL_META_DECLARATION = /^(?:var|let|const|class|function\*?|async function\*?) meta\b/m;

const META_INDENT_SPACES = 2;

function failed(reason: WorkflowScriptBundleFailure, detail: string): WorkflowScriptBundle {
  return { verdict: 'failed', reason, detail };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type MetaModuleLoading = { verdict: 'loaded'; exports: Readonly<Record<string, unknown>> } | { verdict: 'unloadable'; detail: string };

async function metaModuleOf(metaModulePath: string): Promise<MetaModuleLoading> {
  try {
    const metaModuleExports: Readonly<Record<string, unknown>> = await import(metaModulePath);
    return { verdict: 'loaded', exports: metaModuleExports };
  } catch (error) {
    return { verdict: 'unloadable', detail: messageOf(error) };
  }
}

/** A failure is returned as a verdict, never thrown. */
export async function bundleWorkflowScript(request: WorkflowScriptBundleRequest): Promise<WorkflowScriptBundle> {
  let result: Bun.BuildOutput;
  try {
    result = await Bun.build({
      entrypoints: [request.entryPath],
      format:      'esm',
      target:      'browser',
      minify:      false,
      splitting:   false,
      sourcemap:   'none',
      throw:       false,
      plugins:     [...(request.plugins ?? [])],
    });
  } catch (error) {
    return failed('build-failed', messageOf(error));
  }
  if (!result.success) return failed('build-failed', result.logs.map((message) => String(message)).join('; '));
  const [output] = result.outputs;
  if (output === undefined) return failed('no-output', String(result.outputs.length));
  const moduleText = (await output.text()).replace(BUNDLER_PATH_COMMENT_LINE, '');
  const entryDirectory = dirname(request.entryPath);
  const linesNamingTheEntryDirectory = moduleText.split('\n').filter((line) => line.includes(entryDirectory));
  if (linesNamingTheEntryDirectory.length > 0) return failed('names-a-local-path', linesNamingTheEntryDirectory.join('\n'));
  const finalExport = FINAL_EXPORT_STATEMENT.exec(moduleText);
  const runnerLocalName = finalExport?.[1];
  if (finalExport === null || runnerLocalName === undefined) {
    return failed('no-single-runner-export', JSON.stringify(new Bun.Transpiler({ loader: 'js' }).scan(moduleText).exports));
  }
  const body = `${moduleText.slice(0, finalExport.index)}\n`;
  const { imports: remainingImports, exports: remainingExports } = new Bun.Transpiler({ loader: 'js' }).scan(body);
  if (remainingImports.length > 0 || remainingExports.length > 0) {
    return failed('imports-or-exports-remain', JSON.stringify({ imports: remainingImports.map((entry) => entry.path), exports: remainingExports }));
  }
  const topLevelMeta = TOP_LEVEL_META_DECLARATION.exec(body);
  if (topLevelMeta !== null) return failed('declares-top-level-meta', topLevelMeta[0]);
  const metaModule = await metaModuleOf(request.metaModulePath);
  if (metaModule.verdict === 'unloadable') return failed('meta-module-unloadable', metaModule.detail);
  if (!Object.hasOwn(metaModule.exports, request.metaExportName)) return failed('meta-export-missing', request.metaExportName);
  const meta = metaModule.exports[request.metaExportName];
  return { verdict: 'built', scriptText: `export const meta = ${JSON.stringify(meta, null, META_INDENT_SPACES)};\n${body}return await ${runnerLocalName}();\n` };
}
