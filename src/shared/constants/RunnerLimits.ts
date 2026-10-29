/** The bounds the runner and the sessions it launches keep: how long a relayed verb waits for its reply, and how much a worker may file. */

/** How many times a relayed verb looks for its reply before it prints `queued <requestId>`; a schedule only, never a decision. */
export const RELAY_REPLY_TRIES = 20;

export const RELAY_REPLY_INTERVAL_MILLISECONDS = 250;

/** The low findings one builder, reviewer or merge-fix job may file through its relay. */
export const WORKER_FILINGS_PER_JOB = 10;

/** The calls a session may make past its role's call budget after the wind-down message, before the runner stops it `out-of-calls`. */
export const WIND_DOWN_GRACE_CALLS = 10;

/** Consecutive runner sweeps a running build or review job's event log may stand still before it opens `quiet-job`: a count, never a clock. */
export const QUIET_JOB_SWEEPS = 6;

/** The Assistant's model alias, which tracks the latest Sonnet, and its effort: a per-role setting User can raise. */
export const ASSISTANT_MODEL = 'sonnet';

export const ASSISTANT_EFFORT = 'medium' as const;

/** Every other role the Overseer launches: builders, reviewers, the Airlock roles and the product owner. */
export const WORKER_MODEL = 'opus';

export const WORKER_EFFORT = 'medium' as const;

/** The newest `incident-*` log records an Assistant's first message carries, so the board is its memory. */
export const ASSISTANT_HISTORY_RECORDS = 20;

/** Tool calls one Assistant turn may make before the Overseer interrupts it and the turn's open incidents default: a count. */
export const ASSISTANT_TURN_CALL_BUDGET = 40;

/** Context tokens of an Assistant's latest turn past which the Overseer closes its input after the turn, for a fresh one. */
export const ASSISTANT_CONTEXT_TOKENS_BEFORE_FRESH = 200_000;

/** How long a stopped session's host lets it end before killing its process group. */
export const SESSION_STOP_GRACE_MILLISECONDS = 5000;

/** How long reattachment waits on a live host's `welcome` and `history` before it reads the host's event log alone. */
export const REATTACH_HELLO_TIMEOUT_MILLISECONDS = 2000;

/** How many ports above `RUNNER_PORT_FIRST` a board's preferred runner port is spread over, and how far a busy port moves upward. */
export const RUNNER_PORT_COUNT = 100;

/** How many times `run --detach` and `run restart` look for the runner they started to answer; a schedule only, never a decision. */
export const RUNNER_READY_TRIES = 40;

export const RUNNER_READY_INTERVAL_MILLISECONDS = 250;

/** How many times the old runner looks for its successor's `ready` before it kills the successor as silent; a schedule only, never a decision. */
export const HANDOVER_READY_TRIES = 120;

export const HANDOVER_READY_INTERVAL_MILLISECONDS = 250;

/** How many times, at the same interval, a successor waits for `released` and the old runner then waits for the successor to serve. */
export const HANDOVER_RELEASE_TRIES = 240;

/** How many times, at the same interval, an old runner taking a handover back waits for its killed successor to be gone and binds its port. */
export const HANDOVER_REBIND_TRIES = 40;

/** How many times, at the same interval, `run restart` and `update` look for a handover's outcome: every wait of it end to end. */
export const HANDOVER_OUTCOME_TRIES = HANDOVER_READY_TRIES + HANDOVER_RELEASE_TRIES + HANDOVER_RELEASE_TRIES;

/** How many times `run stop` looks for the stopped runner's lease to be gone or dead before it reports the runner still live. */
export const RUNNER_STOP_TRIES = 40;

export const RUNNER_STOP_INTERVAL_MILLISECONDS = 250;

/** How long one request to a runner's API may take before the caller treats the API as not answering. */
export const RUNNER_REQUEST_TIMEOUT_MILLISECONDS = 2000;

/** How often the runner re-reads the board as a backstop for watch events the platform dropped; a schedule only, never a decision. */
export const RUNNER_SWEEP_SECONDS = 30;

/** How long the runner lets a burst of file events settle before it wakes a pass. */
export const RUNNER_WATCH_DEBOUNCE_MILLISECONDS = 150;

/** How long a verb's best-effort nudge may wait on the runner after its write; the runner's own watch notices the write anyway. */
export const RUNNER_NUDGE_TIMEOUT_MILLISECONDS = 500;
