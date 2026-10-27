/**
 * package.json cannot import the product's names, so this guard holds it to them: its name and its one bin key are the program, or a
 * `bun link` of this checkout would replace the link of the other program. The constant is read in a child process, since a guard at the
 * repository root imports nothing of the tree.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { expect, test } from 'bun:test';

const REPOSITORY_ROOT = join(import.meta.dir, '..');

const PACKAGE_DOCUMENT = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8')) as { name?: unknown; bin?: Record<string, unknown> };

function productNamesFromAChildProcess(): { program: string; originalProgram: string } {
  const modulePath = join(REPOSITORY_ROOT, 'src', 'shared', 'constants', 'ProductNames.ts');
  const source     = `const names = await import(${JSON.stringify(modulePath)}); `
    + 'console.log(JSON.stringify({ program: names.PRODUCT_NAMES.PROGRAM, originalProgram: names.ORIGINAL_PRODUCT_NAMES.PROGRAM }));';
  const child = Bun.spawnSync(['bun', '-e', source]);
  if (child.exitCode !== 0) throw new Error(`reading the product names failed: ${child.stderr.toString()}`);
  return JSON.parse(child.stdout.toString()) as { program: string; originalProgram: string };
}

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
