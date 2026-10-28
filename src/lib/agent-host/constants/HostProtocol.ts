/** The host protocol this host code speaks, recorded in every host file so a later runner knows how to read and reach it. */
export const HOST_PROTOCOL_VERSION = 1;

/** The shape of an event log line, `{sequence, origin, line}`; raised only when a reader of the old shape would misread the new one. */
export const EVENT_LOG_FORMAT_VERSION = 1;
