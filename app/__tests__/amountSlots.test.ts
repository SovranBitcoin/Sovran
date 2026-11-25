import { rollDirection, tokenizeAmount, type AmountSlot } from '@/shared/lib/amountSlots';

const keys = (slots: AmountSlot[]) => slots.map((s) => `${s.key}:${s.char}`);
const digitKeys = (text: string) =>
  tokenizeAmount(text)
    .filter((s) => s.kind === 'digit')
    .map((s) => s.key);

describe('tokenizeAmount', () => {
  it('keys a ₿-prefixed sats amount from the ones digit', () => {
    expect(keys(tokenizeAmount('₿ 1,250'))).toEqual([
      'pre-1:₿',
      'pre-0: ',
      'int-3:1',
      'isep-3:,',
      'int-2:2',
      'int-1:5',
      'int-0:0',
    ]);
  });

  it('keys suffixes, fractions and the decimal point', () => {
    expect(keys(tokenizeAmount('1,250 sats'))).toEqual([
      'int-3:1',
      'isep-3:,',
      'int-2:2',
      'int-1:5',
      'int-0:0',
      'suf-0: ',
      'suf-1:s',
      'suf-2:a',
      'suf-3:t',
      'suf-4:s',
    ]);
    expect(keys(tokenizeAmount('$12.34'))).toEqual([
      'pre-0:$',
      'int-1:1',
      'int-0:2',
      'point:.',
      'frac-0:3',
      'frac-1:4',
    ]);
    expect(digitKeys('0.00012500 BTC')).toEqual([
      'int-0',
      'frac-0',
      'frac-1',
      'frac-2',
      'frac-3',
      'frac-4',
      'frac-5',
      'frac-6',
      'frac-7',
    ]);
  });

  it('keeps a sign and its space as static slots', () => {
    const slots = tokenizeAmount('+ 42 sats');
    expect(slots.slice(0, 4).map((s) => [s.kind, s.key, s.char])).toEqual([
      ['static', 'pre-1', '+'],
      ['static', 'pre-0', ' '],
      ['digit', 'int-1', '4'],
      ['digit', 'int-0', '2'],
    ]);
  });

  it('keeps the low digits keyed the same when the amount gains a digit', () => {
    const before = tokenizeAmount('999');
    const after = tokenizeAmount('1,000');
    const lowBefore = before.filter((s) => s.kind === 'digit').map((s) => s.key);
    const lowAfter = after.filter((s) => s.kind === 'digit').map((s) => s.key);
    expect(lowBefore).toEqual(['int-2', 'int-1', 'int-0']);
    expect(lowAfter).toEqual(['int-3', 'int-2', 'int-1', 'int-0']);
  });

  it('never splits a variation-selector glyph and reads text with no digits', () => {
    const lightning = tokenizeAmount('21 ⚡︎');
    expect(lightning.map((s) => s.char)).toEqual(['2', '1', '\u2009', '\u26A1\uFE0E']);
    expect(tokenizeAmount('≈ —').every((s) => s.kind === 'static')).toBe(true);
  });

  it('gives every slot a unique key', () => {
    for (const text of ['₿ 1,234,567', '$1,234.56', '0.00012500 BTC', '- 1 sats']) {
      const k = tokenizeAmount(text).map((s) => s.key);
      expect(new Set(k).size).toBe(k.length);
    }
  });
});

describe('rollDirection', () => {
  it('follows the value, so a carry on an increase rolls up', () => {
    expect(rollDirection({ digit: 9, value: 9 }, { digit: 0, value: 10 })).toBe(1);
    expect(rollDirection({ digit: 0, value: 10 }, { digit: 9, value: 9 })).toBe(-1);
  });

  it('falls back to the digits when the value says nothing', () => {
    expect(rollDirection({ digit: 2 }, { digit: 5 })).toBe(1);
    expect(rollDirection({ digit: 5, value: 3 }, { digit: 2, value: 3 })).toBe(-1);
  });
});
