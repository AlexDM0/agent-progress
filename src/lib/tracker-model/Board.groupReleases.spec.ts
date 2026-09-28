/**
 * A group's release ticket and its release bundle. The mark is refused, before anything changed, on an ungrouped ticket, a settled one and
 * in a group that already has one; the bundle follows dependencies only inside the group, so neither an out-of-group dependency nor an
 * in-group ticket that depends on the release ticket, nor one only reached through another group, is in it.
 */
import { describe, expect, test } from 'bun:test';

import type { BoardFixture }                            from '../../testing/BoardFixtures.ts';
import { boardFixture, refusalDetailOf, ticketFixture } from '../../testing/BoardFixtures.ts';
import type { BoardRefusalDetail }                      from './BoardRefusal.ts';

const CHANGED_AT = '2026-09-28T15:00:00+02:00';
const GROUP      = 'example-shop';

function expectRefusedWithNothingChanged(fixture: BoardFixture, change: () => unknown, reason: BoardRefusalDetail['reason']): BoardRefusalDetail {
  const ticketsBefore = structuredClone(fixture.tickets);
  const detail        = refusalDetailOf(change);
  expect(detail.reason).toBe(reason);
  expect(fixture.tickets).toEqual(ticketsBefore);
  expect(fixture.records).toEqual([]);
  expect(fixture.board.changedTickets()).toEqual([]);
  return detail;
}

describe('marking a release ticket', () => {
  test('sets the key on that ticket alone and logs the group', () => {
    const fixture = boardFixture({ tickets: [ticketFixture({ id: '001', group: GROUP }), ticketFixture({ id: '002', group: GROUP })] });

    const changed = fixture.board.markReleaseTicket('002', CHANGED_AT);

    expect(changed.ticket.frontmatter.releasesGroup).toBe(true);
    expect(fixture.tickets[0]?.frontmatter.releasesGroup).toBeUndefined();
    expect(fixture.records).toEqual([{
      at: CHANGED_AT, kind: 'ticket-release-marked', ticketId: '002', fields: { group: GROUP }
    }]);
  });

  test('clearing removes the key and logs it', () => {
    const fixture = boardFixture({ tickets: [ticketFixture({ id: '001', group: GROUP, releasesGroup: true })] });

    const changed = fixture.board.clearReleaseTicket('001', CHANGED_AT);

    expect(Object.hasOwn(changed.ticket.frontmatter, 'releasesGroup')).toBe(false);
    expect(fixture.records).toEqual([{
      at: CHANGED_AT, kind: 'ticket-release-cleared', ticketId: '001', fields: {}
    }]);
  });

  test('is refused on a ticket with no group', () => {
    const fixture = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
    expectRefusedWithNothingChanged(fixture, () => fixture.board.markReleaseTicket('001', CHANGED_AT), 'release-mark-of-an-ungrouped-ticket');
  });

  test('is refused when another ticket of the group is its release ticket, naming that ticket', () => {
    const fixture = boardFixture({ tickets: [ticketFixture({ id: '001', group: GROUP, releasesGroup: true }), ticketFixture({ id: '002', group: GROUP })] });
    const detail  = expectRefusedWithNothingChanged(fixture, () => fixture.board.markReleaseTicket('002', CHANGED_AT), 'group-already-has-a-release-ticket');
    expect(detail).toEqual({
      reason:          'group-already-has-a-release-ticket',
      ticketId:        '002',
      group:           GROUP,
      releaseTicketId: '001',
    });
  });

  test('a release ticket of another group does not count', () => {
    const fixture = boardFixture({ tickets: [ticketFixture({ id: '001', group: 'example-cart', releasesGroup: true }), ticketFixture({ id: '002', group: GROUP })] });
    expect(fixture.board.markReleaseTicket('002', CHANGED_AT).ticket.frontmatter.releasesGroup).toBe(true);
  });

  test('is refused on a delivered or abandoned ticket, marking or clearing', () => {
    for (const status of ['delivered', 'abandoned'] as const) {
      const fixture = boardFixture({
        tickets: [ticketFixture({ id: '001', group: GROUP, status }), ticketFixture({
          id: '002', group: GROUP, status, releasesGroup: true
        })]
      });
      expectRefusedWithNothingChanged(fixture, () => fixture.board.markReleaseTicket('001', CHANGED_AT), 'release-mark-of-a-settled-ticket');
      expectRefusedWithNothingChanged(fixture, () => fixture.board.clearReleaseTicket('002', CHANGED_AT), 'release-mark-of-a-settled-ticket');
    }
  });

  test('clearing a ticket that is not marked is refused', () => {
    const fixture = boardFixture({ tickets: [ticketFixture({ id: '001', group: GROUP })] });
    expectRefusedWithNothingChanged(fixture, () => fixture.board.clearReleaseTicket('001', CHANGED_AT), 'ticket-is-not-a-release-ticket');
  });
});

describe('the release bundle', () => {
  /*
   * 005 is the release ticket and depends on 003 and 004; 003 depends on 001 and on 008 (another group), 004 on 001 and 002.
   * 008 depends on 007, in the group, reached only through 008. 006 depends on 005, so it waits on the release rather than being in it.
   */
  const BRANCHING_GRAPH = [
    ticketFixture({ id: '001', group: GROUP }),
    ticketFixture({ id: '002', group: GROUP }),
    ticketFixture({ id: '003', group: GROUP, dependsOn: ['001', '008'] }),
    ticketFixture({ id: '004', group: GROUP, dependsOn: ['001', '002'] }),
    ticketFixture({
      id: '005', group: GROUP, dependsOn: ['003', '004'], releasesGroup: true
    }),
    ticketFixture({ id: '006', group: GROUP, dependsOn: ['005'] }),
    ticketFixture({ id: '007', group: GROUP }),
    ticketFixture({ id: '008', group: 'example-cart', dependsOn: ['007'] }),
    ticketFixture({ id: '009', group: GROUP }),
  ];

  test('is the release ticket and its transitive in-group dependencies, in id order', () => {
    const { board } = boardFixture({ tickets: structuredClone(BRANCHING_GRAPH) });
    expect(board.releaseBundleOf(GROUP)).toEqual(['001', '002', '003', '004', '005']);
  });

  test('leaves out an in-group ticket that depends on the release ticket', () => {
    const { board } = boardFixture({ tickets: structuredClone(BRANCHING_GRAPH) });
    expect(board.releaseBundleOf(GROUP)).not.toContain('006');
  });

  test('follows no dependency outside the group, nor an in-group ticket reached only through one', () => {
    const { board } = boardFixture({ tickets: structuredClone(BRANCHING_GRAPH) });
    expect(board.releaseBundleOf(GROUP)).not.toContain('008');
    expect(board.releaseBundleOf(GROUP)).not.toContain('007');
  });

  test('is empty for a group with no release ticket', () => {
    const { board } = boardFixture({ tickets: structuredClone(BRANCHING_GRAPH) });
    expect(board.releaseBundleOf('example-cart')).toEqual([]);
  });
});
