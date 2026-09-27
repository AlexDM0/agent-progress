/**
 * The timeout for a spec case that waits on a child process, the binary or a `bun` child. On a loaded machine each one can take seconds just to
 * start, so the five-second default fails a case that passes alone; the value is sized for the case that spawns the binary most times in a row.
 */
export const CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS = 60_000;
