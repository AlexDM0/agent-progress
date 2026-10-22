/**
 * The predicate that decides whether a spawned child can register a scratch tracker: a path under `/tmp` or `/var/tmp`, or either folder
 * itself, lies under a fixed temp folder whatever the symlinks (`/tmp` is `/private/tmp` on macOS); a sibling sharing only a name prefix
 * and a path elsewhere do not.
 */
import { expect, test } from 'bun:test';

import { pathLiesUnderAFixedTemporaryFolder } from './FixedTemporaryFolders.ts';

test('a path under /tmp lies under a fixed temp folder', () => {
  expect(pathLiesUnderAFixedTemporaryFolder('/tmp/agent-progress-example')).toBe(true);
  expect(pathLiesUnderAFixedTemporaryFolder('/tmp')).toBe(true);
});

test('a path under /var/tmp lies under a fixed temp folder', () => {
  expect(pathLiesUnderAFixedTemporaryFolder('/var/tmp/agent-progress-example')).toBe(true);
});

test('a path outside both does not, nor does a sibling sharing the name prefix', () => {
  expect(pathLiesUnderAFixedTemporaryFolder('/opt/example-agency/agent-progress-example')).toBe(false);
  expect(pathLiesUnderAFixedTemporaryFolder('/tmpfolder/agent-progress-example')).toBe(false);
  expect(pathLiesUnderAFixedTemporaryFolder('/var/folders/agent-progress-example')).toBe(false);
});
