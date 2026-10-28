/** A review round as the round verdict reads it: its findings, judged by class and file alone, and why another round was refused. */

export interface RoundFinding {
  class: string;
  file:  string;
}

export interface ReviewedRound<Finding extends RoundFinding = RoundFinding> {
  round:    number;
  findings: Finding[];
}

export interface ReviewedRoundWithRework<Finding extends RoundFinding = RoundFinding> extends ReviewedRound<Finding> {
  reworkedLines: number;
}

export type RoundRefusal =
  | { reason: 'rework-not-over-threshold'; requestedRound: number; reworkedLines: number }
  | { reason: 'previous-round-not-reviewed-in-this-run'; requestedRound: number }
  | { reason: 'findings-not-halved'; requestedRound: number; findingCount: number; previousFindingCount: number }
  | { reason: 'finding-class-returned'; requestedRound: number; findingClass: string }
  | { reason: 'new-file-named'; requestedRound: number; file: string };

export type RoundVerdict = { granted: true } | { granted: false; refusal: RoundRefusal };

/** The thresholds a round verdict reads, which arrive in the lifecycle's `limits`. */
export interface RoundLimits {
  REWORK_ROUND_THRESHOLD_LINES:     number;
  ROUND_GRANTED_ON_REWORK_ALONE:    number;
  FINDINGS_SHRINK_FACTOR_PER_ROUND: number;
}
