/**
 * A ticket's numbered Acceptance items read against its latest `## Review`, so a release can tell whether the review accounted for every
 * item. It only reads: a body it cannot make sense of is a verdict, never a throw.
 */

import { TICKET_SECTION_PATTERNS } from '../../../shared/constants/TicketSectionPatterns.ts';

export interface AcceptanceItem {
  label:        string;
  /** The reason after `Waived:` when the Acceptance itself marks the item waived, continuation lines joined; `null` otherwise. */
  waivedReason: string | null;
}

export type ReviewItemVerdict = 'holds' | 'does not hold' | 'waived';

export interface ReviewItemLine {
  label:   string;
  verdict: ReviewItemVerdict;
  /** What follows the verdict, its leading dash or colon dropped. */
  text:    string;
}

export interface ReviewWaiver {
  label:  string;
  reason: string;
}

export type AcceptanceVerdict =
  | { verdict: 'accounted-for' }
  | { verdict: 'unnumbered' }
  | { verdict: 'unaccounted'; labels: string[] }
  | { verdict: 'waived-in-review-only'; waivers: ReviewWaiver[] };

const LINE_BREAK_PATTERN        = /\r?\n/;
const REVIEW_HEADING            = /^## Review[ \t]*$/;
const WAIVED_MARKER_PATTERN     = /^Waived:[ \t]*(.*)$/;
const REVIEW_LINE_PATTERN       = /^[ \t]*(?:[-*+][ \t]+)?A(\d+)[ \t]+(holds|does not hold|waived)\b(.*)$/;
const VERDICT_SEPARATOR_PATTERN = /^[\s—–:-]+/;

function labelOf(digits: string): string {
  return `A${Number.parseInt(digits, 10)}`;
}

/** Each `##` section's lines under the heading the pattern matches, a heading inside a code fence not counting as one. */
function sectionsUnder(body: string, headingPattern: RegExp): string[][] {
  const sections: string[][] = [];
  let current: string[] | null = null;
  let insideCodeFence = false;
  for (const line of body.split(LINE_BREAK_PATTERN)) {
    if (TICKET_SECTION_PATTERNS.CODE_FENCE.test(line)) insideCodeFence = !insideCodeFence;
    if (!insideCodeFence && TICKET_SECTION_PATTERNS.SECTION_BOUNDARY.test(line)) {
      current = headingPattern.test(line) ? [] : null;
      if (current !== null) sections.push(current);
      continue;
    }
    current?.push(line);
  }
  return sections;
}

function waivedReasonOf(itemText: string, continuationLines: readonly string[]): string | null {
  const marker = WAIVED_MARKER_PATTERN.exec(itemText);
  if (marker === null) return null;
  return [marker[1] ?? '', ...continuationLines].map((line) => line.trim()).filter((line) => line !== '').join(' ');
}

/** The items of the first `## Acceptance`, in written order; an item numbered twice counts once, as first written. */
function acceptanceItemsOf(body: string): AcceptanceItem[] {
  const items: AcceptanceItem[] = [];
  const lines = sectionsUnder(body, TICKET_SECTION_PATTERNS.ACCEPTANCE_HEADING)[0] ?? [];
  for (let i = 0; i < lines.length; i++) {
    const itemLine = TICKET_SECTION_PATTERNS.ACCEPTANCE_ITEM_LINE.exec(lines[i] ?? '');
    if (itemLine === null) continue;
    const continuationLines: string[] = [];
    while (i + 1 < lines.length && (lines[i + 1] ?? '').trim() !== ''
      && !TICKET_SECTION_PATTERNS.ACCEPTANCE_ITEM_LINE.test(lines[i + 1] ?? '')) {
      i++;
      continuationLines.push(lines[i] ?? '');
    }
    const label = labelOf(itemLine[1] ?? '');
    if (items.some((item) => item.label === label)) continue;
    items.push({ label, waivedReason: waivedReasonOf(itemLine[2] ?? '', continuationLines) });
  }
  return items;
}

/** The item lines of the last `## Review` alone: an earlier round's verdicts were made on another tip. */
function latestReviewLinesOf(body: string): ReviewItemLine[] {
  const latestReview = sectionsUnder(body, REVIEW_HEADING).at(-1) ?? [];
  return latestReview.flatMap((line) => {
    const reviewLine = REVIEW_LINE_PATTERN.exec(line);
    if (reviewLine === null) return [];
    return [{
      label:   labelOf(reviewLine[1] ?? ''),
      verdict: reviewLine[2] as ReviewItemVerdict,
      text:    (reviewLine[3] ?? '').replace(VERDICT_SEPARATOR_PATTERN, '').trim(),
    }];
  });
}

/**
 * An item the Acceptance marks waived is accounted for whatever the Review says. Otherwise it needs a `holds` or `waived` line and no
 * `does not hold` one; a gap outranks a waiver, since only an otherwise complete review asks the user to agree to one.
 */
function acceptanceVerdictOf(body: string): AcceptanceVerdict {
  const items = acceptanceItemsOf(body);
  if (items.length === 0) return { verdict: 'unnumbered' };
  const reviewLines   = latestReviewLinesOf(body);
  const linesOf       = (label: string): ReviewItemLine[] => reviewLines.filter((line) => line.label === label);
  const itemsToReview = items.filter((item) => item.waivedReason === null);

  const unaccountedLabels = itemsToReview
    .filter(({ label }) => {
      const verdicts = linesOf(label).map(({ verdict }) => verdict);
      return verdicts.includes('does not hold') || !(verdicts.includes('holds') || verdicts.includes('waived'));
    })
    .map(({ label }) => label);
  if (unaccountedLabels.length > 0) return { verdict: 'unaccounted', labels: unaccountedLabels };

  const waivers = itemsToReview.flatMap(({ label }) => {
    const waiverLine = linesOf(label).find(({ verdict }) => verdict === 'waived');
    return waiverLine === undefined ? [] : [{ label, reason: waiverLine.text }];
  });
  if (waivers.length > 0) return { verdict: 'waived-in-review-only', waivers };
  return { verdict: 'accounted-for' };
}

export const TicketAcceptanceUtil = { acceptanceItemsOf, latestReviewLinesOf, acceptanceVerdictOf } as const;
