/**
 * Whether a reviewer's call for another round is granted. What the run relies on is the threshold's edge (exactly the protocol's count is
 * refused), that round 2 asks for nothing but the count, and that from round 3 each convergence rule refuses on its own, with the refusal
 * naming what it found: classes and files are judged against every earlier round, the halving against the previous round's first record, and a
 * missing previous round is refused rather than judged against nothing.
 */
import { describe, expect, test } from 'bun:test';

import type { ReviewFindingClass } from '../../src/lib/tracker-model/@types/ReviewRecord.ts';
import { DISPATCH_PROTOCOL }       from '../../src/shared/constants/DispatchProtocol.ts';
import type { ReviewFinding }      from '../@types/AgentReadings.ts';
import { nextRoundVerdictOf }      from './RoundVerdict.ts';

const OVER_THE_THRESHOLD_LINES = DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES + 1;

function finding(findingClass: ReviewFindingClass, file: string): ReviewFinding {
  return {
    class: findingClass, severity: 'quality', file, summary: `${findingClass} in ${file}`,
  };
}

const ROUND_ONE_FINDINGS = [finding('convention', 'a.ts'), finding('correctness', 'b.ts'), finding('test-gap', 'c.ts'), finding('docs', 'd.ts')];

describe('the rework threshold', () => {
  test('rework of exactly the threshold is refused, naming the count and the round asked for', () => {
    const current = { round: 1, findings: ROUND_ONE_FINDINGS, reworkedLines: DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([current], current)).toEqual({
      granted: false,
      refusal: { reason: 'rework-not-over-threshold', requestedRound: 2, reworkedLines: DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES },
    });
  });

  test('rework of one line over the threshold is granted round 2', () => {
    const current = { round: 1, findings: ROUND_ONE_FINDINGS, reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([current], current)).toEqual({ granted: true });
  });

  test('the threshold is checked before anything else, even from round 3', () => {
    const current = { round: 2, findings: [], reworkedLines: 0 };
    expect(nextRoundVerdictOf([current], current)).toMatchObject({ granted: false, refusal: { reason: 'rework-not-over-threshold', requestedRound: 3 } });
  });
});

describe('round 2', () => {
  // Round 2 has no earlier round to converge from, so findings that would refuse round 3 must not refuse it.
  test('is granted on the count alone, however many findings came back', () => {
    const manyFindings = [...ROUND_ONE_FINDINGS, ...ROUND_ONE_FINDINGS];
    const current = { round: 1, findings: manyFindings, reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([], current)).toEqual({ granted: true });
  });
});

describe('round 3 and later', () => {
  const roundOne = { round: 1, findings: ROUND_ONE_FINDINGS };

  test('is granted when the findings halved, no class came back and every file was named before', () => {
    const current = { round: 2, findings: [finding('acceptance-gap', 'a.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, current], current)).toEqual({ granted: true });
  });

  test('is refused when the previous round was not reviewed in this run', () => {
    const current = { round: 3, findings: [finding('acceptance-gap', 'a.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, current], current)).toEqual({
      granted: false,
      refusal: { reason: 'previous-round-not-reviewed-in-this-run', requestedRound: 4 },
    });
  });

  test('is refused when the findings did not halve, naming both counts', () => {
    const threeFindings = [finding('acceptance-gap', 'a.ts'), finding('handoff-claim-false', 'b.ts'), finding('rebase', 'c.ts')];
    const current = { round: 2, findings: threeFindings, reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, current], current)).toEqual({
      granted: false,
      refusal: {
        reason:               'findings-not-halved',
        requestedRound:       3,
        findingCount:         3,
        previousFindingCount: 4,
      },
    });
  });

  test('is refused when a class of an earlier round came back, naming the first one that did', () => {
    const current = { round: 2, findings: [finding('acceptance-gap', 'a.ts'), finding('test-gap', 'b.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, current], current)).toEqual({
      granted: false,
      refusal: { reason: 'finding-class-returned', requestedRound: 3, findingClass: 'test-gap' },
    });
  });

  test('is refused when a finding names a file no earlier round named, naming the first such file', () => {
    const current = { round: 2, findings: [finding('acceptance-gap', 'a.ts'), finding('handoff-claim-false', 'e.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, current], current)).toEqual({
      granted: false,
      refusal: { reason: 'new-file-named', requestedRound: 3, file: 'e.ts' },
    });
  });

  // Every round before the current one counts, not only the previous: a class from round 1 returning in round 3 is not converging.
  test('a class from any earlier round counts as coming back, not only the previous round\'s', () => {
    const roundTwo = { round: 2, findings: [finding('acceptance-gap', 'a.ts'), finding('handoff-claim-false', 'b.ts')] };
    const current = { round: 3, findings: [finding('convention', 'a.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, roundTwo, current], current)).toMatchObject({ granted: false, refusal: { reason: 'finding-class-returned', findingClass: 'convention' } });
  });

  // A file named only in round 1 is still known in round 3: convergence reads every earlier round's files, not only the previous round's.
  test('a file from any earlier round counts as named before, not only the previous round\'s', () => {
    const roundTwo = { round: 2, findings: [finding('acceptance-gap', 'a.ts'), finding('handoff-claim-false', 'a.ts')] };
    const current = { round: 3, findings: [finding('rebase', 'b.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, roundTwo, current], current)).toEqual({ granted: true });
  });

  test('the current round in the list is not read as an earlier one', () => {
    const current = { round: 2, findings: [finding('acceptance-gap', 'a.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, current], current)).toEqual(nextRoundVerdictOf([roundOne], current));
  });

  // A reviewer can state a round already on record, leaving two records of it; the halving is judged against the first.
  test('when a round is on record twice, the findings are halved against its first record', () => {
    const firstRoundTwoFindings = [
      finding('acceptance-gap', 'a.ts'),
      finding('handoff-claim-false', 'b.ts'),
      finding('acceptance-gap', 'c.ts'),
      finding('handoff-claim-false', 'd.ts'),
    ];
    const firstRoundTwo = { round: 2, findings: firstRoundTwoFindings };
    const secondRoundTwo = { round: 2, findings: [finding('acceptance-gap', 'a.ts')] };
    const current = { round: 3, findings: [finding('rebase', 'a.ts'), finding('out-of-scope', 'b.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, firstRoundTwo, secondRoundTwo, current], current)).toEqual({ granted: true });
  });
});
