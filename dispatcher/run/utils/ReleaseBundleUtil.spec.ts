/**
 * The release bundle the dispatcher reads off a group's tickets. What matters: only an open ticket marked `releasesGroup` is the release ticket,
 * so a settled mark leaves the group with no bundle; the bundle follows dependencies transitively but never outside the group; and a ticket of
 * the group nothing in the bundle depends on stays out, which is what lets a single-ticket run take it.
 */
import { describe, expect, test } from 'bun:test';

import type { ReleaseBundleTicket } from '../../@types/AgentReadings.ts';
import { ReleaseBundleUtil }        from './ReleaseBundleUtil.ts';

const { releaseTicketOf, bundleOf, releaseBundleIdsOf } = ReleaseBundleUtil;

function groupTicket(id: string, dependsOn: string[], releasesGroup: boolean = false, status: string = 'pending'): ReleaseBundleTicket {
  return {
    id,
    status,
    dependsOn,
    releasesGroup,
  };
}

const CHAIN_WITH_A_LOOSE_TICKET = [
  groupTicket('001', ['900']),
  groupTicket('002', ['001']),
  groupTicket('003', ['002'], true),
  groupTicket('004', []),
];

describe('the release ticket', () => {
  test('is the open ticket marked as the group\'s release', () => {
    expect(releaseTicketOf(CHAIN_WITH_A_LOOSE_TICKET)?.id).toBe('003');
  });

  test('is none when the only mark sits on a delivered or abandoned ticket', () => {
    expect(releaseTicketOf([groupTicket('001', []), groupTicket('002', ['001'], true, 'delivered')])).toBeUndefined();
    expect(releaseTicketOf([groupTicket('001', []), groupTicket('002', ['001'], true, 'abandoned')])).toBeUndefined();
  });
});

describe('the bundle', () => {
  test('holds the release ticket and its in-group dependencies, transitively, never a dependency outside the group', () => {
    const releaseTicket = CHAIN_WITH_A_LOOSE_TICKET[2] ?? groupTicket('', []);
    expect(bundleOf(CHAIN_WITH_A_LOOSE_TICKET, releaseTicket).map((ticket) => ticket.id).sort()).toEqual(['001', '002', '003']);
  });

  test('leaves out a ticket of the group the release ticket does not depend on', () => {
    expect(releaseBundleIdsOf(CHAIN_WITH_A_LOOSE_TICKET)).not.toContain('004');
  });

  test('is empty while the group has no open release ticket', () => {
    expect(releaseBundleIdsOf([groupTicket('001', []), groupTicket('002', ['001'])])).toEqual([]);
  });

  test('survives a circle of dependencies, each ticket once', () => {
    expect(releaseBundleIdsOf([groupTicket('001', ['002']), groupTicket('002', ['001'], true)]).sort()).toEqual(['001', '002']);
  });
});
