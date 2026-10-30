/**
 * V12 to V14 on a scratch repository: what a reviewer filed must be this job's own low draft finding, read from its filing record
 * whatever triage did since; no commit or worktree file may touch agent configuration, before a launch or after a job; and no ref but
 * the job's own branch may move outside a recorded landing. Each planted case refuses with its reason, its clean twin passes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
} from 'bun:test';
import type { LogRecord }     from '../../lib/tracker-model/@types/LogRecord.ts';
import { TicketBodyHashUtil } from '../../lib/tracker-model/utils/TicketBodyHashUtil.ts';
import {
  addWorktree,
  commitFile,
  createScratchGitRepository,
  currentBranchOf,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent } from '../../testing/ToolGuard.ts';
import {
  agentConfigTouchedBeforeLaunch,
  launchSnapshotOf,
  refMovesAllowedOf,
  VERIFICATION_CHECKS,
  type JobVerificationSubject,
  type LaunchSnapshot,
  type VerificationCheck
} from './JobVerification.ts';

const TICKET_BODY = '## Acceptance\nA1. The example holds.\n';
const AT = '2026-10-28T10:00:00+01:00';
const JOB_ID = 'J7';

let repositoryDirectory = '';
let startCommit = '';
let launchSnapshot: LaunchSnapshot = { refs: {}, hooksFolderDigest: null };

function headCommit(): string {
  return gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD']);
}

function filedFinding(naming: { filedTicketId?: string; relayRequestId?: string }): Record<string, unknown> {
  return {
    class:          'out-of-scope',
    severity:       'quality',
    file:           'example.ts',
    summary:        'Example finding',
    evidence:       'reading',
    outcome:        'filed',
    filedTicketId:  naming.filedTicketId ?? null,
    relayRequestId: naming.relayRequestId ?? null,
  };
}

function reviewerSubject(findings: readonly Record<string, unknown>[], logRecords: readonly LogRecord[] = []): JobVerificationSubject {
  return {
    role:         'reviewer',
    worktreePath: repositoryDirectory,
    startCommit,
    report:       {
      role: 'reviewer', headCommit: headCommit(), claims: [], findings, reviewText: 'Example review.'
    },
    ticketBody:       TICKET_BODY,
    bodyHashAtLaunch: TicketBodyHashUtil.bodyHashOf(TICKET_BODY),
    jobId:            JOB_ID,
    logRecords,
    launchSnapshot,
    refMovesAllowed:  {
      ownBranch:            currentBranchOf(repositoryDirectory),
      otherJobBranches:     [],
      loggedJobBranches:    [],
      recordedLandings:     [],
      removedAfterLandings: [],
      refreshWorktreeHeads: [],
    },
  };
}

function jobLaunchedRecord(jobId: string, launch: { kind: 'build' | 'merge' | 'refresh'; ticketIds: string[]; target: string }): LogRecord {
  return {
    at:     AT,
    kind:   'job-launched',
    jobId,
    fields: {
      ...launch, role: null, attempt: 1, parentJobId: null
    }
  };
}

function jobEndedRecord(jobId: string, outcome: 'landed' | 'refreshed', commit: string): LogRecord {
  return {
    at: AT, kind: 'job-ended', jobId, fields: { outcome, commit, deniedPermissions: [] }
  };
}

const OWN_BUILD_JOB_ID = 'J9';

/** A live build job whose exemptions are read from the Overseer's records: ticket 378 releases `group-example`. */
function buildJobAcross(logRecords: readonly LogRecord[], refreshWorktree = ''): JobVerificationSubject {
  return {
    ...reviewerSubject([]),
    role:            'builder',
    refMovesAllowed: refMovesAllowedOf(logRecords, {
      ownJobId:              OWN_BUILD_JOB_ID,
      ownBranch:             currentBranchOf(repositoryDirectory),
      otherJobBranches:      [],
      ticketBranchOf:        (ticketId) => `ticket-${ticketId}`,
      releasedGroupBranchOf: (ticketId) => (ticketId === '378' ? 'group-example' : null),
      refreshWorktreeOf:     (groupBranch) => (groupBranch === 'group-example' ? refreshWorktree : ''),
    }),
  };
}

function filingRecord(ticketId: string, fields: Partial<{ status: string; priority: string; filedByJob: string; findingRoute: string }> = {}): LogRecord {
  return {
    at:     AT,
    kind:   'ticket-filed',
    ticketId,
    fields: {
      title: 'Example finding', status: 'draft', priority: 'low', filedByJob: JOB_ID, findingRoute: 'orchestrator', ...fields
    },
  };
}

