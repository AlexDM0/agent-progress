/**
 * A ticket's group worded as integration. The cases that matter: a member names the group branch and the ticket that releases it, or
 * that none does yet; the release ticket names the members it brings along; and a ticket in no group gets no fact and no mark.
 */

import { describe, expect, test } from 'bun:test';
import type { PageTicket }        from '../../src/shared/@types/PagePayload.ts';
import { IntegrationMarkupUtil }  from './IntegrationMarkupUtil.ts';

function exampleTicket(changes: Partial<PageTicket>): PageTicket {
  return {
    id:          '001',
    title:       'Example',
    type:        'change',
    status:      'pending',
    filed:       '2026-09-18T20:00:00+02:00',
    updated:     '2026-09-18T20:00:00+02:00',
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    '/example/.agent-progress/tickets/001-example.md',
    bodyHtml:    '',
    ...changes,
  };
}

const MEMBER   = exampleTicket({ id: '011', group: 'payments' });
const RELEASE  = exampleTicket({ id: '013', group: 'payments', releasesGroup: true });
const LONE     = exampleTicket({ id: '020' });
const TICKETS  = [MEMBER, RELEASE, exampleTicket({ id: '012', group: 'payments' }), LONE];

describe('integrationFactValueMarkup', () => {
  test('words a member as landing together on the group branch, released with the release ticket', () => {
    expect(IntegrationMarkupUtil.integrationFactValueMarkup(MEMBER, TICKETS, 'ticket-detail')).toBe(
      '<span class="ap-integration">lands together on <span class="ap-integration-branch">group-payments</span>, released with <a href="#ap-ticket-013">#013</a></span>',
    );
  });

  test('words the release ticket as releasing the branch with the other members', () => {
    expect(IntegrationMarkupUtil.integrationFactValueMarkup(RELEASE, TICKETS, 'ticket-detail')).toBe(
      '<span class="ap-integration">releases <span class="ap-integration-branch">group-payments</span> with '
      + '<a href="#ap-ticket-011">#011</a>, <a href="#ap-ticket-012">#012</a></span>',
    );
  });

  test('says when no ticket releases the group yet', () => {
    expect(IntegrationMarkupUtil.integrationFactValueMarkup(MEMBER, [MEMBER], 'ticket-detail')).toContain(', no release ticket yet</span>');
  });

  test('gives a ticket in no group nothing', () => {
    expect(IntegrationMarkupUtil.integrationFactValueMarkup(LONE, TICKETS, 'ticket-detail')).toBe('');
    expect(IntegrationMarkupUtil.integrationMarkMarkup(LONE, TICKETS, '')).toBe('');
  });
});

describe('integrationMarkMarkup', () => {
  test('marks a grouped title with the branch icon and the group, its integration in plain words on hover', () => {
    const markup = IntegrationMarkupUtil.integrationMarkMarkup(MEMBER, TICKETS, 'payments');

    expect(markup).toStartWith('<span class="ap-integration-mark" title="Lands together on group-payments, released with #013"><svg');
    expect(markup).toEndWith('</svg>payments</span>');
  });
});
