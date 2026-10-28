/**
 * The relay request carries a command and, beside it, the body a verb read; reading it back restores the command whole. A request or
 * command naming a job, a role or an admission is refused `relay-identity-mismatch`, because identity is the folder's. A reply is read
 * only in its two shapes; anything else is malformed rather than guessed at.
 */
import { describe, expect, test } from 'bun:test';

import type { ControlCommand } from '../../../shared/@types/ControlCommand.ts';
import type { RelayReply }     from '../@types/RelayFormat.ts';
import { RelayFormatUtil }     from './RelayFormatUtil.ts';

const FILING: ControlCommand = {
  kind:          'ticket-add',
  title:         'The export dialog forgets the folder',
  type:          'bug',
  priority:      'low',
  dependsOn:     [],
  epics:         [],
  network:       [],
  introducedBy:  null,
  foundInReview: '003',
  bodyText:      '## Report\nReported by Alex Example.\n',
};

describe('requestOf and requestReadingOf', () => {
  test('a filing\'s body travels beside the command and is restored on reading, the request at relay format 1', () => {
    const request = RelayFormatUtil.requestOf('5f0c', FILING);
    expect(request).toEqual({
      relayFormatVersion: 1, requestId: '5f0c', command: { ...FILING, bodyText: null }, bodyText: '## Report\nReported by Alex Example.\n'
    });
    expect(RelayFormatUtil.requestReadingOf(JSON.stringify(request))).toEqual({ verdict: 'read', requestId: '5f0c', command: FILING });
  });

  test('an epic body and a command without a body round-trip too', () => {
    const epic: ControlCommand = {
      kind: 'epic-add', key: 'checkout', title: 'Checkout', bodyText: 'Why.\n'
    };
    const limit: ControlCommand = { kind: 'concurrency-set', limit: 3 };
    expect(RelayFormatUtil.requestReadingOf(JSON.stringify(RelayFormatUtil.requestOf('a', epic)))).toEqual({ verdict: 'read', requestId: 'a', command: epic });
    expect(RelayFormatUtil.requestOf('b', limit)).toEqual({ relayFormatVersion: 1, requestId: 'b', command: limit });
    expect(RelayFormatUtil.requestReadingOf(JSON.stringify(RelayFormatUtil.requestOf('b', limit)))).toEqual({ verdict: 'read', requestId: 'b', command: limit });
  });

  test.each([
    ['a forged role on the request', { role: 'product-owner' }, {}],
    ['a forged job id on the request', { jobId: 'J1' }, {}],
    ['a forged role inside the command', {}, { role: 'orchestrator' }],
    ['an admission inside the command', {}, { admission: { filedByJob: 'J1' } }],
  ])('%s is refused relay-identity-mismatch', (_case, requestFields, commandFields) => {
    const request = { ...RelayFormatUtil.requestOf('c', FILING), ...requestFields };
    const text    = JSON.stringify({ ...request, command: { ...request.command, ...commandFields } });
    expect(RelayFormatUtil.requestReadingOf(text)).toEqual({ verdict: 'refused', reason: 'relay-identity-mismatch' });
  });

  test.each([
    ['not JSON', '{'],
    ['another format version', JSON.stringify({ relayFormatVersion: 2, requestId: 'd', command: { kind: 'concurrency-set', limit: 3 } })],
    ['no request id', JSON.stringify({ relayFormatVersion: 1, command: { kind: 'concurrency-set', limit: 3 } })],
    ['a command without a kind', JSON.stringify({ relayFormatVersion: 1, requestId: 'd', command: { limit: 3 } })],
    ['a body beside a command that takes none', JSON.stringify({
      relayFormatVersion: 1, requestId: 'd', command: { kind: 'concurrency-set', limit: 3 }, bodyText: 'x'
    })],
  ])('a request that is %s is malformed', (_case, text) => {
    expect(RelayFormatUtil.requestReadingOf(text)).toEqual({ verdict: 'refused', reason: 'malformed-relay-request' });
  });
});

describe('replyReadingOf', () => {
  test('reads a done reply naming the filed ticket and a refused one carrying its detail', () => {
    const done: RelayReply    = {
      relayFormatVersion: 1, requestId: 'e', outcome: 'done', ticketIds: ['014']
    };
    const refused: RelayReply = {
      relayFormatVersion: 1,
      requestId:          'e',
      outcome:            'refused',
      status:             'refused',
      detail:             { kind: 'role-command-refused', reason: 'worker-filing-limit', commandKind: 'ticket-add' },
    };
    expect(RelayFormatUtil.replyReadingOf(JSON.stringify(done))).toEqual({ verdict: 'read', reply: done });
    expect(RelayFormatUtil.replyReadingOf(JSON.stringify(refused))).toEqual({ verdict: 'read', reply: refused });
  });

  test.each([
    ['not JSON', 'nope'],
    ['an unknown outcome', JSON.stringify({
      relayFormatVersion: 1, requestId: 'e', outcome: 'maybe', ticketIds: []
    })],
    ['a refusal with no detail', JSON.stringify({
      relayFormatVersion: 1, requestId: 'e', outcome: 'refused', status: 'refused'
    })],
    ['a done reply without ticket ids', JSON.stringify({ relayFormatVersion: 1, requestId: 'e', outcome: 'done' })],
  ])('a reply that is %s is malformed', (_case, text) => {
    expect(RelayFormatUtil.replyReadingOf(text)).toEqual({ verdict: 'malformed' });
  });
});
