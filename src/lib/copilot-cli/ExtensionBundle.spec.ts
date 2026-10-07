/**
 * The extension bundle from example fixtures: a built one imports nothing but the Copilot SDK and Node built-ins, with the host, the workflow
 * and its meta inlined, and each refusal a request can provoke has its own fixture. The dispatcher's own extension is held in
 * `src/shared/DispatcherScriptBuildRequest.extension.spec.ts`.
 */
import { writeFileSync } from 'node:fs';
import { join }          from 'node:path';

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import { createScratchDirectory, removeScratchDirectory }                                       from '../../testing/ScratchWorkspace.ts';
import { COPILOT_EXTENSION_SDK_SPECIFIER, bundleCopilotExtension, type ExtensionBundleRequest } from './ExtensionBundle.ts';

const EXAMPLE_WORKFLOW_MODULE = 'export async function runExampleWorkflow() {\n  return \'example result\';\n}\n';

const EXAMPLE_META_MODULE = 'export const EXAMPLE_META = { name: \'example-workflow\', description: \'An example workflow\', phases: [] };\n';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function exampleRequest(workflowModuleText: string): ExtensionBundleRequest {
  const folder = createScratchDirectory('copilot-extension-fixture-');
  scratchDirectories.push(folder);
  writeFileSync(join(folder, 'Workflow.ts'), workflowModuleText);
  writeFileSync(join(folder, 'Meta.ts'), EXAMPLE_META_MODULE);
  return {
    workflowModulePath:              join(folder, 'Workflow.ts'),
    workflowRunnerExportName:        'runExampleWorkflow',
    metaModulePath:                  join(folder, 'Meta.ts'),
    metaExportName:                  'EXAMPLE_META',
    settleCommand:                   ['example-credit', 'settled'],
    repositoryRootFromExtensionFile: '../../..',
  };
}

describe('bundleCopilotExtension', () => {
  test('builds one module importing only the SDK and Node built-ins, with the host, workflow, meta and command inlined', async () => {
    const bundle = await bundleCopilotExtension(exampleRequest(EXAMPLE_WORKFLOW_MODULE));
    const extensionText = bundle.verdict === 'built' ? bundle.extensionText : '';
    const importedSpecifiers = new Bun.Transpiler({ loader: 'js' }).scan(extensionText).imports.map((entry) => entry.path);
    expect(importedSpecifiers).toEqual([COPILOT_EXTENSION_SDK_SPECIFIER, 'node:url', 'node:child_process']);
    expect(extensionText).toContain('async function hostCopilotWorkflow(');
    expect(extensionText).toContain('return "example result";');
    expect(extensionText).toContain('name: "example-workflow"');
    expect(extensionText).toContain('settleCommand: ["example-credit", "settled"]');
    expect(extensionText).toContain('new URL("../../..", import.meta.url)');
  });

  test('refuses an export name that is not an identifier, before building', async () => {
    const bundle = await bundleCopilotExtension({ ...exampleRequest(EXAMPLE_WORKFLOW_MODULE), metaExportName: 'EXAMPLE_META } from "elsewhere"; //' });
    expect(bundle).toEqual({ verdict: 'failed', reason: 'export-name-invalid', detail: 'EXAMPLE_META } from "elsewhere"; //' });
  });

  test('refuses a bundle left importing a package beyond the SDK and Node', async () => {
    const externalPlugin: Bun.BunPlugin = {
      name: 'example-external',
      setup(build) {
        build.onResolve({ filter: /^example-external-package$/ }, (resolution) => ({ path: resolution.path, external: true }));
      },
    };
    const request = exampleRequest('import { exampleHelper } from \'example-external-package\';\nexport async function runExampleWorkflow() {\n  return exampleHelper();\n}\n');
    const bundle = await bundleCopilotExtension({ ...request, plugins: [externalPlugin] });
    expect(bundle).toEqual({ verdict: 'failed', reason: 'imports-beyond-the-sdk-and-node', detail: '["example-external-package"]' });
  });

  test('refuses a workflow module that does not build', async () => {
    const bundle = await bundleCopilotExtension(exampleRequest('export async function otherName() {\n  return 1;\n}\n'));
    expect(bundle.verdict === 'failed' ? bundle.reason : bundle.verdict).toBe('build-failed');
  });
});
