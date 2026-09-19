/**
 * The stored default axis: a relative bound is kept verbatim, so `--from -2h` still means the last two hours on the next refresh.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import type { ProgressFile }                                                  from '../../lib/constants/Types';
import { createCapturedCommandContext }                                       from '../../lib/tooling/dev/CapturedCommandContext';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine }                                                     from '../Main';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

let repositoryDirectory = '';

function contextHere(): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
}

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = contextHere();
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

function storedView(): ProgressFile['view'] {
  return (JSON.parse(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')) as ProgressFile).view;
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('range-command');
  await run(['init', '--project', 'Example Agency']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('storing a range', () => {
  test('two relative bounds are stored as written, under the relative kind', async () => {
    const context = await run(['range', '--from', '-2h', '--to', 'now', '--tick', '15m']);

    expect(storedView()).toEqual({
      kind:        'relative',
      from:        '-2h',
      to:          'now',
      tickMinutes: 15,
    });
    expect(context.outputText()).toContain('-2h');
  });

  test('two timestamps are stored as absolute and normalised to one spelling', async () => {
    await run(['range', '--from', '2026-09-18T09:00', '--to', '2026-09-18T18:00']);

    const view = storedView();
    expect(view.kind).toBe('absolute');
    expect(view.kind === 'absolute' ? view.from : '').toMatch(/^2026-09-18T09:00:00[+-]\d{2}:\d{2}$/);
    expect(view.kind === 'absolute' ? view.tickMinutes : 0).toBeNull();
  });

  /** A mixed pair is legal because `lib/render/page/GanttGeometry.ts` resolves each end on its own. */
  test('one timestamp and one relative bound are stored together, under the relative kind', async () => {
    await run(['range', '--from', '2026-09-18T09:00', '--to', 'now']);

    const view = storedView();
    expect(view.kind).toBe('relative');
    expect(view.kind === 'relative' ? view.to : '').toBe('now');
    expect(view.kind === 'relative' ? view.from : '').toContain('2026-09-18T09:00:00');
  });

  test('--auto puts the axis back to the automatic span', async () => {
    await run(['range', '--from', '-2h', '--to', 'now']);

    const context = await run(['range', '--auto']);

    expect(storedView()).toEqual({ kind: 'auto' });
    expect(context.outputText()).toContain('automatic');
  });
});

describe.skipIf(!gitIsAvailable())('refusals', () => {
  test('a bound nobody can read is refused, and the stored axis is left alone', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['range', '--from', 'yesterday', '--to', 'now'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('is not a range bound');
    expect(storedView()).toEqual({ kind: 'auto' });
  });

  test('a tick that is not a duration is refused rather than laid out as zero', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['range', '--from', '-2h', '--to', 'now', '--tick', 'hourly'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('is not a duration');
  });

  test('half a range is refused, because one bound cannot describe an axis', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['range', '--from', '-2h'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('either --auto or both --from and --to');
  });

  test('--auto together with a bound is refused rather than one of them silently winning', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['range', '--auto', '--from', '-2h'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('--auto sets the axis on its own');
  });
});

describe.skipIf(!gitIsAvailable())('the two bounds a range cannot have', () => {
  test('a bound that is not a time says so, rather than only listing the spellings', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['range', '--from', 'garbage', '--to', 'now'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('could not be read as a time');
    expect(context.errorText()).toContain('--from "garbage"');
  });

  test('a --from at or after its --to is refused, because the axis would have no width', async () => {
    for (const [from, to] of [['2026-09-18T12:00', '2026-09-18T09:00'], ['2026-09-18T09:00', '2026-09-18T09:00']]) {
      const context  = contextHere();
      const exitCode = await runCommandLine(['range', '--from', from ?? '', '--to', to ?? ''], context);

      expect(exitCode, `${from} → ${to}`).toBe(1);
      expect(context.errorText(), `${from} → ${to}`).toContain('is not before --to');
    }
    expect(storedView()).toEqual({ kind: 'auto' });
  });

  test('a relative pair is never judged that way, since its written forms are not comparable', async () => {
    await run(['range', '--from', '-2h', '--to', 'now']);
    expect(storedView()).toMatchObject({ kind: 'relative', from: '-2h', to: 'now' });
  });
});
