import { DISPATCH_PROTOCOL }  from '../../src/shared/constants/DispatchProtocol.ts';
import type { ReviewFinding } from '../@types/AgentReadings.ts';
import type {
  ReviewedRound,
  ReviewedRoundWithRework,
  RoundRefusal,
  RoundVerdict
} from '../@types/DispatchOutcome.ts';
import { DISPATCH_POLICY } from '../constants/DispatchPolicy.ts';

function findingsOfRoundsBefore(earlierRounds: readonly ReviewedRound[], round: number): ReviewFinding[] {
  return earlierRounds.filter((earlier) => earlier.round < round).flatMap((earlier) => earlier.findings);
}

function refused(refusal: RoundRefusal): RoundVerdict {
  return { granted: false, refusal };
}

/**
 * Round `ROUND_GRANTED_ON_REWORK_ALONE` needs the rework count alone; a later round also needs the findings converging, or it only finds more.
 * Only rounds before `current.round` are read, so `earlierRounds` may already hold the current one.
 */
function nextRoundVerdictOf(earlierRounds: readonly ReviewedRound[], current: ReviewedRoundWithRework): RoundVerdict {
  const requestedRound = current.round + 1;
  if (current.reworkedLines <= DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES) {
    return refused({ reason: 'rework-not-over-threshold', requestedRound, reworkedLines: current.reworkedLines });
  }
  if (requestedRound === DISPATCH_POLICY.ROUND_GRANTED_ON_REWORK_ALONE) return { granted: true };
  const previous = earlierRounds.find((earlier) => earlier.round === current.round - 1);
  if (previous === undefined) return refused({ reason: 'previous-round-not-reviewed-in-this-run', requestedRound });
  const earlierFindings = findingsOfRoundsBefore(earlierRounds, current.round);
  const earlierClasses = new Set(earlierFindings.map((finding) => finding.class));
  const earlierFiles = new Set(earlierFindings.map((finding) => finding.file));
  if (current.findings.length * DISPATCH_POLICY.FINDINGS_SHRINK_FACTOR_PER_ROUND > previous.findings.length) {
    return refused({
      reason:               'findings-not-halved',
      requestedRound,
      findingCount:         current.findings.length,
      previousFindingCount: previous.findings.length,
    });
  }
  const repeatedClass = current.findings.find((finding) => earlierClasses.has(finding.class));
  if (repeatedClass !== undefined) return refused({ reason: 'finding-class-returned', requestedRound, findingClass: repeatedClass.class });
  const newFile = current.findings.find((finding) => !earlierFiles.has(finding.file));
  if (newFile !== undefined) return refused({ reason: 'new-file-named', requestedRound, file: newFile.file });
  return { granted: true };
}

export const RoundVerdictUtil = { nextRoundVerdictOf } as const;
