/** The bounds the Overseer and the sessions it launches keep: how long a relayed verb waits for its reply, and how much a worker may file. */

/** How many times a relayed verb looks for its reply before it prints `queued <requestId>`; a schedule only, never a decision. */
export const HATCH_REPLY_TRIES = 20;

export const HATCH_REPLY_INTERVAL_MILLISECONDS = 250;

/** The low findings one builder, reviewer or merge-fix job may file through its Hatch. */
export const WORKER_FILINGS_PER_JOB = 10;

/** The calls a session may make past its role's call budget after the wind-down message, before the Overseer stops it `out-of-calls`. */
export const WIND_DOWN_GRACE_CALLS = 10;

/** The calls a session resumed after a red handoff may make before its wind-down message, counted from the resume. */
export const RED_HANDOFF_RESUME_CALL_BUDGET = 30;

/** Consecutive Overseer sweeps a running build or review job's event log may stand still before it opens `quiet-job`: a count, never a clock. */
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

/** How long a stopped session's Watcher lets it end before killing its process group. */
export const SESSION_STOP_GRACE_MILLISECONDS = 5000;

/** How long regrouping waits on a live Watcher's `welcome` and `history` before it reads the Watcher's event log alone. */
export const REGROUP_HELLO_TIMEOUT_MILLISECONDS = 2000;

/** How many ports above `OVERSEER_PORT_FIRST` a board's preferred Overseer port is spread over, and how far a busy port moves upward. */
export const OVERSEER_PORT_COUNT = 100;

/** How many times `run --detach` and `run restart` look for the Overseer they started to answer; a schedule only, never a decision. */
export const OVERSEER_READY_TRIES = 40;

export const OVERSEER_READY_INTERVAL_MILLISECONDS = 250;

/** How many times the old Overseer looks for its successor's `ready` before it kills the successor as silent; a schedule only, never a decision. */
export const BATON_PASS_READY_TRIES = 120;

export const BATON_PASS_READY_INTERVAL_MILLISECONDS = 250;

/** How many times, at the same interval, a successor waits for `released` and the old Overseer then waits for the successor to serve. */
export const BATON_PASS_RELEASE_TRIES = 240;

/** How many times, at the same interval, an old Overseer taking a Baton pass back waits for its killed successor to be gone and binds its port. */
export const BATON_PASS_REBIND_TRIES = 40;

/** How many times, at the same interval, `run restart` and `update` look for a Baton pass's outcome: every wait of it end to end. */
export const BATON_PASS_OUTCOME_TRIES = BATON_PASS_READY_TRIES + BATON_PASS_RELEASE_TRIES + BATON_PASS_RELEASE_TRIES;

/** How many times `run stop` looks for the stopped Overseer's Baton to be gone or dead before it reports the Overseer still live. */
export const OVERSEER_STOP_TRIES = 40;

export const OVERSEER_STOP_INTERVAL_MILLISECONDS = 250;

/** How long one request to an Overseer's API may take before the caller treats the API as not answering. */
export const OVERSEER_REQUEST_TIMEOUT_MILLISECONDS = 2000;

/** How often the Overseer re-reads the board as a backstop for watch events the platform dropped; a schedule only, never a decision. */
export const OVERSEER_SWEEP_SECONDS = 30;

/** How many gates the Overseers of this machine run at once, the rest queued; only the Overseers' own gate runs count. */
export const GATE_RUNS_AT_ONCE = 2;

/** How often an Overseer's in-process gate run looks for a free gate slot; a schedule only, never a decision. */
export const GATE_SLOT_RETRY_MILLISECONDS = 500;

/** How long the Overseer lets a burst of file events settle before it wakes a pass. */
export const OVERSEER_WATCH_DEBOUNCE_MILLISECONDS = 150;

/** How long a verb's best-effort nudge may wait on the Overseer after its write; the Overseer's own watch notices the write anyway. */
export const OVERSEER_NUDGE_TIMEOUT_MILLISECONDS = 500;

/** How often an Overseer event stream sends its `: ping` comment: under Bun's 10-second idle timeout, which closes a quiet stream. */
export const SSE_HEARTBEAT_SECONDS = 5;

/** The files of a job folder the API serves, as plain text under a sandbox CSP; every other file of the job folder is not served. */
export const SERVED_JOB_FILE_NAMES: readonly string[] = ['report.json', 'gate.log'];
