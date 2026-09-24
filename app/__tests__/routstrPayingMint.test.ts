import { Amount } from '@cashu/cashu-ts';
import { selectPayingMint, spendableMintBalances } from '@/shared/lib/routstr/payingMint';

const A = 'https://mint.example/Bitcoin';
const B = 'https://other.example';

it('uses a funded accepted mint when the selected mint is incompatible', () => {
  expect(
    selectPayingMint({ selectedMint: B, acceptedMints: [A], balances: { [A]: 100, [B]: 900 } })
  ).toEqual({ mintUrl: A, balanceSats: 100 });
});

it('does not add balances from different mints to authorize one payment', () => {
  expect(
    selectPayingMint({ selectedMint: null, acceptedMints: [A, B], balances: { [A]: 5, [B]: 6 } })
  ).toEqual({ mintUrl: B, balanceSats: 6 });
});

it('does not collapse case-sensitive mint paths', () => {
  expect(
    selectPayingMint({ selectedMint: A, acceptedMints: [A.toLowerCase()], balances: { [A]: 100 } })
  ).toBeNull();
});

it('ignores reserved funds and non-sat balances', () => {
  expect(
    spendableMintBalances({
      [A]: { spendable: Amount.from(0), unit: 'sat' },
      [B]: { spendable: Amount.from(1000), unit: 'msat' },
      'https://available.example': { spendable: Amount.from(12), unit: 'sat' },
    })
  ).toEqual({ 'https://available.example': 12 });
});

it('contains malformed provider mints without treating them as unrestricted', () => {
  expect(
    selectPayingMint({ selectedMint: A, acceptedMints: ['not a URL'], balances: { [A]: 100 } })
  ).toBeNull();
  expect(
    selectPayingMint({ selectedMint: A, acceptedMints: ['not a URL', A], balances: { [A]: 100 } })
  ).toEqual({ mintUrl: A, balanceSats: 100 });
});
