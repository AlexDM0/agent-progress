/**
 * Standing replies as pure data rules: every `whenAllEqual` path must hold and no `whenNoneEqual` path may, the request id is filled in as
 * JSON string content, and a line that is no JSON object, matches nothing, or lacks the id its template needs is never answered.
 */
import { expect, test } from 'bun:test';

import { type StandingReply, standingReplyFor } from './StandingReplies.ts';

const DENY_ALL_BUT_QUESTIONS: StandingReply = {
  whenAllEqual:  { 'type': 'control_request', 'request.subtype': 'can_use_tool' },
  whenNoneEqual: { 'request.tool_name': 'AskUserQuestion' },
  replyTemplate: '{"request_id":"{{request_id}}","behavior":"deny"}',
};

function permissionRequest(toolName: string, requestIdentifier: unknown = 'r-7'): string {
  return JSON.stringify({ type: 'control_request', request_id: requestIdentifier, request: { subtype: 'can_use_tool', tool_name: toolName } });
}

test('answers a matching line with its request id filled in', () => {
  expect(standingReplyFor(permissionRequest('Bash'), [DENY_ALL_BUT_QUESTIONS])).toBe('{"request_id":"r-7","behavior":"deny"}');
});

test('never answers a line a whenNoneEqual path holds, such as a question', () => {
  expect(standingReplyFor(permissionRequest('AskUserQuestion'), [DENY_ALL_BUT_QUESTIONS])).toBeNull();
});

test('never answers a line missing a whenAllEqual value, or one that is not a JSON object', () => {
  expect(standingReplyFor('{"type":"control_request","request_id":"r-7","request":{"subtype":"interrupt"}}', [DENY_ALL_BUT_QUESTIONS])).toBeNull();
  expect(standingReplyFor('plain text', [DENY_ALL_BUT_QUESTIONS])).toBeNull();
  expect(standingReplyFor('["control_request"]', [DENY_ALL_BUT_QUESTIONS])).toBeNull();
  expect(standingReplyFor(permissionRequest('Bash'), [])).toBeNull();
});

test('a template needing a request id the line lacks is not sent, and the id is escaped as JSON string content', () => {
  expect(standingReplyFor(permissionRequest('Bash', 7), [DENY_ALL_BUT_QUESTIONS])).toBeNull();
  const reply = standingReplyFor(permissionRequest('Bash', 'r-"8"'), [DENY_ALL_BUT_QUESTIONS]) ?? '';
  expect(JSON.parse(reply)).toEqual({ request_id: 'r-"8"', behavior: 'deny' });
});

test('a path is read only through own keys', () => {
  const rule: StandingReply = { whenAllEqual: { 'request.constructor': 'x' }, whenNoneEqual: {}, replyTemplate: 'reply' };
  expect(standingReplyFor('{"request":{}}', [rule])).toBeNull();
});
