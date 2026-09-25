/**
 * The normalisation every ticket command depends on: each spelling an agent types has to reach the
 * one stored form, because a ticket id is stored as a string and `"3" !== "003"`.
 */
import { expect, test } from 'bun:test';

import { TicketIdUtil } from './TicketIdUtil';

const { padTicketId, parseTicketReference } = TicketIdUtil;

test('a number is padded to the stored three-digit form', () => {
  expect(padTicketId(1)).toBe('001');
  expect(padTicketId(42)).toBe('042');
  expect(padTicketId(999)).toBe('999');
});

test('an id past the padding width grows a digit instead of wrapping', () => {
  expect(padTicketId(1000)).toBe('1000');
  expect(padTicketId(1003)).toBe('1003');
});

test('all four spellings an agent actually types normalise to the one stored form', () => {
  for (const spelling of ['3', '003', '#3', '#003', ' 3 ', '  #003\n']) {
    expect(parseTicketReference(spelling), spelling).toBe('003');
  }
});

test('extra leading zeros are absorbed rather than kept', () => {
  expect(parseTicketReference('0003')).toBe('003');
});

test('a four-digit reference keeps its four digits, matching what padTicketId writes', () => {
  expect(parseTicketReference('#1003')).toBe('1003');
});

test('zero is refused, because ids start at 001 and 000 would only fail later', () => {
  expect(parseTicketReference('0')).toBeNull();
  expect(parseTicketReference('000')).toBeNull();
  expect(parseTicketReference('#0')).toBeNull();
});

test('anything that is not purely digits after an optional hash is refused', () => {
  for (const notAReference of ['', '#', '  ', 'abc', '3a', '-1', '3.0', '1 2', '003-fix-x', '#-3']) {
    expect(parseTicketReference(notAReference), notAReference).toBeNull();
  }
});

test('a reference too large to be an exact integer is refused rather than rounded to a neighbour', () => {
  // `Number('9007199254740993')` is 9007199254740992; padding that would name a different ticket.
  expect(parseTicketReference('9007199254740993')).toBeNull();
});
