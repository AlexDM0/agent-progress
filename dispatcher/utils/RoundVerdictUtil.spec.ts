/**
 * Whether a reviewer's call for another round is granted. What the run relies on is the threshold's edge (exactly the protocol's count is
 * refused), that round 2 asks for nothing but the count, and that from round 3 each convergence rule refuses on its own, with the refusal
 * naming what it found, and a missing previous round is refused rather than judged against nothing.
 */
import { describe, expect, test } from 'bun:test';

import { DISPATCH_PROTOCOL }  from '../../src/shared/constants/DispatchProtocol.ts';
import type { ReviewFinding } from '../@types/AgentReadings.ts';
import { RoundVerdictUtil }   from './RoundVerdictUtil.ts';

const { nextRoundVerdictOf } = RoundVerdictUtil;

const OVER_THE_THRESHOLD_LINES = DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES + 1;

function finding(findingClass: string, file: string): ReviewFinding {
  return { class: findingClass, file, summary: `${findingClass} in ${file}` };
}

const ROUND_ONE_FINDINGS = [finding('naming', 'a.ts'), finding('error-handling', 'b.ts'), finding('tests', 'c.ts'), finding('layout', 'd.ts')];

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
    const current = { round: 2, findings: [finding('performance', 'a.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, current], current)).toEqual({ granted: true });
  });

  test('is refused when the previous round was not reviewed in this run', () => {
    const current = { round: 3, findings: [finding('performance', 'a.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, current], current)).toEqual({
      granted: false,
      refusal: { reason: 'previous-round-not-reviewed-in-this-run', requestedRound: 4 },
    });
  });

  test('is refused when the findings did not halve, naming both counts', () => {
    const current = { round: 2, findings: [finding('performance', 'a.ts'), finding('security', 'b.ts'), finding('logging', 'c.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, current], current)).toEqual({
      granted: false,
      refusal: {
        reason: 'findings-not-halved', requestedRound: 3, findingCount: 3, previousFindingCount: 4 
      },
    });
  });

  test('is refused when a class of an earlier round came back, naming the first one that did', () => {
    const current = { round: 2, findings: [finding('performance', 'a.ts'), finding('tests', 'b.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, current], current)).toEqual({
      granted: false,
      refusal: { reason: 'finding-class-returned', requestedRound: 3, findingClass: 'tests' },
    });
  });

  test('is refused when a finding names a file no earlier round named, naming the first such file', () => {
    const current = { round: 2, findings: [finding('performance', 'a.ts'), finding('security', 'e.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, current], current)).toEqual({
      granted: false,
      refusal: { reason: 'new-file-named', requestedRound: 3, file: 'e.ts' },
    });
  });

  // Every round before the current one counts, not only the previous: a class from round 1 returning in round 3 is not converging.
  test('a class from any earlier round counts as coming back, not only the previous round\'s', () => {
    const roundTwo = { round: 2, findings: [finding('performance', 'a.ts'), finding('security', 'b.ts')] };
    const current = { round: 3, findings: [finding('naming', 'a.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, roundTwo, current], current)).toMatchObject({ granted: false, refusal: { reason: 'finding-class-returned', findingClass: 'naming' } });
  });

  test('the current round in the list is not read as an earlier one', () => {
    const current = { round: 2, findings: [finding('performance', 'a.ts')], reworkedLines: OVER_THE_THRESHOLD_LINES };
    expect(nextRoundVerdictOf([roundOne, current], current)).toEqual(nextRoundVerdictOf([roundOne], current));
  });
});
