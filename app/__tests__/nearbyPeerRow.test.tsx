/**
 * @jest-environment node
 */

import TestRenderer, { act } from 'react-test-renderer';
import type { BLEPeer } from 'bitchat-module';

import { NearbyPeerRow } from '@/features/nearPay/components/NearbyPeerRow';
import { useRecentPeopleProfiles } from '@/features/feed/hooks/useRecentPeopleProfiles';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOSTR_HEX = 'ab'.repeat(32);
const OTHER_HEX = 'cd'.repeat(32);

type Metadata = { displayName?: string; picture?: string; fetchedAt: number };
let mockSingle: { metadata: Metadata | undefined; isResolving: boolean } = {
  metadata: undefined,
  isResolving: false,
};
let mockMany: { metadata: Map<string, Metadata>; isLoading: boolean } = {
  metadata: new Map(),
  isLoading: false,
};
const mockSingleCalls: (string | undefined)[] = [];
const mockContactRow = jest.fn((_props: Record<string, unknown>) => null);

jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadata: (pubkey: string | undefined) => {
    mockSingleCalls.push(pubkey);
    return { ...mockSingle, isLoading: false };
  },
  useNostrProfileMetadataMany: () => mockMany,
}));
jest.mock('@/shared/stores/profile/recentPeopleStore', () => ({
  normalizeRecentPersonPubkey: (pubkey: string) =>
    /^[0-9a-f]{64}$/i.test(pubkey) ? pubkey.toLowerCase() : null,
}));
jest.mock('@/shared/lib/nutCreq', () => ({ lockableMintsFromCreq: () => null }));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/shared/ui/composed/ContactRow', () => ({
  ContactRow: (props: Record<string, unknown>) => mockContactRow(props),
  bleIdentity: (peer: Record<string, unknown>) => ({ kind: 'ble', ...peer }),
  nostrIdentity: (pubkey: string, profile: unknown, opts: Record<string, unknown>) => ({
    kind: 'nostr',
    pubkey,
    profile,
    ...opts,
  }),
}));

function blePeer(overrides: Partial<BLEPeer> = {}): BLEPeer {
  return {
    peerID: 'deadbeefdeadbeef',
    nickname: 'mesh-nick',
    isConnected: true,
    hasDirectLink: true,
    lastSeen: 1,
    ...overrides,
  };
}

function renderedIdentity(peer: BLEPeer): unknown {
  act(() => {
    TestRenderer.create(<NearbyPeerRow peer={peer} testID="row" />);
  });
  return mockContactRow.mock.calls.at(-1)?.[0].identity;
}

describe('NearbyPeerRow', () => {
  beforeEach(() => {
    mockContactRow.mockClear();
    mockSingleCalls.length = 0;
    mockSingle = { metadata: undefined, isResolving: false };
  });

  // The Send screen's Nearby tier, the peer list and the network sheet each
  // passed only a seed and a nickname, so a peer with a known profile showed
  // a silhouette there and a face on the radar.
  it('shows the face of a peer that has handed us its Nostr identity', () => {
    mockSingle = {
      metadata: { displayName: 'Alice', picture: 'https://img.example/a.png', fetchedAt: 1 },
      isResolving: false,
    };

    expect(renderedIdentity(blePeer({ nostrPubkeyHex: NOSTR_HEX }))).toEqual([
      expect.objectContaining({ kind: 'ble', peerID: 'deadbeefdeadbeef', identitySeed: NOSTR_HEX }),
      expect.objectContaining({
        kind: 'nostr',
        pubkey: NOSTR_HEX,
        profile: expect.objectContaining({ picture: 'https://img.example/a.png' }),
      }),
    ]);
    expect(mockSingleCalls).toContain(NOSTR_HEX);
  });

  it('shows the known identity while the picture is still on its way', () => {
    mockSingle = { metadata: { displayName: 'Alice', fetchedAt: 0 }, isResolving: true };

    expect(renderedIdentity(blePeer({ nostrPubkeyHex: NOSTR_HEX }))).toEqual([
      expect.objectContaining({ kind: 'ble' }),
      expect.objectContaining({ kind: 'nostr', profile: { displayName: 'Alice', fetchedAt: 0 } }),
    ]);
  });

  it('keeps a peer that never exchanged identity as a plain mesh peer', () => {
    expect(renderedIdentity(blePeer({ noisePublicKeyHex: 'ee'.repeat(32) }))).toEqual(
      expect.objectContaining({ kind: 'ble', identitySeed: 'ee'.repeat(32) })
    );
    expect(mockSingleCalls).toEqual([undefined]);
  });
});

describe('useRecentPeopleProfiles', () => {
  function rowsFor(pubkeys: string[]) {
    let rows: ReturnType<typeof useRecentPeopleProfiles> = [];
    function Probe() {
      rows = useRecentPeopleProfiles(pubkeys);
      return null;
    }
    act(() => {
      TestRenderer.create(<Probe />);
    });
    return rows;
  }

  it('returns one row per distinct pubkey, in order, from the shared profile lookup', () => {
    mockMany = {
      metadata: new Map([[NOSTR_HEX, { picture: 'https://img.example/a.png', fetchedAt: 1 }]]),
      isLoading: true,
    };

    expect(rowsFor([NOSTR_HEX.toUpperCase(), 'not-a-key', OTHER_HEX, NOSTR_HEX])).toEqual([
      {
        pubkey: NOSTR_HEX,
        metadata: { picture: 'https://img.example/a.png', fetchedAt: 1 },
        isLoading: false,
      },
      // Still fetching and no picture yet: the row waits rather than falling back.
      { pubkey: OTHER_HEX, metadata: undefined, isLoading: true },
    ]);
  });

  it('settles a person with no picture once the lookup has finished', () => {
    mockMany = {
      metadata: new Map([[NOSTR_HEX, { displayName: 'Alice', fetchedAt: 1 }]]),
      isLoading: false,
    };

    expect(rowsFor([NOSTR_HEX])).toEqual([
      { pubkey: NOSTR_HEX, metadata: { displayName: 'Alice', fetchedAt: 1 }, isLoading: false },
    ]);
  });
});
