/**
 * package.json cannot import the product's names, so this guard holds it to them: its name and its one bin key are the program, or a
 * `bun link` of this checkout would replace the link of the other program. `setup.sh` cannot import them either, so its login item's
 * default label is held to `LAUNCH_AGENT_LABEL` the same way. The constant is read in a child process, since a guard at the
 * repository root imports nothing of the tree.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { expect, test } from 'bun:test';

const REPOSITORY_ROOT = join(import.meta.dir, '..');

const PACKAGE_DOCUMENT = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8')) as { name?: unknown; bin?: Record<string, unknown> };

interface NamesReadInAChild {
  program:                  string;
  originalProgram:          string;
  launchAgentLabel:         string;
  originalLaunchAgentLabel: string;
}

const SETUP_LABEL_PATTERN = /^LAUNCH_AGENT_LABEL="([^"]+)"$/gm;

function productNamesFromAChildProcess(): NamesReadInAChild {
  const modulePath = join(REPOSITORY_ROOT, 'src', 'shared', 'constants', 'ProductNames.ts');
  const source     = `const names = await import(${JSON.stringify(modulePath)}); `
    + 'console.log(JSON.stringify({ program: names.PRODUCT_NAMES.PROGRAM, originalProgram: names.ORIGINAL_PRODUCT_NAMES.PROGRAM, '
    + 'launchAgentLabel: names.PRODUCT_NAMES.LAUNCH_AGENT_LABEL, originalLaunchAgentLabel: names.ORIGINAL_PRODUCT_NAMES.LAUNCH_AGENT_LABEL }));';
  const child = Bun.spawnSync(['bun', '-e', source]);
  if (child.exitCode !== 0) throw new Error(`reading the product names failed: ${child.stderr.toString()}`);
  return JSON.parse(child.stdout.toString()) as NamesReadInAChild;
}

/** Every default label `setup.sh` assigns; exactly one is expected. */
function setupScriptLabelsIn(scriptText: string): string[] {
  return [...scriptText.matchAll(SETUP_LABEL_PATTERN)].map((match) => match[1] ?? '');
}

test('setup.sh --login-runner defaults its label to LAUNCH_AGENT_LABEL, set once', () => {
  const { launchAgentLabel } = productNamesFromAChildProcess();
  expect(setupScriptLabelsIn(readFileSync(join(REPOSITORY_ROOT, 'setup.sh'), 'utf8'))).toEqual([launchAgentLabel]);
});

test('the label guard fails on a script labelled for the other program, planted in memory', () => {
  const { launchAgentLabel, originalLaunchAgentLabel } = productNamesFromAChildProcess();
  const otherLabel = launchAgentLabel === originalLaunchAgentLabel ? `${launchAgentLabel}-v2` : originalLaunchAgentLabel;
  expect(setupScriptLabelsIn(`#!/usr/bin/env bash\nLAUNCH_AGENT_LABEL="${otherLabel}"\n`)).not.toEqual([launchAgentLabel]);
  expect(setupScriptLabelsIn('#!/usr/bin/env bash\n')).toEqual([]);
});

test('package.json is named the program, and its one bin key is the program', () => {
  const { program } = productNamesFromAChildProcess();
  expect(program.length).toBeGreaterThan(0);
  expect(PACKAGE_DOCUMENT.name).toBe(program);
  expect(Object.keys(PACKAGE_DOCUMENT.bin ?? {})).toEqual([program]);
});

test('the guard fails on a package named after the other program, planted in memory', () => {
  const { program, originalProgram } = productNamesFromAChildProcess();
  const otherProgram = program === originalProgram ? `${program}-v2` : originalProgram;
  expect(otherProgram).not.toBe(program);
  expect({ name: otherProgram, bin: { [otherProgram]: 'agent-progress.ts' } }).not.toEqual({ name: program, bin: { [program]: 'agent-progress.ts' } });
});
