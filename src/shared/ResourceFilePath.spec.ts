/**
 * Where the files read at runtime are found. What matters is that the path is anchored to the package, not to the
 * working directory the linked binary runs in, and that the files the commands read are found through it.
 */
import { existsSync }             from 'node:fs';
import { isAbsolute, join }       from 'node:path';
import { describe, expect, test } from 'bun:test';

import { resourceFilePathOf } from './ResourceFilePath.ts';

describe('resourceFilePathOf', () => {
  test('the path it gives is absolute', () => {
    expect(isAbsolute(resourceFilePathOf('template.html'))).toBe(true);
  });

  test('the page template and a markdown template are found through it', () => {
    expect(existsSync(resourceFilePathOf('template.html'))).toBe(true);
    expect(existsSync(resourceFilePathOf('templates', 'AgentBrief.md'))).toBe(true);
  });

  test('the path is the package\'s resources folder, whatever the working directory', () => {
    expect(resourceFilePathOf('templates', 'TicketBody.md')).toBe(join(import.meta.dir, '..', '..', 'resources', 'templates', 'TicketBody.md'));
  });
});
