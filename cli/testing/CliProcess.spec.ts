/**
 * The process Overseer must refuse a directory outside the scratch root before it spawns the binary, or a refusal would be swallowed into an exit
 * code; and a spawned binary always runs with the fake agent and the `claude` trap first on its `PATH`, whatever a spec's environment says,
 * since a spec turning either off would let the binary start a real agent session.
 */
import { delimiter, join }        from 'node:path';
import { describe, expect, test } from 'bun:test';

import { fakeAgentVariableOf }                                from '../../src/shared/Environment.ts';
import { ORIGINAL_PRODUCT_NAMES, SIDE_BY_SIDE_PRODUCT_NAMES } from '../../src/shared/constants/ProductNames.ts';
import { claudeLaunchTrapFolder }                             from '../../src/testing/ClaudeLaunchTrap.ts';
import { childEnvironmentOf, runAgentProgress }               from './CliProcess.ts';

const REPOSITORY_DIRECTORY = join(import.meta.dir, '..', '..');

const FAKE_AGENT_VARIABLES = [ORIGINAL_PRODUCT_NAMES, SIDE_BY_SIDE_PRODUCT_NAMES].map((productNames) => fakeAgentVariableOf(productNames));

describe('the refusal before a command runs', () => {
  test('refuses the repository under test before any command can run', async () => {
    await expect(runAgentProgress(['ticket', 'add', '--type', 'ticket', 'Isolation probe'], { currentDirectory: REPOSITORY_DIRECTORY })).rejects.toThrow('which is not isolated');
  });
});

describe('the environment of a spawned binary', () => {
  test('a spec\'s environment cannot turn the fake agent off under either program\'s names', () => {
    const switchedOff = Object.fromEntries(FAKE_AGENT_VARIABLES.map((variable) => [variable, '0']));
    const childEnvironment = childEnvironmentOf(switchedOff, '/example/home');
    for (const variable of FAKE_AGENT_VARIABLES) expect(childEnvironment[variable], variable).toBe('1');
  });

  test('the claude trap leads the PATH, before a PATH the spec hands over and before an inherited one', () => {
    const handedOver = childEnvironmentOf({ PATH: '/example/bin' }, '/example/home');
    expect(handedOver['PATH']).toBe([claudeLaunchTrapFolder(), '/example/bin'].join(delimiter));
    expect(childEnvironmentOf(undefined, '/example/home')['PATH']?.split(delimiter)[0]).toBe(claudeLaunchTrapFolder());
  });
});
