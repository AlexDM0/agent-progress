/**
 * Preloaded by `bunfig.toml`: puts the `claude` trap (`src/testing/ClaudeLaunchTrap.ts`) first on this run's `PATH`, and fails the test
 * during which any process under the run executed `claude`, or the run itself for an attempt landing after the last test. Its statements
 * are its own registration, the reason it may do work at load.
 */
import { afterAll, afterEach } from 'bun:test';

import { environmentCopy, prependToExecutableSearchPath }   from '../shared/Environment.ts';
import { claudeLaunchTrapFolder, takeClaudeLaunchAttempts } from './ClaudeLaunchTrap.ts';

interface SpawnOptionsWithEnvironment {
  env?: Record<string, string | undefined>;
}

/** Bun's spawn without `env` uses the environment as it was at start, before the trap; it is handed the current one instead. */
function withTheCurrentEnvironment(spawnArguments: unknown[]): unknown[] {
  const [commandOrOptions, options] = spawnArguments;
  if (Array.isArray(commandOrOptions)) {
    const givenOptions = (options ?? {}) as SpawnOptionsWithEnvironment;
    return [commandOrOptions, { ...givenOptions, env: givenOptions.env ?? environmentCopy() }];
  }
  const givenOptions = commandOrOptions as SpawnOptionsWithEnvironment;
  return [{ ...givenOptions, env: givenOptions.env ?? environmentCopy() }];
}

function failOnAnyClaudeLaunchAttempt(): void {
  const attempts = takeClaudeLaunchAttempts();
  if (attempts.length === 0) return;
  throw new Error(`No spec may start a real agent session, but claude was executed ${attempts.length} time(s): ${attempts.join('; ')}`);
}

prependToExecutableSearchPath(claudeLaunchTrapFolder());

const spawnAsBunStarted     = Bun.spawn;
const spawnSyncAsBunStarted = Bun.spawnSync;
Bun.spawn     = ((...spawnArguments: unknown[]) => Reflect.apply(spawnAsBunStarted, Bun, withTheCurrentEnvironment(spawnArguments)) as unknown) as typeof Bun.spawn;
Bun.spawnSync = ((...spawnArguments: unknown[]) => Reflect.apply(spawnSyncAsBunStarted, Bun, withTheCurrentEnvironment(spawnArguments)) as unknown) as typeof Bun.spawnSync;

afterEach(failOnAnyClaudeLaunchAttempt);
afterAll(failOnAnyClaudeLaunchAttempt);
