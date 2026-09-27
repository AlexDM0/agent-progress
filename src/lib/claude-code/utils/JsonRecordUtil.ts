/** A parsed JSON value read as an object with string keys, or `undefined` when it is `null`, an array or a primitive. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export const JsonRecordUtil = { recordOf } as const;
