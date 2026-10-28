/**
 * The role table of design section 4.4, case by case: what a worker may file and how its filing is stamped, the worker limit, the product
 * owner's own-draft rule, the orchestrator's incident moves, and the planted forgeries (a `role`, a `jobId` or an admission in the command).
 * Identity is the job record's, so a request in another job's folder is judged as that folder's job, which the last case plants.
 */
import { describe, expect, test } from 'bun:test';

import type { JobRole }                          from '../../lib/tracker-model/@types/Job.ts';
import type { ControlCommand, ControlCommandOf } from '../../shared/@types/ControlCommand.ts';
import { WORKER_FILINGS_PER_JOB }                from '../../shared/constants/RunnerLimits.ts';
import { RoleCommandPolicy, type RelayingJob }   from './RoleCommandPolicy.ts';

function jobOf(role: JobRole | null, overrides: Partial<RelayingJob> = {}): RelayingJob {
  return {
    id: 'J12', role, filedTickets: [], deliveredIncidents: [], ...overrides
  };
}

function lowFinding(overrides: Partial<ControlCommandOf<'ticket-add'>> = {}): ControlCommandOf<'ticket-add'> {
  return {
    kind:          'ticket-add',
    title:         'The export dialog forgets the folder',
    type:          'bug',
    priority:      'low',
    dependsOn:     [],
    epics:         [],
    network:       [],
    introducedBy:  null,
    foundInReview: '003',
    bodyText:      null,
    ...overrides,
  };
}

const EDIT_OF_TICKET_7: ControlCommand = {
  kind: 'ticket-edit', ticketReference: '#7', title: 'Sharper title', bodyText: null, appendsBody: false, allowsPastPending: false
};

describe('builder, reviewer and merge-fix', () => {
  test.each(['builder', 'reviewer', 'merge-fix'] as const)('%s files a low finding stamped with its job and the orchestrator route', (role) => {
    expect(RoleCommandPolicy.verdictOf(jobOf(role), lowFinding())).toEqual({
      verdict: 'admitted',
      command: { ...lowFinding(), admission: { filedByJob: 'J12', findingRoute: 'orchestrator' } },
    });
  });

  test('--needs-user routes the finding to User', () => {
    const verdict = RoleCommandPolicy.verdictOf(jobOf('builder'), lowFinding({ needsUser: true }));
    expect(verdict).toEqual({ verdict: 'admitted', command: { ...lowFinding({ needsUser: true }), admission: { filedByJob: 'J12', findingRoute: 'user' } } });
  });

  test('size, type, body and both ticket links are a finding\'s flags', () => {
    const command = lowFinding({
      size: 'S', type: 'research', bodyText: '## Report\nFound.\n', introducedBy: '002'
    });
    expect(RoleCommandPolicy.verdictOf(jobOf('reviewer'), command).verdict).toBe('admitted');
  });

  test.each([
    ['no priority', {}],
    ['normal priority', { priority: 'normal' }],
    ['a model', { model: 'opus' }],
    ['an effort', { effort: 'high' }],
    ['a group', { group: 'export-dialog' }],
    ['dependencies', { dependsOn: ['004'] }],
    ['epics', { epics: ['checkout'] }],
    ['network', { network: ['example.com'] }],
  ] as const)('a filing with %s is refused worker-filing-flag', (_case, overrides) => {
    const { priority: _lowPriority, ...withoutPriority } = lowFinding();
    const command = { ...withoutPriority, ...overrides } as ControlCommand;
    expect(RoleCommandPolicy.verdictOf(jobOf('builder'), command)).toEqual({ verdict: 'refused', reason: 'worker-filing-flag' });
  });

  test('the filing past WORKER_FILINGS_PER_JOB is refused worker-filing-limit, the one before it admitted', () => {
    const filedTickets = Array.from({ length: WORKER_FILINGS_PER_JOB }, (_unused, index) => ({ id: String(index + 1).padStart(3, '0'), status: 'draft' as const }));
    expect(RoleCommandPolicy.verdictOf(jobOf('builder', { filedTickets: filedTickets.slice(1) }), lowFinding()).verdict).toBe('admitted');
    expect(RoleCommandPolicy.verdictOf(jobOf('builder', { filedTickets }), lowFinding())).toEqual({ verdict: 'refused', reason: 'worker-filing-limit' });
  });

  test('every other command is refused for a worker', () => {
    expect(RoleCommandPolicy.verdictOf(jobOf('builder'), EDIT_OF_TICKET_7)).toEqual({ verdict: 'refused', reason: 'command-not-allowed-for-role' });
    expect(RoleCommandPolicy.verdictOf(jobOf('reviewer'), { kind: 'ticket-ready', ticketReferences: ['7'] }).verdict).toBe('refused');
  });
});

describe('resolver and resolution-review', () => {
  test.each(['resolver', 'resolution-review'] as const)('%s may relay nothing, not even a low finding', (role) => {
    expect(RoleCommandPolicy.verdictOf(jobOf(role), lowFinding())).toEqual({ verdict: 'refused', reason: 'command-not-allowed-for-role' });
  });

  test('a job with no role relays nothing', () => {
    expect(RoleCommandPolicy.verdictOf(jobOf(null), lowFinding()).verdict).toBe('refused');
  });
});

