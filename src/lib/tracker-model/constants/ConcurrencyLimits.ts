/** What a tracker that never set a limit reads: the two-slot dispatch the orchestrate skill was written around. */
export const DEFAULT_CONCURRENCY_LIMIT = 2;

/** The most agents allowed in flight at once: `concurrency` refuses a higher limit, and a higher stored one reads as this. */
export const CONCURRENCY_LIMIT_CEILING_AGENTS = 10;
