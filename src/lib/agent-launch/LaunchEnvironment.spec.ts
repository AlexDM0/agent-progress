/**
 * A launched agent's environment is an allowlist, never an inheritance: a runner started from inside another agent session carries that
 * session's variables, which would change the child's tools. These cases hold the allowlist and that nothing else crosses.
 */
import { describe, expect, test } from 'bun:test';

import { INHERITED_VARIABLE_NAMES, launchEnvironmentOf } from './LaunchEnvironment.ts';

const PARENT_SESSION_ENVIRONMENT = {
  HOME:                         '/Users/example',
  PATH:                         '/usr/bin:/bin',
  USER:                         'example',
  LANG:                         'en_US.UTF-8',
  TMPDIR:                       '/private/tmp/example',
  SHELL:                        '/bin/zsh',
  CLAUDECODE:                   '1',
  CLAUDE_CODE_SESSION_ID:       '7a1f0c52-0001-4000-8000-000000000001',
  CLAUDE_CODE_MESSAGING_SOCKET: '/private/tmp/example/messaging.sock',
  ANTHROPIC_BASE_URL:           'http://127.0.0.1:9',
  CLAUDE_CODE_SIMPLE:           '1',
  UNSET_VARIABLE:               undefined,
};

describe('launchEnvironmentOf', () => {
  test('keeps exactly the allowlisted variables and drops every parent-session variable', () => {
    const environment = launchEnvironmentOf(PARENT_SESSION_ENVIRONMENT, {});
    expect(Object.keys(environment).sort()).toEqual([...INHERITED_VARIABLE_NAMES].sort());
    for (const nestingVariable of ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_SIMPLE']) {
      expect(Object.hasOwn(environment, nestingVariable)).toBe(false);
    }
  });

  test('adds the job variables, which win over an inherited one of the same name, and leaves out an allowlisted variable that is unset', () => {
    const environment = launchEnvironmentOf({ HOME: '/Users/example', PATH: '/bin' }, { EXAMPLE_JOB_ID: 'J1', PATH: '/opt/bin' });
    expect(environment).toEqual({ HOME: '/Users/example', PATH: '/opt/bin', EXAMPLE_JOB_ID: 'J1' });
  });
});
