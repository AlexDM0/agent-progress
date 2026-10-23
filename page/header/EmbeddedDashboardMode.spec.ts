/**
 * Which query embeds the page in agent-dashboard. What matters: only `embedded=dashboard` does, among other parameters too, while
 * no query, another value, a differently cased value or the bare parameter leave the normal page.
 */

import { describe, expect, test } from 'bun:test';
import { embedsInDashboard }      from './EmbeddedDashboardMode.ts';

describe('embedsInDashboard', () => {
  test('is true for embedded=dashboard, alone or among other parameters', () => {
    expect(embedsInDashboard('?embedded=dashboard')).toBe(true);
    expect(embedsInDashboard('?view=kanban&embedded=dashboard')).toBe(true);
  });

  test('is false without the parameter or with any other value', () => {
    expect(embedsInDashboard('')).toBe(false);
    expect(embedsInDashboard('?embedded')).toBe(false);
    expect(embedsInDashboard('?embedded=')).toBe(false);
    expect(embedsInDashboard('?embedded=Dashboard')).toBe(false);
    expect(embedsInDashboard('?embedded=sidebar')).toBe(false);
  });
});
