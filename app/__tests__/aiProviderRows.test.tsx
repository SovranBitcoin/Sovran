/**
 * How providers are ranked, and what "balance" means for one.
 *
 * Two derived figures carry the whole list. **Spendable** is what the wallet
 * holds across the mints a provider will actually redeem — the wallet total
 * says nothing about whether a given provider can be paid, and showing it
 * would promise money that cannot move. **E2EE** is the one capability worth
 * promoting: a provider running models in an enclave cannot read the prompts
 * it forwards, which is a different product from one that can.
 */

import { renderHook } from '@testing-library/react-native';

const MINIBITS = 'https://mint.minibits.cash/Bitcoin';
const SOVRAN = 'https://mint.sovran.money';
const CUBA = 'https://mint.cubabitcoin.org';

let mockProviders: Record<string, unknown> = {};
const mockBalances = {
  byMint: {
    [MINIBITS]: { total: 1_000, spendable: 1_000, unit: 'sat' },
    [SOVRAN]: { total: 9_000, spendable: 9_000, unit: 'sat' },
  },
};

jest.mock('@cashu/coco-react', () => ({
  useBalanceContext: () => ({ balances: mockBalances }),
}));

jest.mock('@/shared/lib/routstr/providerHealth', () => ({
  cachedProbe: () => undefined,
}));

jest.mock('@/shared/stores/profile/routstrStore', () => ({
  useRoutstrStore: (selector: (s: unknown) => unknown) =>
    selector({ knownProviders: mockProviders }),
}));

import { useProviderRows } from '@/features/ai/hooks/useProviderRows';

const provider = (over: Record<string, unknown> = {}) => ({
  name: 'p',
  description: null,
  version: null,
  mints: [MINIBITS],
  e2ee: null,
  pubkey: null,
  seenAt: 0,
  ...over,
});

const rows = () => renderHook(() => useProviderRows()).result.current;

describe('provider rows', () => {
  it('keeps rows in place as live health results arrive', () => {
    mockProviders = {
      'https://a.example': provider({ name: 'A' }),
      'https://b.example': provider({ name: 'B' }),
    };
    const { result, rerender } = renderHook(
      ({ probed }: { probed: Record<string, 'online' | 'offline' | 'unknown'> }) =>
        useProviderRows(probed),
      {
        initialProps: { probed: {} },
      }
    );
    expect(result.current.map((row) => row.name)).toEqual(['A', 'B']);
    rerender({ probed: { 'https://a.example': 'offline', 'https://b.example': 'online' } });
    expect(result.current.map((row) => row.name)).toEqual(['A', 'B']);
    expect(result.current[0].status).toBe('offline');
  });

  it('ignores malformed and duplicate mint entries without making an invalid restriction unrestricted', () => {
    mockProviders = {
      'https://a.example': provider({ name: 'A', mints: ['not a URL'] }),
      'https://b.example': provider({ name: 'B', mints: [MINIBITS, `${MINIBITS}/`, 'not a URL'] }),
    };
    const byName = Object.fromEntries(rows().map((r) => [r.name, r.spendableSats]));
    expect(byName).toEqual({ A: 0, B: 1_000 });
  });

  it('keeps existing choices in place when discovery refines metadata', () => {
    mockProviders = {
      'https://a.example': provider({ name: 'A' }),
      'https://b.example': provider({ name: 'B' }),
    };
    const { result, rerender } = renderHook(() => useProviderRows());
    mockProviders = {
      'https://a.example': provider({ name: 'Z' }),
      'https://b.example': provider({ name: 'B', e2ee: true }),
      'https://c.example': provider({ name: 'C', mints: [SOVRAN] }),
    };
    rerender({});
    expect(result.current.map((row) => row.baseUrl)).toEqual([
      'https://a.example',
      'https://b.example',
      'https://c.example',
    ]);
  });

  it('counts only the mints a provider will redeem', () => {
    mockProviders = {
      'https://a.example': provider({ name: 'A', mints: [MINIBITS] }),
      'https://b.example': provider({ name: 'B', mints: [SOVRAN] }),
    };
    const byName = Object.fromEntries(rows().map((r) => [r.name, r.spendableSats]));
    // Not 10,000 each: a provider that takes only Minibits can be paid 1,000.
    expect(byName).toEqual({ A: 1_000, B: 9_000 });
  });

  it('treats a provider that publishes no mints as taking any', () => {
    mockProviders = { 'https://a.example': provider({ mints: [] }) };
    expect(rows()[0].spendableSats).toBe(10_000);
  });

  it('blocks a provider whose mints hold nothing, with the reason', () => {
    mockProviders = { 'https://a.example': provider({ mints: [CUBA] }) };
    expect(rows()[0]).toMatchObject({ spendableSats: 0 });
    expect(rows()[0].blockedReason).toMatch(/do not hold/);
  });

  it('promotes end-to-end encryption above a deeper balance', () => {
    mockProviders = {
      'https://rich.example': provider({ name: 'Rich', mints: [SOVRAN], e2ee: false }),
      'https://private.example': provider({ name: 'Private', mints: [MINIBITS], e2ee: true }),
    };
    // Rich can be paid nine times as much and still comes second: a provider
    // that cannot read your prompts is the better default.
    expect(rows().map((r) => r.name)).toEqual(['Private', 'Rich']);
  });

  it('ranks by spendable balance once encryption is equal', () => {
    mockProviders = {
      'https://small.example': provider({ name: 'Small', mints: [MINIBITS] }),
      'https://big.example': provider({ name: 'Big', mints: [SOVRAN] }),
    };
    expect(rows().map((r) => r.name)).toEqual(['Big', 'Small']);
  });

  it('sorts every blocked provider last, and keeps them', () => {
    mockProviders = {
      'https://blocked.example': provider({ name: 'Blocked', mints: [CUBA], e2ee: true }),
      'https://usable.example': provider({ name: 'Usable', mints: [MINIBITS] }),
    };
    // Encrypted, and still last: a provider you cannot pay is not a candidate,
    // but it stays on the list so the reason is reachable.
    expect(rows().map((r) => r.name)).toEqual(['Usable', 'Blocked']);
  });
});
