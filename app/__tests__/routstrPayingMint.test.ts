import { Amount } from '@cashu/cashu-ts';
import { selectPayingMint, spendableMintBalances } from '@/shared/lib/routstr/payingMint';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useMintTestnutStore } from '@/shared/stores/global/mintTestnutStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

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

describe('testnut mints', () => {
  const TESTNUT = 'https://testnut.example';
  const snapshots = {
    [A]: { spendable: Amount.from(100), unit: 'sat' as const },
    [TESTNUT]: { spendable: Amount.from(5000), unit: 'sat' as const },
  };

  afterEach(() => useMintTestnutStore.setState({ byMintUrl: {} }));

  // Their Lightning backend is fake, so a provider paid with them is paid
  // nothing — and the biggest balance must not win the paying-mint pick.
  it('never counts their sats, by the stored verdict', () => {
    useMintTestnutStore.setState({
      byMintUrl: { [normalizeMintUrlKey(TESTNUT)]: { testnut: true, checkedAt: 1 } },
    });
    const balances = spendableMintBalances(snapshots);
    expect(balances).toEqual({ [A]: 100 });
    expect(selectPayingMint({ selectedMint: TESTNUT, acceptedMints: null, balances })).toEqual({
      mintUrl: A,
      balanceSats: 100,
    });
  });

  it('honours the reactive predicate React callers pass', () => {
    expect(spendableMintBalances(snapshots, (url) => url === TESTNUT)).toEqual({ [A]: 100 });
  });
});
