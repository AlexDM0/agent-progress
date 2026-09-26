/** A log record worded for people: when it happened and its sentence. */
export interface WordedLogEntry {
  at:   string;
  text: string;
}

/**
 * A worded entry with every task and ticket id its record concerns: both present on an entry worded from any record but a note (empty
 * when it concerns none), both absent on a note, whose text names nothing by id.
 */
export interface IdentifiedLogEntry extends WordedLogEntry {
  taskIds?:   number[];
  ticketIds?: string[];
}
