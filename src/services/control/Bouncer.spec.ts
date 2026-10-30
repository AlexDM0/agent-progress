/**
 * The role table of design section 4.4, case by case: what a worker may file and how its filing is stamped, the worker limit, the product
 * owner's own-draft rule, the Assistant's incident moves, and the planted forgeries (a `role`, a `jobId` or an admission in the command).
 * Identity is the job record's, so a request in another job's folder is judged as that folder's job, which the last case plants.
 */
import { describe, expect, test } from 'bun:test';

import type { IncidentKind, IncidentMove }       from '../../lib/tracker-model/@types/Incident.ts';
import type { JobRole }                          from '../../lib/tracker-model/@types/Job.ts';
import { INCIDENT_KINDS }                        from '../../lib/tracker-model/constants/DecisionAndIncidentVocabulary.ts';
import type { ControlCommand, ControlCommandOf } from '../../shared/@types/ControlCommand.ts';
import { WORKER_FILINGS_PER_JOB }                from '../../shared/constants/OverseerLimits.ts';
import { Bouncer, type RelayingJob }             from './Bouncer.ts';
import { ALLOWED_MOVES_BY_INCIDENT_KIND }        from './constants/AllowedMovesByIncidentKind.ts';

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
  test.each(['builder', 'reviewer', 'merge-fix'] as const)('%s files a low finding stamped with its job and the Assistant route', (role) => {
    expect(Bouncer.verdictOf(jobOf(role), lowFinding())).toEqual({
      verdict: 'admitted',
      command: { ...lowFinding(), admission: { filedByJob: 'J12', findingRoute: 'assistant' } },
    });
  });

  test('--needs-user routes the finding to User', () => {
    const verdict = Bouncer.verdictOf(jobOf('builder'), lowFinding({ needsUser: true }));
    expect(verdict).toEqual({ verdict: 'admitted', command: { ...lowFinding({ needsUser: true }), admission: { filedByJob: 'J12', findingRoute: 'user' } } });
  });

  test('size, type, body and both ticket links are a finding\'s flags', () => {
    const command = lowFinding({
      size: 'S', type: 'research', bodyText: '## Report\nFound.\n', introducedBy: '002'
    });
    expect(Bouncer.verdictOf(jobOf('reviewer'), command).verdict).toBe('admitted');
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
  ] as const)('a filing with %s is refused worker-filing-flag', (caseName, overrides) => {
    // Every case but the priority ones keeps `--priority low`, so the flag alone is what refuses it.
    const { priority: _lowPriority, ...withoutPriority } = lowFinding();
    const base    = caseName === 'no priority' ? withoutPriority : lowFinding();
    const command = { ...base, ...overrides } as ControlCommand;
    expect(Bouncer.verdictOf(jobOf('builder'), command)).toEqual({ verdict: 'refused', reason: 'worker-filing-flag' });
  });

  test('the filing past WORKER_FILINGS_PER_JOB is refused worker-filing-limit, the one before it admitted', () => {
    const filedTickets = Array.from({ length: WORKER_FILINGS_PER_JOB }, (_unused, index) => ({ id: String(index + 1).padStart(3, '0'), status: 'draft' as const }));
    expect(Bouncer.verdictOf(jobOf('builder', { filedTickets: filedTickets.slice(1) }), lowFinding()).verdict).toBe('admitted');
    expect(Bouncer.verdictOf(jobOf('builder', { filedTickets }), lowFinding())).toEqual({ verdict: 'refused', reason: 'worker-filing-limit' });
  });

  test('every other command is refused for a worker', () => {
    expect(Bouncer.verdictOf(jobOf('builder'), EDIT_OF_TICKET_7)).toEqual({ verdict: 'refused', reason: 'command-not-allowed-for-role' });
    expect(Bouncer.verdictOf(jobOf('reviewer'), { kind: 'ticket-ready', ticketReferences: ['7'] }).verdict).toBe('refused');
  });
});

describe('resolver and resolution-review', () => {
  test.each(['resolver', 'resolution-review'] as const)('%s may Hatch nothing, not even a low finding', (role) => {
    expect(Bouncer.verdictOf(jobOf(role), lowFinding())).toEqual({ verdict: 'refused', reason: 'command-not-allowed-for-role' });
  });

  test('a job with no role relays nothing', () => {
    expect(Bouncer.verdictOf(jobOf(null), lowFinding()).verdict).toBe('refused');
  });
});

