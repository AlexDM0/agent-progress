/** A parsed JSON value that is an object with string keys: `null` and an array are objects to `typeof` and do not count. */
function valueIsAPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A parsed JSON value read as an object with string keys, or `undefined` when it is `null`, an array or a primitive. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return valueIsAPlainObject(value) ? value : undefined;
}

export const JsonRecordUtil = { recordOf, valueIsAPlainObject } as const;
