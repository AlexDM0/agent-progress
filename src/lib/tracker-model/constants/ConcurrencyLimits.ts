/** What a tracker that never set a limit reads: the default two-slot dispatch. */
export const DEFAULT_CONCURRENCY_LIMIT_AGENTS = 2;

/** The most agents allowed in flight at once: a higher limit is refused when set, and a higher stored one reads as this. */
export const CONCURRENCY_LIMIT_CEILING_AGENTS = 10;

/** The fewest agents a limit may allow, written or stored. */
export const LOWEST_CONCURRENCY_LIMIT_AGENTS = 1;
