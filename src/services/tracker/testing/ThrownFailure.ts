/** What the action threw; an action that does not fail fails the test. */
export async function thrownFailureOf(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('the action did not fail');
}
