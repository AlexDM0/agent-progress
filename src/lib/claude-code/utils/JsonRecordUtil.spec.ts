/** Only a plain object is a record: `null` and an array are objects to `typeof`, and must not pass as one. */
import { expect, test } from 'bun:test';

import { JsonRecordUtil } from './JsonRecordUtil';

const { recordOf } = JsonRecordUtil;

test('an object comes back as the same record', () => {
  const value = { command: 'example' };
  expect(recordOf(value)).toBe(value);
});

test('null, an array and a primitive are no record', () => {
  for (const value of [null, [], ['example'], 'example', 3, true, undefined]) {
    expect(recordOf(value), JSON.stringify(value)).toBeUndefined();
  }
});
