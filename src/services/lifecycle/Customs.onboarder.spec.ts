/**
 * The onboarder's Customs column on a scratch main-line snapshot: it reads the repository and writes only its Hatch, so a changed or added
 * file in the snapshot, a commit on it and a moved ref each fail the pass; and each optimisation an `advise` names must be a draft low ticket
 * this job filed, read from its filing record as V12 reads a reviewer's filed finding. A clean proposal passes every check of the column.
 */
import { writeFileSync } from 'node:fs';
import { join }          from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
} from 'bun:test';
import { onboarderReportOf } from '../../adapters/reports/testing/OnboarderReportFixture.ts';
import type { LogRecord }    from '../../lib/tracker-model/@types/LogRecord.ts';
import {
  commitFile,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent } from '../../testing/ToolGuard.ts';
import {
  CHECKS_OF_ROLE,
  launchSnapshotOf,
  clearCustoms,
  type CustomsSubject,
  type LaunchSnapshot
} from './Customs.ts';

const AT = '2026-10-28T10:00:00+01:00';
const JOB_ID = 'J7';

let repositoryDirectory = '';
let snapshotDirectory = '';
let startCommit = '';
let launchSnapshot: LaunchSnapshot = { refs: {}, hooksFolderDigest: null };

function onboarderSubject(report: unknown = onboarderReportOf(startCommit), logRecords: readonly LogRecord[] = []): CustomsSubject {
  return {
    role:             'onboarder',
    worktreePath:     snapshotDirectory,
    startCommit,
    report,
    ticketBody:       '',
    bodyHashAtLaunch: '',
    jobId:            JOB_ID,
    logRecords,
    launchSnapshot,
    refMovesAllowed:  {
      ownBranch: '', otherJobBranches: [], loggedJobBranches: [], recordedLandings: [], removedAfterLandings: [], refreshWorktreeHeads: []
    },
  };
}

function lowDraftFiledByThisJob(ticketId: string): LogRecord {
  return {
    at:     AT,
    kind:   'ticket-filed',
    ticketId,
    fields: {
      title: 'Cache the test gate', status: 'draft', priority: 'low', filedByJob: JOB_ID, findingRoute: 'user'
    },
  };
}

function adviceNaming(filedTicketId: string): Record<string, unknown> {
  return onboarderReportOf(startCommit, { mode: 'advise', optimisations: [{ summary: 'Cache the test gate.', filedTicketId, hatchRequestId: null }] });
}

beforeEach(() => {
  repositoryDirectory = createScratchGitRepository('onboarder-verification');
  startCommit         = commitFile(repositoryDirectory, 'package.json', '{ "name": "example" }\n');
  snapshotDirectory   = join(repositoryDirectory, '.onboard-snapshot');
  gitOutputIn(repositoryDirectory, ['worktree', 'add', '--detach', snapshotDirectory, startCommit]);
  launchSnapshot = launchSnapshotOf(snapshotDirectory) ?? launchSnapshot;
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('the onboarder passes Customs only having changed nothing', () => {
  test('a clean proposal on an untouched snapshot is verified', () => {
    expect(clearCustoms(onboarderSubject())).toEqual({ verdict: 'verified' });
  });

  test('a changed tracked file fails V4', () => {
    writeFileSync(join(snapshotDirectory, 'package.json'), '{ "name": "changed" }\n');

    expect(clearCustoms(onboarderSubject())).toMatchObject({ verdict: 'refused', check: 'V4', reason: 'worktree-dirty' });
  });

  test('a file written into the snapshot outside its Hatch fails V4', () => {
    writeFileSync(join(snapshotDirectory, 'pipeline.json'), '{}\n');

    expect(clearCustoms(onboarderSubject())).toMatchObject({ verdict: 'refused', check: 'V4', facts: ['?? pipeline.json'] });
  });

  test('a commit on the snapshot, though it descends from the start, fails V16', () => {
    const moved = commitFile(snapshotDirectory, 'turbo.json', '{}\n');

    expect(clearCustoms(onboarderSubject(onboarderReportOf(moved)))).toEqual({
      verdict: 'refused', check: 'V16', reason: 'head-moved', facts: [startCommit, moved]
    });
  });

  test('a moved branch fails V14', () => {
    gitOutputIn(repositoryDirectory, ['branch', 'onboarder-moved', startCommit]);

    expect(clearCustoms(onboarderSubject())).toMatchObject({
      verdict: 'refused', check: 'V14', reason: 'foreign-ref-moved', facts: ['refs/heads/onboarder-moved']
    });
  });

  test('a report missing a field is a failed pass before any other check', () => {
    const { constitution: _constitution, ...withoutConstitution } = onboarderReportOf(startCommit);

    expect(clearCustoms(onboarderSubject(withoutConstitution))).toMatchObject({ verdict: 'refused', check: 'V1', reason: 'report-invalid' });
  });

  test('its column checks the report first and never asks for a commit, a ticket body or an Acceptance', () => {
    expect(CHECKS_OF_ROLE.onboarder[0]).toBe('V1');
    expect(CHECKS_OF_ROLE.onboarder).not.toContain('V3');
    expect(CHECKS_OF_ROLE.onboarder).not.toContain('V6');
    expect(CHECKS_OF_ROLE.onboarder).not.toContain('V8');
  });
});

describeWhenGitIsPresent('an advice optimisation is a draft low ticket this job filed', () => {
  test('one the job filed as a low draft passes', () => {
    expect(clearCustoms(onboarderSubject(adviceNaming('31'), [lowDraftFiledByThisJob('31')]))).toEqual({ verdict: 'verified' });
  });

  test('one naming a ticket another job filed fails V12', () => {
    const filedByAnother = { ...lowDraftFiledByThisJob('31'), fields: { ...lowDraftFiledByThisJob('31').fields, filedByJob: 'J2' } } as LogRecord;

    expect(clearCustoms(onboarderSubject(adviceNaming('31'), [filedByAnother]))).toEqual({
      verdict: 'refused', check: 'V12', reason: 'finding-not-filed-by-job', facts: ['31']
    });
  });

  test('one filed at normal priority fails V12', () => {
    const normal = { ...lowDraftFiledByThisJob('31'), fields: { ...lowDraftFiledByThisJob('31').fields, priority: 'normal' } } as LogRecord;

    expect(clearCustoms(onboarderSubject(adviceNaming('31'), [normal]))).toMatchObject({ verdict: 'refused', check: 'V12' });
  });
});
