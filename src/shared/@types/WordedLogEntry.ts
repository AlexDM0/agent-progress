/** A log record worded for people: when it happened and its sentence. */
export interface WordedLogEntry {
  at:   string;
  text: string;
}

/** A worded entry with the ids of the task and the ticket its record names, each present only when the record names one. */
export interface IdentifiedLogEntry extends WordedLogEntry {
  taskId?:   number;
  ticketId?: string;
}
