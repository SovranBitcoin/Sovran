/** @jest-environment node */
import { truncateMiddle } from '@/shared/lib/strings';

const hex = 'a'.repeat(8) + 'b'.repeat(48) + 'c'.repeat(8);

it('keeps eight characters each side of one ellipsis by default', () => {
  expect(truncateMiddle(hex)).toBe('aaaaaaaa…cccccccc');
});

it('keeps twelve each side for detail', () => {
  expect(truncateMiddle(hex, 'detail')).toBe('aaaaaaaabbbb…bbbbcccccccc');
});

it.each([
  ['compact', 16],
  ['compact', 17],
  ['detail', 24],
  ['detail', 25],
] as const)('never lengthens a %s value of %i characters', (profile, length) => {
  const value = 'x'.repeat(length);
  expect(truncateMiddle(value, profile)).toBe(value);
});

it('shortens as soon as it can', () => {
  expect(truncateMiddle('x'.repeat(18))).toHaveLength(17);
  expect(truncateMiddle('x'.repeat(26), 'detail')).toHaveLength(25);
});

it('leaves an empty value alone', () => {
  expect(truncateMiddle('')).toBe('');
});
