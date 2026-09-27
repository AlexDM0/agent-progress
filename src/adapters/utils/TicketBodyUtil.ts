/** What the command surface reads out of a ticket's markdown body, so the Board never has to read markdown. */

/** A heading of its own line, so a sentence that mentions `## Review` in passing is not counted as a round. */
const REVIEW_SECTION_HEADING_PATTERN = /^## Review[ \t]*$/gm;

/** How many review rounds the ticket's reviewers have written up: one `## Review` section each. */
function reviewSectionCountOf(body: string): number {
  return body.match(REVIEW_SECTION_HEADING_PATTERN)?.length ?? 0;
}

function nextReviewRoundOf(body: string): number {
  return reviewSectionCountOf(body) + 1;
}

export const TicketBodyUtil = { reviewSectionCountOf, nextReviewRoundOf } as const;