describe('product-owner', () => {
  test('files at any priority, with --network, stamped with its job and no finding route', () => {
    const command = lowFinding({ priority: 'high', network: ['api.example.com'] });
    expect(Bouncer.verdictOf(jobOf('product-owner'), command)).toEqual({ verdict: 'admitted', command: { ...command, admission: { filedByJob: 'J12' } } });
  });

  test('--needs-user is a worker\'s flag, refused worker-filing-flag', () => {
    expect(Bouncer.verdictOf(jobOf('product-owner'), lowFinding({ needsUser: true }))).toEqual({ verdict: 'refused', reason: 'worker-filing-flag' });
  });

  test('edits its own draft, and not a draft another job filed or its own once readied', () => {
    expect(Bouncer.verdictOf(jobOf('product-owner', { filedTickets: [{ id: '007', status: 'draft' }] }), EDIT_OF_TICKET_7).verdict).toBe('admitted');
    expect(Bouncer.verdictOf(jobOf('product-owner', { filedTickets: [{ id: '008', status: 'draft' }] }), EDIT_OF_TICKET_7))
      .toEqual({ verdict: 'refused', reason: 'not-own-draft' });
    expect(Bouncer.verdictOf(jobOf('product-owner', { filedTickets: [{ id: '007', status: 'pending' }] }), EDIT_OF_TICKET_7))
      .toEqual({ verdict: 'refused', reason: 'not-own-draft' });
  });

  test('ticket-depends, epic-add and the draft kinds run on anything; ticket-ready never', () => {
    const job = jobOf('product-owner');
    expect(Bouncer.verdictOf(job, {
      kind: 'ticket-depends', ticketReference: '9', edit: 'add', ticketIds: ['010']
    }).verdict).toBe('admitted');
    expect(Bouncer.verdictOf(job, {
      kind: 'epic-add', key: 'checkout', title: 'Checkout', bodyText: ''
    }).verdict).toBe('admitted');
    expect(Bouncer.verdictOf(job, {
      kind: 'draft-note', draftId: 'D1', text: 'Assumed EUR.', noteKind: 'assumption'
    }).verdict).toBe('admitted');
    expect(Bouncer.verdictOf(job, { kind: 'ticket-ready', ticketReferences: ['7'] })).toEqual({ verdict: 'refused', reason: 'command-not-allowed-for-role' });
    expect(Bouncer.verdictOf(job, { kind: 'concurrency-set', limit: 3 }).verdict).toBe('refused');
  });
});

/** Design section 8.3's table, written out again so a drift on either side fails. */
const DESIGN_TABLE: Readonly<Record<IncidentKind, readonly IncidentMove[]>> = {
  'system-question':           ['incident-answer', 'incident-escalate', 'job-fresh', 'ticket-park', 'incident-note'],
  'malformed-ticket':          ['incident-answer', 'incident-escalate', 'ticket-park', 'incident-note'],
  'setup-failed':              ['worktree-repair', 'ticket-park', 'incident-note'],
  'out-of-calls':              ['job-fresh', 'ticket-park', 'incident-note'],
  'blocked':                   ['job-fresh', 'worktree-repair', 'ticket-park', 'incident-note'],
  'job-lost':                  ['job-fresh', 'ticket-park', 'incident-note'],
  'resume-failed':             ['job-fresh', 'ticket-park'],
  'gate-cannot-run':           ['gate-retry', 'worktree-repair', 'ticket-park'],
  'merge-gate-failed':         ['merge-fixer', 'merge-abort', 'ticket-park'],
  'resolution-over-threshold': ['merge-review', 'merge-land', 'merge-abort'],
  'quiet-job':                 ['job-message', 'job-fresh', 'incident-note'],
  'findings-delivered':        ['ticket-ready', 'ticket-triage', 'incident-note'],
};

/** A command of each move kind the contract has so far; the repair and merge moves arrive with their commands. */
const COMMAND_OF_MOVE: Partial<Record<IncidentMove, ControlCommand>> = {
  'incident-answer':   { kind: 'incident-answer', incidentId: 'I9', text: 'Use the example setup script' },
  'incident-escalate': { kind: 'incident-escalate', incidentId: 'I9' },
  'incident-note':     { kind: 'incident-note', incidentId: 'I9', text: 'Seen twice' },
  'job-fresh':         { kind: 'job-fresh', jobId: 'J2', incidentId: 'I9' },
  'job-message':       {
    kind: 'job-message', jobId: 'J2', text: 'Commit what you have.', incidentId: 'I9'
  },
  'ticket-park': {
    kind: 'ticket-park', ticketReference: '11', reason: 'Needs Alex Example', incidentId: 'I9'
  },
  'ticket-ready':  { kind: 'ticket-ready', ticketReferences: ['11'], incidentId: 'I9' },
  'ticket-triage': { kind: 'ticket-triage', ticketReferences: ['11'], incidentId: 'I9' },
};

