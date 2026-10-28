/**
 * The runner learns of an update only through this watch, so what matters: the on-disk binary is asked again at each sweep and after
 * each landing and not on every look, the manifest is read on every look, an install change wins over new code, and nothing here ever
 * restarts anything: the watch only answers. The child it runs is held by running this checkout's own binary.
 */
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { CodeVersion }                                                           from './CodeVersion.ts';
import { createInstallChangeWatch, type ProgramVersions, versionsFromTheBinary } from './InstallChangeWatch.ts';

const IN_MEMORY: ProgramVersions = { codeVersion: 'code-in-memory', installVersion: 17 };

function watchOver(onDisk: ProgramVersions, options: { manifestMatches?: boolean; landingMark?: string } = {}) {
  const answers: ProgramVersions[] = [];
  let current = onDisk;
  let landingMark = options.landingMark ?? 'tip-1';
  let manifestMatches = options.manifestMatches ?? true;
  const watch = createInstallChangeWatch({
    inMemory:       IN_MEMORY,
    versionsOnDisk: () => {
      answers.push(current);
      return current;
    },
    manifestMatches: () => manifestMatches,
    landingMark:     () => landingMark,
  });
  return {
    watch,
    answers,
    putOnDisk:          (versions: ProgramVersions) => { current = versions; },
    land:               (tip: string) => { landingMark = tip; },
    setManifestMatches: (matches: boolean) => { manifestMatches = matches; },
  };
}

describe('when the on-disk binary is asked', () => {
  test('once at the first look, then only after a sweep or a landing', () => {
    const subject = watchOver(IN_MEMORY);
    expect(subject.watch.installVersionChanged()).toBe(false);
    subject.putOnDisk({ ...IN_MEMORY, installVersion: 18 });
    expect(subject.watch.installVersionChanged()).toBe(false);
    expect(subject.answers.length).toBe(1);
    subject.watch.noteSweep();
    expect(subject.watch.installVersionChanged()).toBe(true);
    subject.putOnDisk({ ...IN_MEMORY, codeVersion: 'code-landed' });
    subject.land('tip-2');
    expect(subject.watch.installVersionChanged()).toBe(false);
    expect(subject.watch.newCodeOnDisk()).toBe(true);
    expect(subject.answers.length).toBe(3);
  });
});

describe('what the watch answers', () => {
  test('an install version on disk that differs holds launches; new code alone is only new code', () => {
    expect(watchOver({ codeVersion: 'code-landed', installVersion: 18 }).watch.installVersionChanged()).toBe(true);
    expect(watchOver({ codeVersion: 'code-landed', installVersion: 18 }).watch.newCodeOnDisk()).toBe(false);
    expect(watchOver({ codeVersion: 'code-landed', installVersion: 17 }).watch.newCodeOnDisk()).toBe(true);
    expect(watchOver(IN_MEMORY).watch.newCodeOnDisk()).toBe(false);
  });

  test('a manifest an update moved is an install change at once, without waiting for a sweep, and clears once it matches again', () => {
    const subject = watchOver(IN_MEMORY);
    expect(subject.watch.installVersionChanged()).toBe(false);
    subject.setManifestMatches(false);
    expect(subject.watch.installVersionChanged()).toBe(true);
    subject.setManifestMatches(true);
    expect(subject.watch.installVersionChanged()).toBe(false);
  });

  test('a binary that gives no answer changes nothing the watch last learned', () => {
    let answer: ProgramVersions | null = { ...IN_MEMORY, installVersion: 18 };
    const watch = createInstallChangeWatch({
      inMemory: IN_MEMORY, versionsOnDisk: () => answer, manifestMatches: () => true, landingMark: () => null
    });
    expect(watch.installVersionChanged()).toBe(true);
    answer = null;
    watch.noteSweep();
    expect(watch.installVersionChanged()).toBe(true);
  });
});

test('the on-disk binary\'s version --json answers its code on disk and its install version, and no program answers nothing', () => {
  const programCommand = [process.execPath, join(import.meta.dir, '..', '..', '..', 'agent-progress.ts')];
  expect(versionsFromTheBinary(programCommand, import.meta.dir)).toEqual({ codeVersion: CodeVersion.onDisk(), installVersion: expect.any(Number) });
  expect(versionsFromTheBinary([], import.meta.dir)).toBeNull();
});
