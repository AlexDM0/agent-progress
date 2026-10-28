/**
 * The launch file a host reads after its claim: a well-formed one reads with later keys ignored, and each malformed field is a verdict
 * naming it, never a throw, so the host can record why it spawned nothing.
 */
import { expect, test } from 'bun:test';

import { hostLaunchOf }          from './HostLaunch.ts';
import { HOST_PROTOCOL_VERSION } from './constants/HostProtocol.ts';

const WELL_FORMED = {
  kind:             'agent' as const,
  argv:             ['/bin/echo', 'hello'],
  environment:      { PATH: '/bin' },
  workingDirectory: '/tmp',
  standingReplies:  [{ whenAllEqual: { type: 'control_request' }, whenNoneEqual: {}, replyTemplate: 'reply' }],
  protocolVersion:  HOST_PROTOCOL_VERSION,
};

test('reads a well-formed launch file and leaves a key a later protocol adds unread', () => {
  expect(hostLaunchOf(JSON.stringify({ ...WELL_FORMED, hostSecret: 'later' }))).toEqual({ verdict: 'read', launch: WELL_FORMED });
});

test.each([
  ['not JSON', '{', 'not JSON'],
  ['a list', '[]', 'not a JSON object'],
  ['an unknown kind', JSON.stringify({ ...WELL_FORMED, kind: 'daemon' }), 'kind'],
  ['an empty argv', JSON.stringify({ ...WELL_FORMED, argv: [] }), 'argv'],
  ['a numeric environment value', JSON.stringify({ ...WELL_FORMED, environment: { COUNT: 1 } }), 'environment'],
  ['no working directory', JSON.stringify({ ...WELL_FORMED, workingDirectory: null }), 'workingDirectory'],
  ['a rule with no template', JSON.stringify({ ...WELL_FORMED, standingReplies: [{ whenAllEqual: {}, whenNoneEqual: {} }] }), 'standingReplies'],
  ['another protocol', JSON.stringify({ ...WELL_FORMED, protocolVersion: HOST_PROTOCOL_VERSION + 1 }), 'protocolVersion'],
])('refuses %s, naming it', (_title, launchText, namedInReason) => {
  const reading = hostLaunchOf(launchText);
  expect(reading.verdict).toBe('unreadable');
  expect(reading.verdict === 'unreadable' ? reading.reason : '').toContain(namedInReason);
});
