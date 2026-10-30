/**
 * The review as an optional phase: without a pipeline `review` no reviewer is ever launched, whatever waits in review; and a review that
 * does not hold resumes the builder in the same attempt, counted against the red-handoff resumes of its cycle, so the review that goes
 * one past them parks the ticket instead. What matters is that no reviewer launches on a board that left review out, and that a review
 * resume and a red resume share the one bound.
 */
import { describe, expect, test } from 'bun:test';

import type { LogRecord }  from './@types/LogRecord.ts';
import { LifecyclePolicy } from './LifecyclePolicy.ts';
import {
  factsWith,
  FIXTURE_AT,
  FIXTURE_LIMITS,
  finishedJobRecords,
  interruptedRecord,
  launchedRecord,
  endedRecord,
  ticketOf
} from './testing/LifecycleFixtures.ts';

function redResumedRecord(jobId: string): LogRecord {
  return {
    kind: 'job-resumed', jobId, fields: { hostInstance: 2, cause: 'handoff-red' }, at: FIXTURE_AT,
  };
}

/** The builder `J1` built, then a review per entry that did not hold, each followed by the resumed builder that built again. */
function failedReviewsRecords(failedReviews: number): LogRecord[] {
  const records: LogRecord[] = [...finishedJobRecords('J1', 'build', '001', 'built')];
  for (let review = 1; review <= failedReviews; review += 1) {
    records.push(...finishedJobRecords(`R${review}`, 'review', '001', 'does-not-hold', review));
    if (review < failedReviews) records.push(...finishedJobRecords(`B${review}`, 'build', '001', 'built'));
  }
  return records;
}

describe('a pipeline without a review phase', () => {
  test('launches no reviewer for a ticket waiting in review', () => {
    const steps = LifecyclePolicy.nextStepsOf(factsWith({ tickets: [ticketOf('001', 'in-review')], reviewIsSet: false }), FIXTURE_LIMITS);
    expect(steps.filter((step) => step.kind === 'launch-review')).toEqual([]);
  });

  test('still launches the reviewer once the review phase is set', () => {
    const steps = LifecyclePolicy.nextStepsOf(factsWith({ tickets: [ticketOf('001', 'in-review')], reviewIsSet: true }), FIXTURE_LIMITS);
    expect(steps).toEqual([{
      kind: 'launch-review', ticketId: '001', round: 1, target: 'main'
    }]);
  });
});

describe('a review that does not hold', () => {
  test('relaunches the builder in the same attempt, so its session is resumed', () => {
    const steps = LifecyclePolicy.nextStepsOf(factsWith({ tickets: [ticketOf('001', 'in-progress')], logRecords: failedReviewsRecords(1) }), FIXTURE_LIMITS);
    expect(steps).toEqual([{
      kind: 'launch-build', ticketId: '001', attempt: 1, base: 'main'
    }]);
  });

  test('counts against the red-handoff resumes of the build cycle', () => {
    const records = failedReviewsRecords(1);
    expect(LifecyclePolicy.handoffCycleResumesOf({ kind: 'build', ticketIds: ['001'], attempt: 1 }, records)).toBe(1);
    const withRed = [...records, launchedRecord('B1', 'build', ['001']), interruptedRecord('B1', 'handoff-red'), redResumedRecord('B1')];
    expect(LifecyclePolicy.handoffCycleResumesOf({ kind: 'build', ticketIds: ['001'], attempt: 1 }, withRed)).toBe(2);
  });

  test('parks the ticket once the review goes one past the resumes left, launching nothing', () => {
    const records = [
      ...finishedJobRecords('J1', 'build', '001', 'built'),
      ...finishedJobRecords('R1', 'review', '001', 'does-not-hold'),
      launchedRecord('B1', 'build', ['001']),
      interruptedRecord('B1', 'handoff-red'),
      redResumedRecord('B1'),
      endedRecord('B1', 'built'),
      ...finishedJobRecords('R2', 'review', '001', 'does-not-hold', 2),
    ];
    const limits = { ...FIXTURE_LIMITS, FAILED_PASSES_BEFORE_PARKING: 3 };
    const steps = LifecyclePolicy.nextStepsOf(factsWith({ tickets: [ticketOf('001', 'in-progress')], logRecords: records }), limits);
    expect(steps).toEqual([{ kind: 'park', ticketId: '001', cause: 'red-resumes-spent' }]);
  });
});
