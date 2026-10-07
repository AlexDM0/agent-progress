/**
 * Builds a Copilot CLI `extension.mjs` from a workflow module and its meta: one Node module that hosts the workflow through
 * `CopilotWorkflowHost.ts`, importing nothing but the Copilot SDK, which the CLI resolves itself, and Node built-ins.
 */
import { isBuiltin }     from 'node:module';
import { dirname, join } from 'node:path';

export interface ExtensionBundleRequest {
  /** The module whose `workflowRunnerExportName` export runs the workflow, handed the Copilot workflow context. */
  workflowModulePath:              string;
  workflowRunnerExportName:        string;
  metaModulePath:                  string;
  metaExportName:                  string;
  settleCommand:                   readonly string[];
  /** The repository root as a URL relative to the installed `extension.mjs`, such as `../../..`. */
  repositoryRootFromExtensionFile: string;
  plugins?:                        readonly Bun.BunPlugin[];
}

export type ExtensionBundleFailure = 'export-name-invalid' | 'build-failed' | 'no-output' | 'imports-beyond-the-sdk-and-node' | 'names-a-local-path';

export type ExtensionBundle =
  | { verdict: 'built'; extensionText: string }
  | { verdict: 'failed'; reason: ExtensionBundleFailure; detail: string };

export const COPILOT_EXTENSION_SDK_SPECIFIER = '@github/copilot-sdk/extension';

const ENTRY_SPECIFIER = 'copilot-extension-entry';

const ENTRY_NAMESPACE = 'copilot-extension-entry';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The bundler's `// <path>` line before each module, relative to the working directory; any characters, since a checkout path may hold a space. */
const BUNDLER_PATH_COMMENT_LINE = /^\/\/ .*\.m?[jt]s\n/gm;

function hostModulePath(): string {
  return join(import.meta.dir, 'CopilotWorkflowHost.ts');
}

function failed(reason: ExtensionBundleFailure, detail: string): ExtensionBundle {
  return { verdict: 'failed', reason, detail };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function entryTextOf(request: ExtensionBundleRequest): string {
  return [
    `import * as copilotExtensionSdk from ${JSON.stringify(COPILOT_EXTENSION_SDK_SPECIFIER)};`,
    'import { fileURLToPath } from \'node:url\';',
    `import { hostCopilotWorkflow } from ${JSON.stringify(hostModulePath())};`,
    `import { ${request.workflowRunnerExportName} as runWorkflow } from ${JSON.stringify(request.workflowModulePath)};`,
    `import { ${request.metaExportName} as workflowMeta } from ${JSON.stringify(request.metaModulePath)};`,
    '',
    'await hostCopilotWorkflow({',
    '  sdk:            copilotExtensionSdk,',
    '  workflow:       { meta: workflowMeta, run: runWorkflow },',
    `  settleCommand:  ${JSON.stringify(request.settleCommand)},`,
    `  repositoryRoot: fileURLToPath(new URL(${JSON.stringify(request.repositoryRootFromExtensionFile)}, import.meta.url)).replace(/\\/$/, ''),`,
    '});',
    '',
  ].join('\n');
}

function entryPluginFor(entryText: string): Bun.BunPlugin {
  return {
    name: ENTRY_NAMESPACE,
    setup(build) {
      build.onResolve({ filter: new RegExp(`^${ENTRY_SPECIFIER}$`) }, () => ({ path: ENTRY_SPECIFIER, namespace: ENTRY_NAMESPACE }));
      build.onLoad({ filter: /.*/, namespace: ENTRY_NAMESPACE }, () => ({ contents: entryText, loader: 'js' }));
    },
  };
}

/** A failure is returned as a verdict, never thrown. */
export async function bundleCopilotExtension(request: ExtensionBundleRequest): Promise<ExtensionBundle> {
  const invalidExportName = [request.workflowRunnerExportName, request.metaExportName].find((name) => !IDENTIFIER.test(name));
  if (invalidExportName !== undefined) return failed('export-name-invalid', invalidExportName);
  let result: Bun.BuildOutput;
  try {
    result = await Bun.build({
      entrypoints: [ENTRY_SPECIFIER],
      format:      'esm',
      target:      'node',
      minify:      false,
      splitting:   false,
      sourcemap:   'none',
      throw:       false,
      external:    [COPILOT_EXTENSION_SDK_SPECIFIER],
      plugins:     [entryPluginFor(entryTextOf(request)), ...(request.plugins ?? [])],
    });
  } catch (error) {
    return failed('build-failed', messageOf(error));
  }
  if (!result.success) return failed('build-failed', result.logs.map((message) => String(message)).join('; '));
  const [output] = result.outputs;
  if (output === undefined) return failed('no-output', String(result.outputs.length));
  const extensionText = (await output.text()).replace(BUNDLER_PATH_COMMENT_LINE, '');
  const localDirectories = [dirname(request.workflowModulePath), import.meta.dir];
  const linesNamingALocalPath = extensionText.split('\n').filter((line) => localDirectories.some((directory) => line.includes(directory)));
  if (linesNamingALocalPath.length > 0) return failed('names-a-local-path', linesNamingALocalPath.join('\n'));
  const importedSpecifiers = new Bun.Transpiler({ loader: 'js' }).scan(extensionText).imports.map((entry) => entry.path);
  const strayImports = importedSpecifiers.filter((specifier) => specifier !== COPILOT_EXTENSION_SDK_SPECIFIER && !isBuiltin(specifier));
  if (strayImports.length > 0) return failed('imports-beyond-the-sdk-and-node', JSON.stringify(strayImports));
  return { verdict: 'built', extensionText };
}
