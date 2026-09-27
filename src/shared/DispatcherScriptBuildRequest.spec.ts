/**
 * The dispatcher's build request. What matters is that its entry and meta modules exist under the package's `dispatcher/` folder, whatever
 * the working directory, and that the plugins a caller hands it (the specs' source mutants) reach the bundler unchanged.
 */
import { existsSync }             from 'node:fs';
import { dirname, isAbsolute }    from 'node:path';
import { describe, expect, test } from 'bun:test';

import { dispatcherDirectoryPath, dispatcherScriptBuildRequestWith } from './DispatcherScriptBuildRequest.ts';

const EXAMPLE_PLUGIN: Bun.BunPlugin = { name: 'example-plugin', setup: () => undefined };

describe('dispatcherScriptBuildRequestWith', () => {
  test('the entry and the meta module exist under the dispatcher folder', () => {
    const request = dispatcherScriptBuildRequestWith([]);
    expect(isAbsolute(dispatcherDirectoryPath())).toBe(true);
    expect(dirname(request.entryPath)).toBe(dispatcherDirectoryPath());
    expect(dirname(request.metaModulePath)).toBe(dispatcherDirectoryPath());
    expect(existsSync(request.entryPath)).toBe(true);
    expect(existsSync(request.metaModulePath)).toBe(true);
  });

  test('the plugins pass through unchanged', () => {
    const plugins = [EXAMPLE_PLUGIN];
    expect(dispatcherScriptBuildRequestWith(plugins).plugins).toBe(plugins);
  });
});
