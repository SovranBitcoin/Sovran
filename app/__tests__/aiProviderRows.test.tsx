/**
 * How providers are ranked, and what "balance" means for one.
 *
 * **Spendable** is what the wallet holds across the mints a provider will
 * actually redeem — the wallet total says nothing about whether a given
 * provider can be paid, and showing it would promise money that cannot move.
 *
 * Ordering has two authorities and they do not overlap. nagg discovers and
 * probes the network continuously and serves it best-first, so its order is
 * rendered as given. What the phone decides is what nagg cannot know: whether
 * this wallet can pay a provider, and what this device has seen for itself
 * since nagg last looked. With no directory — nagg down, or a provider it
 * never heard of — the local ranking is still there and still ranks.
 */

import { renderHook } from '@testing-library/react-native';

import { useProviderRows } from '@/features/ai/hooks/useProviderRows';
import type { ServerProvider } from '@/shared/lib/routstr/providers';

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

jest.mock('@/shared/lib/nostr/client', () => ({ npubToPubkey: () => null }));

// `resolveProviderStatus` is the rule under test wherever a probe and the
// server disagree, so it is the REAL one; only the probe cache is stubbed.
jest.mock('@/shared/lib/routstr/providerHealth', () => ({
  ...jest.requireActual('@/shared/lib/routstr/providerHealth'),
  cachedProbe: () => undefined,
}));

jest.mock('@/shared/stores/profile/routstrStore', () => ({
  useRoutstrStore: (selector: (s: unknown) => unknown) =>
    selector({ knownProviders: mockProviders }),
}));

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

const served = (baseUrl: string, over: Partial<ServerProvider> = {}): ServerProvider => ({
  baseUrl,
  mints: [],
  status: 'online',
  ...over,
});

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

  it("renders nagg's order rather than re-deriving one from the same fields", () => {
    mockProviders = {
      'https://third.example': provider({ name: 'Third' }),
      'https://first.example': provider({ name: 'First' }),
      'https://second.example': provider({ name: 'Second', e2ee: true }),
    };
    // Alphabetical order, insertion order and the local E2EE-first ranking all
    // disagree with this; the server's does not get a vote from any of them.
    const directory = [
      served('https://first.example'),
      served('https://second.example'),
      served('https://third.example'),
    ];
    const { result } = renderHook(() => useProviderRows({}, directory));
    expect(result.current.map((row) => row.name)).toEqual(['First', 'Second', 'Third']);
  });

  it('lets a local probe overrule the status nagg cached, and re-seats the row', () => {
    mockProviders = {
      'https://stale.example': provider({ name: 'Stale' }),
      'https://revived.example': provider({ name: 'Revived' }),
    };
    const directory = [
      served('https://stale.example', { status: 'online' }),
      served('https://revived.example', { status: 'offline' }),
    ];
    const { result } = renderHook(() =>
      useProviderRows(
        // We just reached one and failed to reach the other. First-hand beats
        // a data centre's cached opinion, in both directions.
        { 'https://stale.example': 'offline', 'https://revived.example': 'online' },
        directory
      )
    );
    expect(result.current.map((row) => [row.name, row.status])).toEqual([
      ['Revived', 'online'],
      ['Stale', 'offline'],
    ]);
    expect(result.current[1].blockedReason).toBe('Not answering right now');
  });

  it('leaves a row nobody has checked as unknown rather than calling it offline', () => {
    mockProviders = { 'https://quiet.example': provider({ name: 'Quiet' }) };
    const { result } = renderHook(() =>
      useProviderRows({}, [served('https://quiet.example', { status: 'unknown' })])
    );
    expect(result.current[0].status).toBe('unknown');
    expect(result.current[0].blockedReason).toBeNull();
  });

  it('keeps the local ranking for providers the directory never mentioned', () => {
    mockProviders = {
      'https://served.example': provider({ name: 'Served' }),
      'https://rich.example': provider({ name: 'Rich', mints: [SOVRAN] }),
      'https://poor.example': provider({ name: 'Poor', mints: [MINIBITS] }),
    };
    const { result } = renderHook(() => useProviderRows({}, [served('https://served.example')]));
    // The served row leads its band; the two nagg never saw fall back to the
    // local ranking (deeper spendable balance first) behind it.
    expect(result.current.map((row) => row.name)).toEqual(['Served', 'Rich', 'Poor']);
  });

  it('carries the encrypted-model COUNT, never a provider-level claim', () => {
    mockProviders = { 'https://sealed.example': provider({ name: 'Sealed' }) };
    const { result } = renderHook(() =>
      useProviderRows({}, [
        served('https://sealed.example', { encryptedModelCount: 9, modelCount: 582 }),
      ])
    );
    // 9 of 582. A lock on the row would promise the other 573 are sealed too.
    expect(result.current[0]).toMatchObject({ encryptedModelCount: 9, modelCount: 582 });
  });

  it('decides "you have no mint for this" with no network answer at all', () => {
    // One of the only two reasons a provider is unusable, and the only one
    // this device can settle by itself: it is two lists compared. nagg says
    // this row is up and nothing has been probed, and the verdict is still
    // there in the first render rather than after a sweep.
    mockProviders = { 'https://a.example': provider({ name: 'A', mints: [CUBA] }) };
    const { result } = renderHook(() =>
      useProviderRows({}, [served('https://a.example', { status: 'online' })])
    );
    expect(result.current[0].blockedReason).toMatch(/do not hold/);
    // And it is NOT the reachability answer wearing the mint's clothes.
    expect(result.current[0].status).toBe('online');
  });

  it('never blames reachability for a wallet that cannot pay', () => {
    // Both are true at once. The one the user can act on — hold a mint this
    // provider redeems — is the one the row states.
    mockProviders = { 'https://a.example': provider({ name: 'A', mints: [CUBA] }) };
    const { result } = renderHook(() => useProviderRows({ 'https://a.example': 'offline' }, []));
    expect(result.current[0].blockedReason).toMatch(/do not hold/);
  });

  it("re-seats onto nagg's order without a frame of the old one", () => {
    mockProviders = {
      'https://third.example': provider({ name: 'Third' }),
      'https://first.example': provider({ name: 'First' }),
      'https://second.example': provider({ name: 'Second', e2ee: true }),
    };
    const seen: string[][] = [];
    const { rerender } = renderHook(
      ({ directory }: { directory: ServerProvider[] }) => {
        const result = useProviderRows({}, directory);
        seen.push(result.map((row) => row.name));
        return result;
      },
      { initialProps: { directory: [] as ServerProvider[] } }
    );
    // Local ranking first: encryption leads, then alphabetical.
    expect(seen.at(-1)).toEqual(['Second', 'First', 'Third']);

    seen.length = 0;
    rerender({
      directory: [
        served('https://first.example'),
        served('https://second.example'),
        served('https://third.example'),
      ],
    });
    // Every value this pass produced is ALREADY the server's order. The
    // re-seat used to run in an effect, which committed one frame pairing the
    // new directory with the old order — the visible shuffle the list was
    // reported for.
    expect(seen).not.toHaveLength(0);
    for (const order of seen) expect(order).toEqual(['First', 'Second', 'Third']);
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
