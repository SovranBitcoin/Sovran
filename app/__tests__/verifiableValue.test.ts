import { formatVerifiableValue } from '@/shared/lib/format/verifiableValue';

describe('formatVerifiableValue', () => {
  it('shows any long value as one line: two blocks, a gap block, two blocks', () => {
    expect(formatVerifiableValue('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080')).toBe(
      'bc1q w508 ···· 7kyg t080'
    );
    const invoice = `lnbc1${'q'.repeat(250)}xyzw`;
    const text = formatVerifiableValue(invoice);
    expect(text).toBe('lnbc 1qqq ···· qqqq xyzw');
    // Every block, the gap marker included, is four characters wide.
    expect(text.split(' ').every((block) => block.length === 4)).toBe(true);
  });

  it('shows a value short enough for one line whole, grouped', () => {
    expect(formatVerifiableValue('creqA1234567890')).toBe('creq A123 4567 890');
    expect(formatVerifiableValue('a'.repeat(20))).toBe('aaaa aaaa aaaa aaaa aaaa');
  });

  it('shortens only the name of a Lightning address, keeping the domain visible', () => {
    const npub = 'npub1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqy0x6w';
    expect(formatVerifiableValue(`${npub}@npub.cash`, 'lightningAddress')).toBe(
      'npub1qqqs…0x6w@npub.cash'
    );
    expect(formatVerifiableValue('satoshi@npub.cash', 'lightningAddress')).toBe(
      'satoshi@npub.cash'
    );
  });
});
