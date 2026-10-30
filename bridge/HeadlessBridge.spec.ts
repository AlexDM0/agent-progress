/**
 * The Bridge served by a real Overseer and loaded in headless Chrome, skipped by name where Chrome is missing. What matters: the shell
 * renders the board's project from the live event stream, every tab routes, and nothing errs: no console error, no exception, no failed
 * request and no CSP violation.
 */
import { expect } from 'bun:test';

import { chromeExecutablePath, testWhenChromeIsPresent } from '../src/testing/ToolGuard.ts';
import { BRIDGE_TABS }                                   from './shell/HashRouter.ts';
import { HEADLESS_CHECK_PROJECT, readTheBridgeHeadless } from './testing/HeadlessBridgeCheck.ts';

const HEADLESS_CHECK_TIMEOUT_MILLISECONDS = 90_000;

testWhenChromeIsPresent('the Bridge renders the live board in headless Chrome, routes every tab, and nothing errs', async () => {
  const reading = await readTheBridgeHeadless(chromeExecutablePath() ?? '');
  expect(reading.problems).toEqual([]);
  expect(reading.projectHeading).toBe(HEADLESS_CHECK_PROJECT);
  expect(reading.visitedTabs).toEqual([...BRIDGE_TABS]);
}, HEADLESS_CHECK_TIMEOUT_MILLISECONDS);
