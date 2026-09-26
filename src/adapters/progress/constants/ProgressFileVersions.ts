/** The version status --json's document states, the shape that holds its worded log beside `tasks`. */
export const EMBEDDED_LOG_PROGRESS_FILE_VERSION = 1;

/** The version every write stores and the only one the current path reads, checked by equality: the log lives in log.jsonl, beside the file. */
export const CURRENT_PROGRESS_FILE_VERSION = 2;