describe('ALLOWED_MOVES_BY_INCIDENT_KIND, the Bouncer\'s table', () => {
  test('is design section 8.3\'s table for all twelve kinds, both ways', () => {
    expect(ALLOWED_MOVES_BY_INCIDENT_KIND).toEqual(DESIGN_TABLE);
    expect(Object.keys(ALLOWED_MOVES_BY_INCIDENT_KIND).sort()).toEqual([...INCIDENT_KINDS].sort());
  });

  test('never lets a failed merge gate land, and lets merge land only a resolution over the threshold', () => {
    const kindsAllowingLand = INCIDENT_KINDS.filter((kind) => ALLOWED_MOVES_BY_INCIDENT_KIND[kind].includes('merge-land'));
    expect(kindsAllowingLand).toEqual(['resolution-over-threshold']);
  });

  test.each([...INCIDENT_KINDS])('a %s incident admits exactly the moves its row lists', (kind) => {
    for (const [move, command] of Object.entries(COMMAND_OF_MOVE)) {
      const incident = {
        id: 'I9', kind, ticketIds: ['011'], jobId: 'J2'
      };
      const verdict  = Bouncer.verdictOf(jobOf('assistant', { deliveredIncidents: [incident] }), command);
      expect(verdict.verdict, `${kind} ${move}`).toBe(DESIGN_TABLE[kind].includes(move as IncidentMove) ? 'admitted' : 'refused');
    }
  });

  test('job fresh under a question with no job waiting, as an Airlock report opens it, is refused', () => {
    const incident = {
      id: 'I9', kind: 'system-question' as const, ticketIds: ['011'], jobId: null
    };
    expect(Bouncer.verdictOf(jobOf('assistant', { deliveredIncidents: [incident] }), COMMAND_OF_MOVE['job-fresh'] ?? lowFinding()))
      .toEqual({ verdict: 'refused', reason: 'incident-move-not-allowed' });
  });
});

describe('assistant', () => {
  const FINDINGS_DELIVERED = {
    id: 'I4', kind: 'findings-delivered' as const, ticketIds: ['011', '012'], jobId: null
  };

  test('readies a finding the named findings-delivered incident lists', () => {
    const command: ControlCommand = { kind: 'ticket-ready', ticketReferences: ['#11'], incidentId: 'I4' };
    expect(Bouncer.verdictOf(jobOf('assistant', { deliveredIncidents: [FINDINGS_DELIVERED] }), command)).toEqual({ verdict: 'admitted', command });
  });

  test('a ticket the incident does not list is refused finding-not-listed', () => {
    const command: ControlCommand = { kind: 'ticket-ready', ticketReferences: ['11', '13'], incidentId: 'I4' };
    expect(Bouncer.verdictOf(jobOf('assistant', { deliveredIncidents: [FINDINGS_DELIVERED] }), command))
      .toEqual({ verdict: 'refused', reason: 'finding-not-listed' });
  });

  test('a move naming no delivered incident, or one its kind does not allow, is refused incident-move-not-allowed', () => {
    const delivered = {
      deliveredIncidents: [FINDINGS_DELIVERED, {
        id: 'I5', kind: 'blocked' as const, ticketIds: ['011'], jobId: null
      }]
    };
    expect(Bouncer.verdictOf(jobOf('assistant', delivered), { kind: 'ticket-ready', ticketReferences: ['11'] }))
      .toEqual({ verdict: 'refused', reason: 'incident-move-not-allowed' });
    expect(Bouncer.verdictOf(jobOf('assistant', delivered), { kind: 'ticket-ready', ticketReferences: ['11'], incidentId: 'I5' }))
      .toEqual({ verdict: 'refused', reason: 'incident-move-not-allowed' });
    expect(Bouncer.verdictOf(jobOf('assistant', delivered), lowFinding()).verdict).toBe('refused');
  });
});

