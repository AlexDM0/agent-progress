/**
 * Reading a client line as a protocol 1 frame: each well-formed frame reads as itself with extra keys dropped, and every malformed one
 * reads as `null`, which the host answers as a protocol refusal. The versions the package names are integers.
 */
import { expect, test } from 'bun:test';

import type { ClientFrame }                                from './@types/HostFrame.ts';
import { clientFrameOf, hostFrameLineOf }                  from './HostFrames.ts';
import { EVENT_LOG_FORMAT_VERSION, HOST_PROTOCOL_VERSION } from './constants/HostProtocol.ts';

test.each([
  ['hello', {
    kind: 'hello', protocolVersion: 1, sinceSequence: 4, hostSecret: 'example-secret'
  }],
  ['write', { kind: 'write', line: '{"type":"user"}' }],
  ['close-input', { kind: 'close-input' }],
  ['stop', { kind: 'stop', graceMilliseconds: 3000 }],
])('reads %s as itself, extra keys dropped', (_title, frame) => {
  expect(clientFrameOf(JSON.stringify({ ...frame, later: true }))).toEqual(frame as ClientFrame);
});

test.each([
  ['not JSON', '{'],
  ['a list', '[]'],
  ['an unknown kind', '{"kind":"answer"}'],
  ['a hello with a negative cursor', '{"kind":"hello","protocolVersion":1,"sinceSequence":-1,"hostSecret":"s"}'],
  ['a hello with no secret', '{"kind":"hello","protocolVersion":1,"sinceSequence":0}'],
  ['a hello with a fractional protocol', '{"kind":"hello","protocolVersion":1.5,"sinceSequence":0,"hostSecret":"s"}'],
  ['a write of two lines', '{"kind":"write","line":"one\\ntwo"}'],
  ['a stop with no grace', '{"kind":"stop"}'],
])('reads %s as no frame', (_title, line) => {
  expect(clientFrameOf(line)).toBeNull();
});

test('writes a host frame as one JSON line', () => {
  expect(hostFrameLineOf({ kind: 'refused', reason: 'secret' })).toBe('{"kind":"refused","reason":"secret"}\n');
});

test('the protocol and event log format versions are integers', () => {
  expect(Number.isSafeInteger(HOST_PROTOCOL_VERSION) && Number.isSafeInteger(EVENT_LOG_FORMAT_VERSION)).toBe(true);
});
