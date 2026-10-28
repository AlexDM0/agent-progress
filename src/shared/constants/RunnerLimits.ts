/** The bounds the runner and the sessions it launches keep: how long a relayed verb waits for its reply, and how much a worker may file. */

/** How many times a relayed verb looks for its reply before it prints `queued <requestId>`; a schedule only, never a decision. */
export const RELAY_REPLY_TRIES = 20;

export const RELAY_REPLY_INTERVAL_MILLISECONDS = 250;

/** The low findings one builder, reviewer or merge-fix job may file through its relay. */
export const WORKER_FILINGS_PER_JOB = 10;

/** How many ports above `RUNNER_PORT_FIRST` a board's preferred runner port is spread over, and how far a busy port moves upward. */
export const RUNNER_PORT_COUNT = 100;

/** How many times `run --detach` and `run restart` look for the runner they started to answer; a schedule only, never a decision. */
export const RUNNER_READY_TRIES = 40;

export const RUNNER_READY_INTERVAL_MILLISECONDS = 250;

/** How many times `run stop` looks for the stopped runner's lease to be gone or dead before it reports the runner still live. */
export const RUNNER_STOP_TRIES = 40;

export const RUNNER_STOP_INTERVAL_MILLISECONDS = 250;

/** How long one request to a runner's API may take before the caller treats the API as not answering. */
export const RUNNER_REQUEST_TIMEOUT_MILLISECONDS = 2000;
