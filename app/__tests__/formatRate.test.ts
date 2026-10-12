/** @jest-environment node */
import { formatRate } from '@/shared/lib/number';

it.each([
  [1, '100%'],
  [0.995, '99.5%'],
  [0.9949, '99.5%'],
  [0.5, '50%'],
  [0, '0%'],
  [0.123456, '12.3%'],
])('shows %d as %s on every surface', (rate, shown) => {
  expect(formatRate(rate)).toBe(shown);
});

it('keeps the decimal that tells 99.9% from 100%', () => {
  expect(formatRate(0.9994)).toBe('99.9%');
});
