import { refusalIsOperationRefusal, type OperationRefusal } from '../../src/shared/OperationRefusal.ts';

/** The `OperationRefusal` the call threw; any other throw propagates, and a call that returns fails the test. */
export function refusalFrom(action: () => unknown): OperationRefusal {
  try {
    action();
  } catch (error) {
    if (refusalIsOperationRefusal(error)) return error;
    throw error;
  }
  throw new Error('the call was expected to refuse and it returned instead');
}
