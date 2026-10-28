/** The host protocol this host code speaks, recorded in every host file so a later runner knows how to read and reach it. */
export const HOST_PROTOCOL_VERSION = 1;

/** The shape of an event log line, `{sequence, origin, line}`; raised only when a reader of the old shape would misread the new one. */
export const EVENT_LOG_FORMAT_VERSION = 1;

/** How many client frames an ended host answers without the acknowledgement before it exits anyway: a count, never a time. */
export const HOST_LINGER_FRAMES = 5;

/** macOS keeps 104 bytes for a socket path, its terminating zero byte included. */
export const HOST_SOCKET_PATH_LIMIT_BYTES = 104;
