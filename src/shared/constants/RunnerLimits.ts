/** The bounds the runner and the sessions it launches keep: how long a relayed verb waits for its reply, and how much a worker may file. */

/** How many times a relayed verb looks for its reply before it prints `queued <requestId>`; a schedule only, never a decision. */
export const RELAY_REPLY_TRIES = 20;

export const RELAY_REPLY_INTERVAL_MILLISECONDS = 250;

/** The low findings one builder, reviewer or merge-fix job may file through its relay. */
export const WORKER_FILINGS_PER_JOB = 10;