function relayAppliedRecord(requestId: string): LogRecord {
  return {
    at: AT, kind: 'relay-applied', jobId: JOB_ID, fields: { requestId, commandKind: 'ticket-add', outcome: 'applied' }
  };
}

function refusal(check: VerificationCheck, subject: JobVerificationSubject): { reason: string; facts: readonly string[] } | null {
  const verdict = VERIFICATION_CHECKS[check](subject);
  return verdict.verdict === 'refused' ? { reason: verdict.reason, facts: verdict.facts } : null;
}

beforeEach(() => {
  repositoryDirectory = createScratchGitRepository('job-provenance');
  startCommit = commitFile(repositoryDirectory, 'base.ts', 'export const base = true;\n');
  launchSnapshot = launchSnapshotOf(repositoryDirectory) ?? launchSnapshot;
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('V12: every filed finding is this job\'s own low draft', () => {
  test('a finding naming its ticket, filed on the orchestrator route, passes', () => {
    expect(refusal('V12', reviewerSubject([filedFinding({ filedTicketId: '012' })], [filingRecord('012')]))).toBeNull();
  });

  test('a finding naming its request id resolves through the relay-applied record that carries it, on the user route', () => {
    const records = [filingRecord('013', { findingRoute: 'user' }), relayAppliedRecord('R1')];
    expect(refusal('V12', reviewerSubject([filedFinding({ relayRequestId: 'R1' })], records))).toBeNull();
  });

  test('the filing record is read, never the ticket now: a ticket readied or triaged since still passes', () => {
    const triagedSince: LogRecord = {
      at: AT, kind: 'ticket-triaged', ticketId: '012', fields: {}
    };
    expect(refusal('V12', reviewerSubject([filedFinding({ filedTicketId: '#12' })], [filingRecord('012'), triagedSince]))).toBeNull();
  });

  test('another job\'s ticket, a ticket filed above low, one filed ready, one with no route and an unresolvable request each refuse', () => {
    const cases: [Record<string, unknown>, LogRecord[]][] = [
      [filedFinding({ filedTicketId: '012' }), [filingRecord('012', { filedByJob: 'J3' })]],
      [filedFinding({ filedTicketId: '012' }), [filingRecord('012', { priority: 'normal' })]],
      [filedFinding({ filedTicketId: '012' }), [filingRecord('012', { status: 'pending' })]],
      [filedFinding({ filedTicketId: '012' }), [filingRecord('012', { findingRoute: '' })]],
      [filedFinding({ relayRequestId: 'R9' }), [filingRecord('012'), relayAppliedRecord('R1')]],
    ];
    for (const [finding, records] of cases) {
      expect(refusal('V12', reviewerSubject([finding], records))?.reason).toBe('finding-not-filed-by-job');
    }
  });
});

describeWhenGitIsPresent('V13: no change to agent configuration', () => {
  test('a commit under .claude/ refuses, even when a later commit undoes it', () => {
    mkdirSync(join(repositoryDirectory, '.claude'), { recursive: true });
    commitFile(repositoryDirectory, '.claude/settings.json', '{"hooks":{}}\n');
    gitOutputIn(repositoryDirectory, ['rm', '-q', '.claude/settings.json']);
    gitOutputIn(repositoryDirectory, ['-c', 'user.name=Alex Example', '-c', 'user.email=alex@example.com', 'commit', '-q', '-m', 'Undo']);
    expect(refusal('V13', reviewerSubject([]))).toEqual({ reason: 'branch-touches-agent-config', facts: ['.claude/settings.json'] });
  });

  test('an untracked .mcp.json in the worktree refuses', () => {
    writeFileSync(join(repositoryDirectory, '.mcp.json'), '{}\n');
    expect(refusal('V13', reviewerSubject([]))?.facts).toEqual(['.mcp.json']);
  });

  test('the hooks folder is core.hooksPath read from git: a change under it refuses, the same file elsewhere passes', () => {
    gitOutputIn(repositoryDirectory, ['config', 'core.hooksPath', 'example-hooks']);
    mkdirSync(join(repositoryDirectory, 'other-hooks'));
    mkdirSync(join(repositoryDirectory, 'example-hooks'));
    launchSnapshot = launchSnapshotOf(repositoryDirectory) ?? launchSnapshot;
    commitFile(repositoryDirectory, 'other-hooks/pre-commit', 'exit 0\n');
    expect(refusal('V13', reviewerSubject([]))).toBeNull();
    commitFile(repositoryDirectory, 'example-hooks/pre-commit', 'exit 0\n');
    expect(refusal('V13', reviewerSubject([]))?.facts).toEqual(['example-hooks/pre-commit']);
  });

  test('without core.hooksPath, a hook written into .git/hooks after launch refuses by the launch digest', () => {
    const hooksFolder = join(gitOutputIn(repositoryDirectory, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'hooks');
    mkdirSync(hooksFolder, { recursive: true });
    launchSnapshot = launchSnapshotOf(repositoryDirectory) ?? launchSnapshot;
    expect(refusal('V13', reviewerSubject([]))).toBeNull();
    writeFileSync(join(hooksFolder, 'post-checkout'), 'exit 0\n');
    expect(refusal('V13', reviewerSubject([]))?.reason).toBe('branch-touches-agent-config');
  });

  test('before a launch, the branch\'s own commits past its target are read: a target holding .claude/ passes, the branch adding it refuses', () => {
    const target = currentBranchOf(repositoryDirectory);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'ticket-007']);
    expect(agentConfigTouchedBeforeLaunch(repositoryDirectory, target).verdict).toBe('passed');
    mkdirSync(join(repositoryDirectory, '.claude'), { recursive: true });
    commitFile(repositoryDirectory, '.claude/settings.json', '{}\n');
    expect(agentConfigTouchedBeforeLaunch(repositoryDirectory, target)).toEqual({ verdict: 'refused', reason: 'branch-touches-agent-config', facts: ['.claude/settings.json'] });
  });
});

describeWhenGitIsPresent('V14: no foreign ref moved', () => {
  test('the job\'s own branch moving passes; another branch moving or appearing refuses', () => {
    commitFile(repositoryDirectory, 'feature.ts', 'export const feature = true;\n');
    expect(refusal('V14', reviewerSubject([]))).toBeNull();
    gitOutputIn(repositoryDirectory, ['branch', 'example-foreign', startCommit]);
    expect(refusal('V14', reviewerSubject([]))).toEqual({ reason: 'foreign-ref-moved', facts: ['refs/heads/example-foreign'] });
  });

  test('a landing the runner recorded at the commit the ref now names passes, and another job\'s branch passes', () => {
    gitOutputIn(repositoryDirectory, ['branch', 'example-target', startCommit]);
    gitOutputIn(repositoryDirectory, ['branch', 'ticket-009', startCommit]);
    const subject = reviewerSubject([]);
    expect(refusal('V14', {
      ...subject,
      refMovesAllowed: {
        ownBranch:            currentBranchOf(repositoryDirectory),
        otherJobBranches:     ['ticket-009'],
        loggedJobBranches:    [],
        recordedLandings:     [{ ref: 'refs/heads/example-target', commit: startCommit }],
        removedAfterLandings: [],
        refreshWorktreeHeads: [],
      },
    })).toBeNull();
  });

  test('another worktree\'s detached HEAD moving refuses, and a job with no launch snapshot refuses', () => {
    const otherWorktree = addWorktree(repositoryDirectory, 'example-detached');
    gitOutputIn(otherWorktree, ['checkout', '-q', '--detach', startCommit]);
    launchSnapshot = launchSnapshotOf(repositoryDirectory) ?? launchSnapshot;
    commitFile(otherWorktree, 'moved.ts', 'export const moved = true;\n');
    expect(refusal('V14', reviewerSubject([]))?.facts.some((fact) => fact.startsWith('HEAD:'))).toBe(true);
    const { launchSnapshot: _dropped, ...withoutSnapshot } = reviewerSubject([]);
    expect(refusal('V14', withoutSnapshot)?.reason).toBe('foreign-ref-moved');
  });

  test('a group release landing on the main line while a build job is live, its cleanup deleting the group and ticket branches, passes', () => {
    const mainLine = gitOutputIn(repositoryDirectory, ['rev-parse', '--abbrev-ref', 'HEAD']);
    gitOutputIn(repositoryDirectory, ['branch', 'group-example', startCommit]);
    gitOutputIn(repositoryDirectory, ['branch', 'ticket-378', startCommit]);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'ticket-020']);
    launchSnapshot = launchSnapshotOf(repositoryDirectory) ?? launchSnapshot;
    commitFile(repositoryDirectory, 'built.ts', 'export const built = true;\n');
    const landedCommit = commitFile(repositoryDirectory, 'released.ts', 'export const released = true;\n');
    gitOutputIn(repositoryDirectory, ['branch', '-f', mainLine, landedCommit]);
    gitOutputIn(repositoryDirectory, ['branch', '-D', 'group-example', 'ticket-378']);
    const release = [jobLaunchedRecord('M1', { kind: 'merge', ticketIds: ['378'], target: mainLine }), jobEndedRecord('M1', 'landed', landedCommit)];
    expect(refusal('V14', buildJobAcross(release))).toBeNull();
    expect(refusal('V14', buildJobAcross([]))?.facts).toEqual(['refs/heads/group-example', `refs/heads/${mainLine}`, 'refs/heads/ticket-378']);
  });

  test('a refresh worktree added, merged into and removed while a build job is live passes at every step', () => {
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'ticket-020']);
    const refreshRecords = [jobLaunchedRecord('R1', { kind: 'refresh', ticketIds: [], target: 'group-example' })];
    const refreshWorktree = addWorktree(repositoryDirectory, 'refresh-group-example');
    gitOutputIn(refreshWorktree, ['checkout', '-q', '--detach', startCommit]);
    gitOutputIn(repositoryDirectory, ['branch', '-D', 'worktree/refresh-group-example']);
    const refreshHead = Object.keys(launchSnapshotOf(repositoryDirectory)?.refs ?? {}).find((ref) => ref.startsWith('HEAD:')) ?? '';
    const listedRefreshWorktree = refreshHead.slice('HEAD:'.length);
    expect(refusal('V14', buildJobAcross(refreshRecords, listedRefreshWorktree))).toBeNull();
    commitFile(refreshWorktree, 'refreshed.ts', 'export const refreshed = true;\n');
    expect(refusal('V14', buildJobAcross(refreshRecords, listedRefreshWorktree))).toBeNull();
    expect(refusal('V14', buildJobAcross([], listedRefreshWorktree))?.facts).toEqual([refreshHead]);
    gitOutputIn(repositoryDirectory, ['worktree', 'remove', '--force', refreshWorktree]);
    expect(refusal('V14', buildJobAcross(refreshRecords, listedRefreshWorktree))).toBeNull();
  });

  test('a ticket landing on the main line mid-build passes, its build ending after this one launched; one ended before, or deleting it, still refuses', () => {
    const mainLine = gitOutputIn(repositoryDirectory, ['rev-parse', '--abbrev-ref', 'HEAD']);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'ticket-020']);
    launchSnapshot = launchSnapshotOf(repositoryDirectory) ?? launchSnapshot;
    gitOutputIn(repositoryDirectory, ['branch', 'ticket-019', startCommit]);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', 'ticket-019']);
    const landedCommit = commitFile(repositoryDirectory, 'reviewed.ts', 'export const reviewed = true;\n');
    gitOutputIn(repositoryDirectory, ['branch', '-f', mainLine, landedCommit]);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', 'ticket-020']);
    const buildLaunched = jobLaunchedRecord('J2', { kind: 'build', ticketIds: ['019'], target: mainLine });
    const ownLaunched   = jobLaunchedRecord(OWN_BUILD_JOB_ID, { kind: 'build', ticketIds: ['020'], target: mainLine });
    const buildEnded: LogRecord = {
      at: AT, kind: 'job-ended', jobId: 'J2', fields: { outcome: 'built', deniedPermissions: [] }
    };
    const landing = [
      buildLaunched,
      ownLaunched,
      buildEnded,
      jobLaunchedRecord('M1', { kind: 'merge', ticketIds: ['019'], target: mainLine }),
      jobEndedRecord('M1', 'landed', landedCommit),
    ];
    expect(refusal('V14', buildJobAcross(landing))).toBeNull();
    expect(refusal('V14', buildJobAcross([]))?.facts).toEqual([`refs/heads/${mainLine}`, 'refs/heads/ticket-019']);
    const endedBeforeOwnLaunch = [buildLaunched, buildEnded, ownLaunched];
    expect(refusal('V14', buildJobAcross(endedBeforeOwnLaunch))?.facts).toContain('refs/heads/ticket-019');
    gitOutputIn(repositoryDirectory, ['branch', '-D', 'ticket-019']);
    gitOutputIn(repositoryDirectory, ['branch', 'ticket-019', startCommit]);
    launchSnapshot = launchSnapshotOf(repositoryDirectory) ?? launchSnapshot;
    gitOutputIn(repositoryDirectory, ['branch', '-D', 'ticket-019']);
    expect(refusal('V14', buildJobAcross(landing.slice(0, 1)))).toEqual({ reason: 'foreign-ref-moved', facts: ['refs/heads/ticket-019'] });
  });

  /** The cutover smoke's sequence: #002 builds while #001 is built, reviewed and landed on their shared target, its branch kept at the landing. */
  function landAnotherTicketOnTheOwnTarget(): { mainLine: string; landing: LogRecord[] } {
    const mainLine = gitOutputIn(repositoryDirectory, ['rev-parse', '--abbrev-ref', 'HEAD']);
    gitOutputIn(repositoryDirectory, ['branch', 'ticket-001', startCommit]);
    gitOutputIn(repositoryDirectory, ['branch', 'example-protected', startCommit]);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'ticket-002']);
    launchSnapshot = launchSnapshotOf(repositoryDirectory) ?? launchSnapshot;
    gitOutputIn(repositoryDirectory, ['checkout', '-q', 'ticket-001']);
    const landedCommit = commitFile(repositoryDirectory, 'palette.txt', 'colour: Example\n');
    gitOutputIn(repositoryDirectory, ['branch', '-f', mainLine, landedCommit]);
    gitOutputIn(repositoryDirectory, ['checkout', '-q', 'ticket-002']);
    commitFile(repositoryDirectory, 'shade.txt', 'shade: Example\n');
    const builtEnded: LogRecord = {
      at: AT, kind: 'job-ended', jobId: 'J2', fields: { outcome: 'built', commit: landedCommit, deniedPermissions: [] }
    };
    const landing = [
      jobLaunchedRecord('J2', { kind: 'build', ticketIds: ['001'], target: mainLine }),
      jobLaunchedRecord(OWN_BUILD_JOB_ID, { kind: 'build', ticketIds: ['002'], target: mainLine }),
      builtEnded,
      jobLaunchedRecord('J5', { kind: 'merge', ticketIds: ['001'], target: mainLine }),
      jobEndedRecord('J5', 'landed', landedCommit),
    ];
    return { mainLine, landing };
  }

  test('a job whose own target another ticket\'s landing moved, that ticket\'s branch kept at the landing, passes as builder and as reviewer', () => {
    const { mainLine, landing } = landAnotherTicketOnTheOwnTarget();
    expect(refusal('V14', buildJobAcross(landing))).toBeNull();
    expect(refusal('V14', { ...buildJobAcross(landing), role: 'reviewer' })).toBeNull();
    expect(refusal('V14', buildJobAcross([]))?.facts).toEqual([`refs/heads/${mainLine}`, 'refs/heads/ticket-001']);
  });

  test('beside that landing, another protected ref moving, or the own target moving past the landed commit, still refuses', () => {
    const { mainLine, landing } = landAnotherTicketOnTheOwnTarget();
    const ownTip = headCommit();
    gitOutputIn(repositoryDirectory, ['branch', '-f', 'example-protected', ownTip]);
    expect(refusal('V14', buildJobAcross(landing))).toEqual({ reason: 'foreign-ref-moved', facts: ['refs/heads/example-protected'] });
    gitOutputIn(repositoryDirectory, ['branch', '-f', 'example-protected', startCommit]);
    gitOutputIn(repositoryDirectory, ['branch', '-f', mainLine, ownTip]);
    expect(refusal('V14', buildJobAcross(landing))).toEqual({ reason: 'foreign-ref-moved', facts: [`refs/heads/${mainLine}`] });
  });

  test('a job deleting another ticket\'s branch still refuses, even beside a recorded group release', () => {
    gitOutputIn(repositoryDirectory, ['branch', 'ticket-021', startCommit]);
    gitOutputIn(repositoryDirectory, ['branch', 'group-example', startCommit]);
    launchSnapshot = launchSnapshotOf(repositoryDirectory) ?? launchSnapshot;
    gitOutputIn(repositoryDirectory, ['branch', '-D', 'ticket-021', 'group-example']);
    const release = [jobLaunchedRecord('M1', { kind: 'merge', ticketIds: ['378'], target: 'example-main' }), jobEndedRecord('M1', 'landed', startCommit)];
    expect(refusal('V14', buildJobAcross(release))).toEqual({ reason: 'foreign-ref-moved', facts: ['refs/heads/ticket-021'] });
  });
});
