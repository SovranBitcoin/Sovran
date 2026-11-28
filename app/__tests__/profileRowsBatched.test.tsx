/**
 * @jest-environment node
 *
 * A cold list of fifty rows, each showing one person (audit D1). The real
 * hook, data layer and entity cache run over a Primal connection and a relay
 * connection that count what they are asked.
 */
import { act, renderHook } from '@testing-library/react-native';
import { ok } from 'neverthrow';
import { facade } from 'nostr';

import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';

let mockLayer: facade.NostrDataLayer;
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => mockLayer,
}));

const PUBKEYS = Array.from({ length: 50 }, (_, index) => index.toString(16).padStart(64, '0'));

const kind0 = (pubkey: string, name: string, createdAt = 1_700_000_000) => ({
  id: `${pubkey.slice(2)}ee`,
  pubkey,
  kind: 0,
  created_at: createdAt,
  content: JSON.stringify({ name }),
});

function countingLayer() {
  const primal: string[][] = [];
  const relay: string[][] = [];
  mockLayer = facade.createNostrDataLayer({
    tiers: [
      facade.primal.createPrimalTier({
        connection: {
          request: async (request) => {
            const asked = (request.params as { pubkeys: string[] }).pubkeys;
            primal.push(asked);
            return ok(asked.map((pubkey) => kind0(pubkey, `n-${pubkey.slice(-2)}`)));
          },
        },
      }),
      facade.relay.createRelayTier({
        connection: {
          request: async (filters) => {
            const asked = filters[0]?.authors ?? [];
            relay.push(asked);
            return ok(asked.map((pubkey) => kind0(pubkey, `n-${pubkey.slice(-2)}`)));
          },
        },
      }),
    ],
  });
  return { primal, relay };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it('fifty rows mounting together make one request per source, and each row renders its own name', async () => {
  const { primal, relay } = countingLayer();
  const renders = new Map<string, number>();
  const rows = PUBKEYS.map((pubkey) =>
    renderHook(() => {
      renders.set(pubkey, (renders.get(pubkey) ?? 0) + 1);
      return useNostrProfileMetadata(pubkey);
    })
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(16);
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(primal).toHaveLength(1);
  expect(relay).toHaveLength(1);
  expect(primal[0]).toHaveLength(50);
  rows.forEach((row, index) => {
    expect(row.result.current.metadata?.name).toBe(`n-${PUBKEYS[index]!.slice(-2)}`);
    expect(row.result.current.isResolving).toBe(false);
  });
  // Mount, then the profile arriving: no render for the fetch starting, and
  // none for the second source repeating the same event.
  for (const pubkey of PUBKEYS) expect(renders.get(pubkey)).toBeLessThanOrEqual(3);
});

it('a profile that changes re-renders its own row and no other', async () => {
  countingLayer();
  const renders = new Map<string, number>();
  const rows = PUBKEYS.slice(0, 5).map((pubkey) =>
    renderHook(() => {
      renders.set(pubkey, (renders.get(pubkey) ?? 0) + 1);
      return useNostrProfileMetadata(pubkey);
    })
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(16);
    await jest.advanceTimersByTimeAsync(0);
  });
  const before = new Map(renders);
  const identities = rows.map((row) => row.result.current.metadata);
  act(() => {
    mockLayer.cache.ingestProfileMetadata({ [PUBKEYS[2]!]: { name: 'renamed' } }, 1, 'relay', {
      createdAt: { [PUBKEYS[2]!]: 1_700_000_999 },
    });
  });
  expect(rows[2]!.result.current.metadata?.name).toBe('renamed');
  for (const [index, pubkey] of PUBKEYS.slice(0, 5).entries()) {
    if (index === 2) continue;
    expect(renders.get(pubkey)).toBe(before.get(pubkey));
    expect(rows[index]!.result.current.metadata).toBe(identities[index]);
  }
});

it('the same answer arriving again changes nothing a row can see', async () => {
  countingLayer();
  const pubkey = PUBKEYS[0]!;
  let renders = 0;
  const row = renderHook(() => {
    renders += 1;
    return useNostrProfileMetadata(pubkey);
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(16);
    await jest.advanceTimersByTimeAsync(0);
  });
  const settled = renders;
  const metadata = row.result.current.metadata;
  await act(async () => {
    void mockLayer.loadProfiles([pubkey]);
    await jest.advanceTimersByTimeAsync(16);
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(row.result.current.metadata).toBe(metadata);
  expect(renders).toBe(settled);
});
