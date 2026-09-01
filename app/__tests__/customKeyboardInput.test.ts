/**
 * @jest-environment node
 *
 * The keypad's input rules — no leading decimal, one decimal point, no leading
 * zeros, two decimal places, sats are integers — decide what a user can type
 * into every amount field in the app. They used to live inside a
 * `setInputValue` updater with haptics and `onKeyPress` fired from it, where
 * nothing could reach them.
 */

import { nextKeypadValue } from '@/shared/ui/composed/keypadInput';

describe('nextKeypadValue', () => {
  describe('sats (integer only)', () => {
    it('appends digits', () => {
      expect(nextKeypadValue('', '1', 'sat')).toBe('1');
      expect(nextKeypadValue('1', '2', 'sat')).toBe('12');
    });

    it('rejects a leading zero', () => {
      expect(nextKeypadValue('', '0', 'sat')).toBeNull();
    });

    it('rejects a leading decimal point', () => {
      expect(nextKeypadValue('', '.', 'sat')).toBeNull();
    });

    // Not a rule the keypad enforces: the '.' key is simply absent from the
    // sat layout, so a sat amount never sees one.
    it('appends a decimal point when one is somehow pressed', () => {
      expect(nextKeypadValue('12', '.', 'sat')).toBe('12.');
    });

    it('deletes from the end', () => {
      expect(nextKeypadValue('123', '<', 'sat')).toBe('12');
      expect(nextKeypadValue('', '<', 'sat')).toBe('');
    });
  });

  describe('fiat (two decimal places)', () => {
    it('replaces a lone zero rather than appending to it', () => {
      expect(nextKeypadValue('0', '5', 'usd')).toBe('5');
    });

    it('keeps the zero when a decimal point follows it', () => {
      expect(nextKeypadValue('0', '.', 'usd')).toBe('0.');
    });

    it('rejects a second decimal point', () => {
      expect(nextKeypadValue('1.5', '.', 'usd')).toBeNull();
    });

    it('rejects a leading decimal point', () => {
      expect(nextKeypadValue('', '.', 'usd')).toBeNull();
    });

    it('collapses a second zero onto the lone zero rather than making "00"', () => {
      expect(nextKeypadValue('0', '0', 'usd')).toBe('0');
    });

    it('truncates past two decimal places instead of rejecting', () => {
      expect(nextKeypadValue('1.23', '4', 'usd')).toBe('1.23');
      expect(nextKeypadValue('1.2', '3', 'usd')).toBe('1.23');
    });
  });
});
