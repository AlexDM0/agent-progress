/**
 * The typed refusal library code throws instead of exiting, since nothing under `lib/` calls
 * `process.exit`: `cli/Main.ts` maps `refused` to exit 1, a refusal the caller can act on, and
 * `unrepaired` to exit 2, a state the tool will not repair on its own.
 */

export type OperationRefusalStatus = 'refused' | 'unrepaired';

export class OperationRefusal extends Error {
  readonly status: OperationRefusalStatus;

  constructor(status: OperationRefusalStatus, message: string) {
    super(message);
    // Extending a built-in leaves `name` as `Error`, and the name is what an unhandled stack trace shows.
    this.name = 'OperationRefusal';
    this.status = status;
  }
}

export function refusalIsOperationRefusal(error: unknown): error is OperationRefusal {
  return error instanceof OperationRefusal;
}