describe('an incident move\'s target is the incident\'s own', () => {
  const OWN_INCIDENT = {
    id: 'I9', kind: 'quiet-job' as const, ticketIds: ['011'], jobId: 'J2'
  };
  const FAILED_RESUME = { ...OWN_INCIDENT, kind: 'resume-failed' as const };

  function verdictUnder(incident: RelayingJob['deliveredIncidents'][number], command: ControlCommand) {
    return Bouncer.verdictOf(jobOf('assistant', { deliveredIncidents: [incident] }), command);
  }

  test.each([
    ['job fresh', OWN_INCIDENT, { kind: 'job-fresh', incidentId: 'I9' }, { jobId: 'J2' }, { jobId: 'J3' }],
    ['job message', OWN_INCIDENT, { kind: 'job-message', text: 'Commit what you have.', incidentId: 'I9' }, { jobId: 'J2' }, { jobId: 'J3' }],
    ['ticket park', FAILED_RESUME, { kind: 'ticket-park', reason: 'Needs Alex Example', incidentId: 'I9' }, { ticketReference: '#11' }, { ticketReference: '12' }],
  ] as const)('%s naming the incident\'s own is admitted, naming another is refused incident-target-mismatch', (_move, incident, command, own, another) => {
    const ownCommand = { ...command, ...own } as ControlCommand;
    expect(verdictUnder(incident, ownCommand)).toEqual({ verdict: 'admitted', command: ownCommand });
    expect(verdictUnder(incident, { ...command, ...another } as ControlCommand)).toEqual({ verdict: 'refused', reason: 'incident-target-mismatch' });
  });

  test('a job message under an incident with no job, and a park under one with no tickets, are refused incident-target-mismatch', () => {
    expect(verdictUnder({ ...OWN_INCIDENT, jobId: null }, COMMAND_OF_MOVE['job-message'] ?? lowFinding()))
      .toEqual({ verdict: 'refused', reason: 'incident-target-mismatch' });
    expect(verdictUnder({ ...FAILED_RESUME, ticketIds: [] }, COMMAND_OF_MOVE['ticket-park'] ?? lowFinding()))
      .toEqual({ verdict: 'refused', reason: 'incident-target-mismatch' });
  });

  test('a park whose reference is no ticket id is refused incident-target-mismatch', () => {
    const command: ControlCommand = {
      kind: 'ticket-park', ticketReference: 'eleven', reason: 'Needs Alex Example', incidentId: 'I9'
    };
    expect(verdictUnder(FAILED_RESUME, command)).toEqual({ verdict: 'refused', reason: 'incident-target-mismatch' });
  });

  test('the kind guard goes first: a move the kind does not allow stays incident-move-not-allowed on any target', () => {
    const elsewhere: ControlCommand = {
      kind: 'ticket-park', ticketReference: '12', reason: 'Needs Alex Example', incidentId: 'I9'
    };
    expect(verdictUnder(OWN_INCIDENT, elsewhere)).toEqual({ verdict: 'refused', reason: 'incident-move-not-allowed' });
  });
});

describe('identity comes from the job record, never from the request', () => {
  test.each(['role', 'jobId'])('a command carrying a forged %s is refused hatch-identity-mismatch', (field) => {
    const forged = { ...lowFinding(), [field]: field === 'role' ? 'product-owner' : 'J1' } as ControlCommand;
    expect(Bouncer.verdictOf(jobOf('builder'), forged)).toEqual({ verdict: 'refused', reason: 'hatch-identity-mismatch' });
  });

  test('a command carrying its own admission is refused hatch-identity-mismatch', () => {
    const forged = lowFinding({ admission: { filedByJob: 'J1', findingRoute: 'user' } });
    expect(Bouncer.verdictOf(jobOf('builder'), forged)).toEqual({ verdict: 'refused', reason: 'hatch-identity-mismatch' });
  });

  test('a product owner\'s request dropped into a builder\'s folder is judged as the builder\'s, and refused', () => {
    const productOwnerEdit: ControlCommand = { kind: 'ticket-priority', ticketReference: '7', priority: 'high' };
    expect(Bouncer.verdictOf(jobOf('product-owner', { filedTickets: [{ id: '007', status: 'draft' }] }), productOwnerEdit).verdict).toBe('admitted');
    expect(Bouncer.verdictOf(jobOf('builder', { id: 'J13' }), productOwnerEdit)).toEqual({ verdict: 'refused', reason: 'command-not-allowed-for-role' });
  });
});
