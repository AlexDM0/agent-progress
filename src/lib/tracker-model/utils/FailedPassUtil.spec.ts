/**
 * Failed passes as a log reading. What matters: only `failed` and `does-not-hold` count, and only on the ticket's own jobs; a start from
 * review is rework and keeps the count, while a start from anywhere else, an unhold or a clearing begins it again; a crash, `replaced` or
 * `stopped` is never a failed pass; nor is a review that does not hold after a `built` build, which resumes the builder against the
 * resume bound instead, while one that resumes nobody still counts.
 */
import { describe, expect, test } from 'bun:test';

import type { LogRecord } from '../@types/LogRecord.ts';
import {
  FIXTURE_AT,
  finishedJobRecords,
  interruptedRecord,
  launchedRecord,
  ticketRecord
}                           from '../testing/LifecycleFixtures.ts';
import { FailedPassUtil } from './FailedPassUtil.ts';

const { failedPassesOf, outcomeIsAFailedPass } = FailedPassUtil;

describe('which outcomes are failed passes', () => {
  test('failed and does-not-hold are; replaced, stopped and built are not', () => {
    expect((['failed', 'does-not-hold', 'replaced', 'stopped', 'built'] as const).map(outcomeIsAFailedPass)).toEqual([true, true, false, false, false]);
  });
});

describe('counting a ticket\'s failed passes', () => {
  test('counts the ticket\'s own failed jobs, and none of another ticket\'s', () => {
    const records = [...finishedJobRecords('J1', 'build', '001', 'failed'), ...finishedJobRecords('J2', 'build', '002', 'failed')];
    expect(failedPassesOf('001', records)).toBe(1);
  });

  test('a crash and a replacement are not failed passes', () => {
    const records = [launchedRecord('J1', 'build', ['001']), interruptedRecord('J1', 'host-lost'), ...finishedJobRecords('J2', 'build', '001', 'replaced')];
    expect(failedPassesOf('001', records)).toBe(0);
  });

  test('a start from review keeps the count, a start from pending begins it again', () => {
    const rework: LogRecord[] = [...finishedJobRecords('J1', 'build', '001', 'failed'), ticketRecord('ticket-finished', '001'), ticketRecord('ticket-started', '001')];
    expect(failedPassesOf('001', rework)).toBe(1);
    const reopened: LogRecord[] = [...finishedJobRecords('J1', 'build', '001', 'failed'), {
      kind: 'ticket-reopened', ticketId: '001', fields: {}, at: FIXTURE_AT
    }, ticketRecord('ticket-started', '001')];
    expect(failedPassesOf('001', reopened)).toBe(0);
  });

  test('a review that does not hold after a built build resumes the builder and is no failed pass', () => {
    const records = [...finishedJobRecords('J1', 'build', '001', 'built'), ...finishedJobRecords('R1', 'review', '001', 'does-not-hold')];
    expect(failedPassesOf('001', records)).toBe(0);
  });

  test('a review that does not hold and resumes nobody is a failed pass', () => {
    const afterAFailedBuild = [...finishedJobRecords('J1', 'build', '001', 'failed'), ...finishedJobRecords('R1', 'review', '001', 'does-not-hold')];
    expect(failedPassesOf('001', afterAFailedBuild)).toBe(2);
    const afterAnUnhold = [
      ...finishedJobRecords('J1', 'build', '001', 'built'),
      ticketRecord('ticket-unheld', '001'),
      ...finishedJobRecords('R1', 'review', '001', 'does-not-hold'),
    ];
    expect(failedPassesOf('001', afterAnUnhold)).toBe(1);
    expect(failedPassesOf('001', finishedJobRecords('R1', 'review', '001', 'does-not-hold'))).toBe(1);
  });

  test('an unhold and a clearing begin the count again', () => {
    const failedTwice = [...finishedJobRecords('J1', 'build', '001', 'failed'), ...finishedJobRecords('J2', 'build', '001', 'failed', 2)];
    expect(failedPassesOf('001', [...failedTwice, ticketRecord('ticket-unheld', '001')])).toBe(0);
    expect(failedPassesOf('001', [...failedTwice, { kind: 'tracker-cleared', fields: {}, at: FIXTURE_AT }])).toBe(0);
  });
});