describe('product-owner', () => {
  test('files at any priority, with --network, stamped with its job and no finding route', () => {
    const command = lowFinding({ priority: 'high', network: ['api.example.com'] });
    expect(RoleCommandPolicy.verdictOf(jobOf('product-owner'), command)).toEqual({ verdict: 'admitted', command: { ...command, admission: { filedByJob: 'J12' } } });
  });

  test('--needs-user is a worker\'s flag, refused worker-filing-flag', () => {
    expect(RoleCommandPolicy.verdictOf(jobOf('product-owner'), lowFinding({ needsUser: true }))).toEqual({ verdict: 'refused', reason: 'worker-filing-flag' });
  });

  test('edits its own draft, and not a draft another job filed or its own once readied', () => {
    expect(RoleCommandPolicy.verdictOf(jobOf('product-owner', { filedTickets: [{ id: '007', status: 'draft' }] }), EDIT_OF_TICKET_7).verdict).toBe('admitted');
    expect(RoleCommandPolicy.verdictOf(jobOf('product-owner', { filedTickets: [{ id: '008', status: 'draft' }] }), EDIT_OF_TICKET_7))
      .toEqual({ verdict: 'refused', reason: 'not-own-draft' });
    expect(RoleCommandPolicy.verdictOf(jobOf('product-owner', { filedTickets: [{ id: '007', status: 'pending' }] }), EDIT_OF_TICKET_7))
      .toEqual({ verdict: 'refused', reason: 'not-own-draft' });
  });

  test('ticket-depends, epic-add and the draft kinds run on anything; ticket-ready never', () => {
    const job = jobOf('product-owner');
    expect(RoleCommandPolicy.verdictOf(job, {
      kind: 'ticket-depends', ticketReference: '9', edit: 'add', ticketIds: ['010']
    }).verdict).toBe('admitted');
    expect(RoleCommandPolicy.verdictOf(job, {
      kind: 'epic-add', key: 'checkout', title: 'Checkout', bodyText: ''
    }).verdict).toBe('admitted');
    expect(RoleCommandPolicy.verdictOf(job, {
      kind: 'draft-note', draftId: 'D1', text: 'Assumed EUR.', noteKind: 'assumption'
    }).verdict).toBe('admitted');
    expect(RoleCommandPolicy.verdictOf(job, { kind: 'ticket-ready', ticketReferences: ['7'] })).toEqual({ verdict: 'refused', reason: 'command-not-allowed-for-role' });
    expect(RoleCommandPolicy.verdictOf(job, { kind: 'concurrency-set', limit: 3 }).verdict).toBe('refused');
  });
});

describe('orchestrator', () => {
  const FINDINGS_DELIVERED = { id: 'I4', kind: 'findings-delivered' as const, ticketIds: ['011', '012'] };

  test('readies a finding the named findings-delivered incident lists', () => {
    const command: ControlCommand = { kind: 'ticket-ready', ticketReferences: ['#11'], incidentId: 'I4' };
    expect(RoleCommandPolicy.verdictOf(jobOf('orchestrator', { deliveredIncidents: [FINDINGS_DELIVERED] }), command)).toEqual({ verdict: 'admitted', command });
  });

  test('a ticket the incident does not list is refused finding-not-listed', () => {
    const command: ControlCommand = { kind: 'ticket-ready', ticketReferences: ['11', '13'], incidentId: 'I4' };
    expect(RoleCommandPolicy.verdictOf(jobOf('orchestrator', { deliveredIncidents: [FINDINGS_DELIVERED] }), command))
      .toEqual({ verdict: 'refused', reason: 'finding-not-listed' });
  });

  test('a move naming no delivered incident, or one its kind does not allow, is refused incident-move-not-allowed', () => {
    const delivered = { deliveredIncidents: [FINDINGS_DELIVERED, { id: 'I5', kind: 'blocked' as const, ticketIds: ['011'] }] };
    expect(RoleCommandPolicy.verdictOf(jobOf('orchestrator', delivered), { kind: 'ticket-ready', ticketReferences: ['11'] }))
      .toEqual({ verdict: 'refused', reason: 'incident-move-not-allowed' });
    expect(RoleCommandPolicy.verdictOf(jobOf('orchestrator', delivered), { kind: 'ticket-ready', ticketReferences: ['11'], incidentId: 'I5' }))
      .toEqual({ verdict: 'refused', reason: 'incident-move-not-allowed' });
    expect(RoleCommandPolicy.verdictOf(jobOf('orchestrator', delivered), lowFinding()).verdict).toBe('refused');
  });
});

describe('identity comes from the job record, never from the request', () => {
  test.each(['role', 'jobId'])('a command carrying a forged %s is refused relay-identity-mismatch', (field) => {
    const forged = { ...lowFinding(), [field]: field === 'role' ? 'product-owner' : 'J1' } as ControlCommand;
    expect(RoleCommandPolicy.verdictOf(jobOf('builder'), forged)).toEqual({ verdict: 'refused', reason: 'relay-identity-mismatch' });
  });

  test('a command carrying its own admission is refused relay-identity-mismatch', () => {
    const forged = lowFinding({ admission: { filedByJob: 'J1', findingRoute: 'user' } });
    expect(RoleCommandPolicy.verdictOf(jobOf('builder'), forged)).toEqual({ verdict: 'refused', reason: 'relay-identity-mismatch' });
  });

  test('a product owner\'s request dropped into a builder\'s folder is judged as the builder\'s, and refused', () => {
    const productOwnerEdit: ControlCommand = { kind: 'ticket-priority', ticketReference: '7', priority: 'high' };
    expect(RoleCommandPolicy.verdictOf(jobOf('product-owner', { filedTickets: [{ id: '007', status: 'draft' }] }), productOwnerEdit).verdict).toBe('admitted');
    expect(RoleCommandPolicy.verdictOf(jobOf('builder', { id: 'J13' }), productOwnerEdit)).toEqual({ verdict: 'refused', reason: 'command-not-allowed-for-role' });
  });
});
