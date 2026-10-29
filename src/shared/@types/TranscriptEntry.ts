/**
 * One vendor-neutral line of a job's transcript, as the Overseer's job stream sends it: the Bridge never parses a vendor line. `cursor` is
 * `<instance>.<sequence>`, because each Watcher instance numbers its event log from 1.
 */
export type TranscriptRole = 'assistant' | 'user' | 'tool-call' | 'tool-result' | 'overseer' | 'watcher';

export interface TranscriptEntry {
  cursor:           string;
  role:             TranscriptRole;
  text:             string;
  /** The Watcher log entry's stamp; absent on a log written before stamps. */
  at?:              string;
  toolName?:        string;
  parentToolUseId?: string;
  model?:           string;
  tokens?:          number;
}
