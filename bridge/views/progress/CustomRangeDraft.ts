/** What the custom range popover holds before it is applied: each typed bound's verdict, the line shown under it, and the override applying it stores. */
import { TimeUtil }                from '../../utils/TimeUtil.ts';
import type { StoredViewOverride } from './utils/ChartPreferenceUtil.ts';

export type RangeBoundVerdict =
  | { readonly kind: 'resolved'; readonly epochMilliseconds: number }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'not-after-from'; readonly epochMilliseconds: number };

export interface CustomRangeDraftVerdict {
  readonly from:              RangeBoundVerdict;
  readonly to:                RangeBoundVerdict;
  readonly draftIsApplicable: boolean;
}

export interface RangeBoundLine {
  readonly text:           string;
  /** The stamp in full, or the formats the field reads. */
  readonly title:          string;
  readonly boundIsInvalid: boolean;
}

export const EMPTY_FROM_BOUND_TEXT = 'start';
export const EMPTY_TO_BOUND_TEXT   = 'now';

const BOUND_FORMAT_HINT = 'Try 2026-09-18 13:05, start, now, -2h or -1d';

function boundTextOf(typedText: string, emptyBoundText: string): string {
  const trimmed = typedText.trim();
  return trimmed === '' ? emptyBoundText : trimmed;
}

function verdictOf(text: string, resolveBound: (text: string) => number | null): RangeBoundVerdict {
  const epochMilliseconds = resolveBound(text);
  return epochMilliseconds === null ? { kind: 'unreadable' } : { kind: 'resolved', epochMilliseconds };
}

export function customRangeDraftVerdict(fromText: string, toText: string, resolveBound: (text: string) => number | null): CustomRangeDraftVerdict {
  const from = verdictOf(boundTextOf(fromText, EMPTY_FROM_BOUND_TEXT), resolveBound);
  const to   = verdictOf(boundTextOf(toText, EMPTY_TO_BOUND_TEXT), resolveBound);
  if (from.kind !== 'resolved' || to.kind !== 'resolved') return { from, to, draftIsApplicable: false };
  if (to.epochMilliseconds <= from.epochMilliseconds) {
    return { from, to: { kind: 'not-after-from', epochMilliseconds: to.epochMilliseconds }, draftIsApplicable: false };
  }
  return { from, to, draftIsApplicable: true };
}

export function customRangeOverride(fromText: string, toText: string, tickMinutes: number | null): StoredViewOverride {
  return {
    presetKey: null,
    fromText:  boundTextOf(fromText, EMPTY_FROM_BOUND_TEXT),
    toText:    boundTextOf(toText, EMPTY_TO_BOUND_TEXT),
    tickMinutes,
  };
}

export function rangeBoundLine(verdict: RangeBoundVerdict, typedText: string, todayCalendarDate: string): RangeBoundLine {
  if (verdict.kind === 'unreadable') return { text: `Can't read '${typedText.trim()}'`, title: BOUND_FORMAT_HINT, boundIsInvalid: true };
  const stamp = TimeUtil.shortInstantText(verdict.epochMilliseconds, todayCalendarDate);
  const title = TimeUtil.fullInstantText(verdict.epochMilliseconds);
  if (verdict.kind === 'not-after-from') return { text: `→ ${stamp} is not after From`, title, boundIsInvalid: true };
  return { text: `→ ${stamp}`, title, boundIsInvalid: false };
}
