/**
 * The typed refusal library code throws instead of exiting, since nothing under `src/` calls `process.exit`: `cli/Main.ts` maps
 * `refused` to exit 1, a refusal the caller can act on, and `unrepaired` to exit 2, a state the tool will not repair on its own. A refusal
 * thrown from `src/` carries a detail, a reason code with its facts and no words, that the command line words; only `cli/` builds one from words.
 */
import type { BoardRefusalDetail }       from '../lib/tracker-model/BoardRefusal.ts';
import type { InstallVersionMismatch }   from './@types/InstallVersionMismatch.ts';
import type { RoleCommandRefusalReason } from './@types/RoleCommandRefusalReason.ts';
import type { UnreadableTracker }        from './@types/UnreadableTracker.ts';

export type OperationRefusalStatus = 'refused' | 'unrepaired';

export type OperationRefusalDetail =
  | { kind: 'board-refusal'; boardRefusal: BoardRefusalDetail }
  | { kind: 'unreadable-tracker'; reading: UnreadableTracker }
  | { kind: 'no-tracker-at-override'; overrideDirectory: string }
  | { kind: 'no-tracker-found'; searchedFrom: string }
  | { kind: 'tracker-lock-held'; lockDirectoryPath: string }
  | { kind: 'lock-taken-over'; lockDirectoryPath: string }
  | { kind: 'malformed-hold-journal'; journalFilePath: string; reason: string }
  | { kind: 'template-token-not-unique'; templateFilePath: string; token: string; occurrenceCount: number }
  | { kind: 'install-version-mismatch'; rootDirectory: string; manifestFilePath: string; installVersion: number; mismatch: InstallVersionMismatch }
  | { kind: 'older-program-present'; rootDirectory: string; olderDataFolderPath: string; program: string; olderProgram: string }
  | { kind: 'no-readable-ticket'; reference: string }
  | { kind: 'malformed-ticket-file'; filePath: string; line: number; reason: string }
  | { kind: 'unreadable-file-in-the-way'; filePath: string; record: 'epic' | 'draft' }
  | { kind: 'no-check-command-to-clear' }
  | { kind: 'role-command-refused'; reason: RoleCommandRefusalReason; commandKind: string }
  | { kind: 'verb-not-relayable'; verb: string; jobId: string }
  | { kind: 'malformed-relay-reply'; replyFilePath: string };

function reasonCodeOf(detail: OperationRefusalDetail): string {
  if (detail.kind === 'role-command-refused') return detail.reason;
  return detail.kind === 'board-refusal' ? detail.boardRefusal.reason : detail.kind;
}

export class OperationRefusal extends Error {
  readonly status: OperationRefusalStatus;
  readonly detail: OperationRefusalDetail | null;

  constructor(status: OperationRefusalStatus, explanation: string | OperationRefusalDetail) {
    super(typeof explanation === 'string' ? explanation : reasonCodeOf(explanation));
    // Extending a built-in leaves `name` as `Error`, and the name is what an unhandled stack trace shows.
    this.name   = 'OperationRefusal';
    this.status = status;
    this.detail = typeof explanation === 'string' ? null : explanation;
  }
}

export function refusalIsOperationRefusal(error: unknown): error is OperationRefusal {
  return error instanceof OperationRefusal;
}
