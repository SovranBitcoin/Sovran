import { formatDisplayValue } from '@/shared/lib/format/displayValue';

describe('formatDisplayValue (audit 17.json F-020)', () => {
  it('returns plain for non-string and empty inputs, stringifying as needed', () => {
    expect(formatDisplayValue(undefined, true)).toEqual({ kind: 'plain', value: '' });
    expect(formatDisplayValue(null, true)).toEqual({ kind: 'plain', value: '' });
    expect(formatDisplayValue(123 as unknown, true)).toEqual({ kind: 'plain', value: '123' });
    expect(formatDisplayValue('', true)).toEqual({ kind: 'plain', value: '' });
  });

  it('splits npub prefix when special is true', () => {
    expect(formatDisplayValue('npub1abc', true)).toEqual({
      kind: 'prefix-split',
      prefix: 'npub',
      body: '1abc',
    });
  });

  it('does NOT split npub-shaped inputs when special is false', () => {
    expect(formatDisplayValue('npub1abc', false)).toEqual({ kind: 'plain', value: 'npub1abc' });
  });

  it('does NOT mistake "npub my store" for an npub', () => {
    expect(formatDisplayValue('npub my store', true)).toEqual({
      kind: 'plain',
      value: 'npub my store',
    });
  });

  it('does NOT match a bare prefix with no body', () => {
    expect(formatDisplayValue('npub', true)).toEqual({ kind: 'plain', value: 'npub' });
    expect(formatDisplayValue('cashuA', true)).toEqual({ kind: 'plain', value: 'cashuA' });
  });

  it('splits lnbc1 invoices when special is true', () => {
    expect(formatDisplayValue('lnbc1xyz', true)).toEqual({
      kind: 'prefix-split',
      prefix: 'lnbc1',
      body: 'xyz',
    });
  });

  it('disambiguates cashuA and cashuB', () => {
    expect(formatDisplayValue('cashuAfoo', true)).toEqual({
      kind: 'prefix-split',
      prefix: 'cashuA',
      body: 'foo',
    });
    expect(formatDisplayValue('cashuBbar', true)).toEqual({
      kind: 'prefix-split',
      prefix: 'cashuB',
      body: 'bar',
    });
  });

  it('uses slice(prefix.length) so a prefix repeating in the body does not split twice', () => {
    // Regression for the previous .split(prefix)[1] implementation — for an
    // input where the prefix string happens to occur a second time inside
    // the body, split-based parsing returned an empty middle slot.
    expect(formatDisplayValue('cashuAcashuArest', true)).toEqual({
      kind: 'prefix-split',
      prefix: 'cashuA',
      body: 'cashuArest',
    });
  });

  it('always recognises creqA regardless of special (matches DetailsList behaviour)', () => {
    expect(formatDisplayValue('creqAabc', false)).toEqual({
      kind: 'prefix-split',
      prefix: 'creqA',
      body: 'abc',
    });
    expect(formatDisplayValue('creqAabc', true)).toEqual({
      kind: 'prefix-split',
      prefix: 'creqA',
      body: 'abc',
    });
  });

  it('recognises bitcoin: BIP-21 with lightning+cashu', () => {
    const v = 'bitcoin:?lightning=lnbc1xxx&cashu=cashuAyyy';
    expect(formatDisplayValue(v, false)).toEqual({ kind: 'bitcoin-uri', value: v });
  });

  it('does not match bitcoin: without &cashu=', () => {
    expect(formatDisplayValue('bitcoin:?lightning=lnbc1xxx', true)).toEqual({
      kind: 'plain',
      value: 'bitcoin:?lightning=lnbc1xxx',
    });
  });

  it('parses email-shaped values when special is true', () => {
    expect(formatDisplayValue('alice@example.com', true)).toEqual({
      kind: 'email',
      username: 'alice',
      domain: 'example.com',
    });
  });

  it('does not parse email when special is false', () => {
    expect(formatDisplayValue('alice@example.com', false)).toEqual({
      kind: 'plain',
      value: 'alice@example.com',
    });
  });

  it('rejects degenerate email shapes', () => {
    expect(formatDisplayValue('@nouser', true)).toEqual({ kind: 'plain', value: '@nouser' });
    expect(formatDisplayValue('nodomain@', true)).toEqual({ kind: 'plain', value: 'nodomain@' });
  });
});
