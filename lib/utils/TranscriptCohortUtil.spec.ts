/**
 * The two decisions this module makes and nothing else does: that calls are a median while tokens are
 * a mean — each pinned by a cohort holding one outlier, so a summary that swapped them would fail —
 * and which side of a split an agent falls on, including the one with no stamp at all.
 *
 * Every profile here is constructed from the fields the summary reads, because the claim is about the
 * arithmetic and not about any recorded session.
 */
import { describe, expect, test } from 'bun:test';

import { TranscriptCohortUtil }   from './TranscriptCohortUtil';
import type { TranscriptProfile } from './TranscriptUsageUtil';

const { splitAt, summariseCohort } = TranscriptCohortUtil;

interface ConstructedProfile {
  apiCallCount?:                number;
  inputTokens?:                 number;
  cacheReadInputTokens?:        number;
  outputTokens?:                number;
  endContextTokens?:            number;
  browserCallCount?:            number;
  nestedInstructionCharacters?: number;
  startedAt?:                   string | null;
}

function profile(fields: ConstructedProfile): TranscriptProfile {
  return {
    apiCallCount:                fields.apiCallCount ?? 0,
    inputTokens:                 fields.inputTokens ?? 0,
    cacheReadInputTokens:        fields.cacheReadInputTokens ?? 0,
    cacheCreationInputTokens:    0,
    outputTokens:                fields.outputTokens ?? 0,
    endContextTokens:            fields.endContextTokens ?? 0,
    startedAt:                   fields.startedAt ?? null,
    model:                       'claude-opus-5',
    browserCallCount:            fields.browserCallCount ?? 0,
    nestedInstructionCharacters: fields.nestedInstructionCharacters ?? 0,
    briefExcerpt:                'Do the thing',
  };
}

describe('what a cohort of transcripts is summarised as', () => {
  /** The reason for the median: an agent stuck in a screenshot loop must not decide what a typical agent did. */
  test('one runaway agent moves the mean input and leaves the median call count where the cohort is', () => {
    const cohort = [
      profile({ apiCallCount: 30, inputTokens: 1_000, endContextTokens: 100_000 }),
      profile({ apiCallCount: 32, inputTokens: 2_000, endContextTokens: 160_000 }),
      profile({ apiCallCount: 34, inputTokens: 3_000, endContextTokens: 170_000 }),
      profile({ apiCallCount: 36, inputTokens: 4_000, endContextTokens: 180_000 }),
      profile({ apiCallCount: 400, inputTokens: 990_000, endContextTokens: 720_000 }),
    ];

    const summary = summariseCohort(cohort);

    expect(summary.transcriptCount).toBe(5);
    expect(summary.medianApiCallCount).toBe(34);
    expect(summary.medianEndContextTokens).toBe(170_000);
    expect(summary.meanTotalInputTokens).toBe(200_000);
  });

  test('the input figure is the whole of what was sent, cache reads included', () => {
    const cohort = [
      profile({ inputTokens: 1_000, cacheReadInputTokens: 9_000 }),
      profile({ inputTokens: 3_000, cacheReadInputTokens: 7_000 }),
    ];

    expect(summariseCohort(cohort).meanTotalInputTokens).toBe(10_000);
  });

  test('an even count takes the two middle values, so neither of a pair is reported as the cohort', () => {
    const cohort = [profile({ apiCallCount: 10 }), profile({ apiCallCount: 21 })];

    expect(summariseCohort(cohort).medianApiCallCount).toBe(15.5);
  });

  /** A cohort where one agent in five reached for the browser has to read as 0.2, not as 0, which is why this mean alone is not rounded. */
  test('the mean browser call count keeps its fraction while the token means are whole', () => {
    const cohort = [
      profile({ browserCallCount: 1, outputTokens: 1_000 }),
      profile({ browserCallCount: 0, outputTokens: 1_001 }),
      profile({ browserCallCount: 0, outputTokens: 1_001 }),
      profile({ browserCallCount: 0, outputTokens: 1_001 }),
      profile({ browserCallCount: 0, outputTokens: 1_001 }),
    ];

    const summary = summariseCohort(cohort);

    expect(summary.meanBrowserCallCount).toBeCloseTo(0.2);
    expect(Number.isInteger(summary.meanOutputTokens)).toBe(true);
  });

  test('the injected characters are averaged too, because that is the part of the length nobody wrote', () => {
    const cohort = [profile({ nestedInstructionCharacters: 1_000 }), profile({ nestedInstructionCharacters: 3_000 })];

    expect(summariseCohort(cohort).meanNestedInstructionCharacters).toBe(2_000);
  });

  /** A side of a split that nothing fell into still gets a line printed for it, so it must answer zeroes rather than `null` or a throw. */
  test('an empty cohort is zero of everything and not an error', () => {
    expect(summariseCohort([])).toEqual({
      transcriptCount:                 0,
      medianApiCallCount:              0,
      medianEndContextTokens:          0,
      meanTotalInputTokens:            0,
      meanOutputTokens:                0,
      meanBrowserCallCount:            0,
      meanNestedInstructionCharacters: 0,
    });
  });
});

describe('splitting a cohort on an instant', () => {
  const BOUNDARY = new Date('2026-09-19T08:55:00Z');

  test('before is what started strictly earlier and after holds the boundary itself', () => {
    const earlier    = profile({ apiCallCount: 1, startedAt: '2026-09-19T08:54:59.000Z' });
    const onTheMark  = profile({ apiCallCount: 2, startedAt: '2026-09-19T08:55:00.000Z' });
    const later      = profile({ apiCallCount: 3, startedAt: '2026-09-19T09:30:00.000Z' });

    const split = splitAt([later, earlier, onTheMark], BOUNDARY);

    expect(split.before.map((entry) => entry.apiCallCount)).toEqual([1]);
    expect(split.after.map((entry) => entry.apiCallCount)).toEqual([3, 2]);
  });

  /** Fail closed: an agent that cannot be shown to have run after the change must never be counted as evidence the change helped. */
  test('a profile with no stamp, and one whose stamp will not parse, both fall on the before side', () => {
    const undated    = profile({ apiCallCount: 1, startedAt: null });
    const unreadable = profile({ apiCallCount: 2, startedAt: 'the day before yesterday' });

    const split = splitAt([undated, unreadable], BOUNDARY);

    expect(split.before).toHaveLength(2);
    expect(split.after).toEqual([]);
  });

  test('a stamp with an offset is compared as the instant it names, not as the digits it is written with', () => {
    // 10:55 in +02:00 is 08:55 UTC, so this is the boundary itself and belongs on the after side.
    const split = splitAt([profile({ startedAt: '2026-09-19T10:55:00+02:00' })], BOUNDARY);

    expect(split.after).toHaveLength(1);
  });

  test('an empty cohort splits into two empty sides', () => {
    expect(splitAt([], BOUNDARY)).toEqual({ before: [], after: [] });
  });
});
