/**
 * @jest-environment node
 *
 * Audit D6 (payment-relevant): a Lightning address the person REMOVED from
 * their profile must not be payable from the cache.
 *
 * `ingestResolvedProfiles` stamped its write with `Date.now()` in milliseconds
 * as the merge order, about a thousand times any kind-0 `created_at`, so no
 * later fetch could replace it: for the rest of the session a newer profile
 * could only fill blanks, and Send read the old address through
 * `peekCachedLightningTarget`. The real entity cache and data layer run here.
 */
import { ok } from 'neverthrow';
import { facade } from 'nostr';

import { registerNostrDataLayer } from '@/shared/lib/nostr/dataLayerRegistry';
import {
  peekCachedLightningTarget,
  resolveProfileLightningTarget,
} from '@/shared/lib/nostr/profileLightningTarget';
import { ingestResolvedProfiles } from '@/shared/lib/nostr/useEntityCache';

let mockLayer: facade.NostrDataLayer;
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => mockLayer,
}));

const RECIPIENT = 'c'.repeat(64);
const T_OLD = 1_700_000_000;
const T_NEW = 1_700_086_400;

const kind0 = (content: Record<string, string>, createdAt: number) => ({
  id: createdAt.toString(16).padStart(64, '0'),
  pubkey: RECIPIENT,
  kind: 0,
  created_at: createdAt,
  content: JSON.stringify(content),
});

function layerWhereRelaysHold(event: ReturnType<typeof kind0>) {
  mockLayer = facade.createNostrDataLayer({
    tiers: [facade.relay.createRelayTier({ connection: { request: async () => ok([event]) } })],
    profileBatchWindowMs: 0,
  });
  registerNostrDataLayer(mockLayer);
  return mockLayer;
}

afterEach(() => registerNostrDataLayer(null));

describe('a removed Lightning address is not paid from the cache', () => {
  it('a profile resolved on Send is replaced by a later fetch of the newer kind-0 that removed lud16', async () => {
    const layer = layerWhereRelaysHold(kind0({ name: 'carol' }, T_NEW));
    // What recipient resolution wrote earlier in the session.
    ingestResolvedProfiles(
      { [RECIPIENT]: { name: 'carol', lud16: 'carol@old.example' } },
      { [RECIPIENT]: T_OLD }
    );
    expect(peekCachedLightningTarget(RECIPIENT)).toBe('carol@old.example');

    await layer.loadProfiles([RECIPIENT]);

    expect(peekCachedLightningTarget(RECIPIENT)).toBeNull();
    expect(await resolveProfileLightningTarget(RECIPIENT, null)).toBeNull();
    expect(layer.cache.getProfile(RECIPIENT)?.seenAt).toBe(T_NEW);
  });

  it('the newer kind-0 that removed lud16, resolved on Send, replaces what an earlier fetch cached', async () => {
    const layer = layerWhereRelaysHold(kind0({ name: 'carol', lud16: 'carol@old.example' }, T_OLD));
    await layer.loadProfiles([RECIPIENT]);
    expect(peekCachedLightningTarget(RECIPIENT)).toBe('carol@old.example');

    ingestResolvedProfiles({ [RECIPIENT]: { name: 'carol' } }, { [RECIPIENT]: T_NEW });

    expect(peekCachedLightningTarget(RECIPIENT)).toBeNull();
  });

  it('an older copy fetched afterwards does not bring the removed address back', async () => {
    const layer = layerWhereRelaysHold(kind0({ name: 'carol', lud16: 'carol@old.example' }, T_OLD));
    ingestResolvedProfiles({ [RECIPIENT]: { name: 'carol' } }, { [RECIPIENT]: T_NEW });

    await layer.loadProfiles([RECIPIENT]);

    expect(peekCachedLightningTarget(RECIPIENT)).toBeNull();
  });

  it('an address the person CHANGED is the one read', async () => {
    const layer = layerWhereRelaysHold(kind0({ lud16: 'carol@new.example' }, T_NEW));
    ingestResolvedProfiles({ [RECIPIENT]: { lud16: 'carol@old.example' } }, { [RECIPIENT]: T_OLD });
    await layer.loadProfiles([RECIPIENT]);
    expect(peekCachedLightningTarget(RECIPIENT)).toBe('carol@new.example');
  });

  it('a write with no event time yields to any real kind-0 and does not count as a fetch', () => {
    const layer = layerWhereRelaysHold(kind0({}, T_NEW));
    // The app-view own-profile refresh: name and picture, no timestamp.
    ingestResolvedProfiles({ [RECIPIENT]: { name: 'from app view', lud16: 'x@appview.example' } });
    // Still owed a real fetch: not stamped as fetched.
    expect(layer.ensureProfiles([RECIPIENT])).toEqual([RECIPIENT]);
    layer.cache.ingestProfileMetadata({ [RECIPIENT]: { name: 'carol' } }, 1, 'relay', {
      createdAt: { [RECIPIENT]: T_OLD },
    });
    expect(layer.cache.getProfile(RECIPIENT)?.name).toBe('carol');
    expect(peekCachedLightningTarget(RECIPIENT)).toBeNull();
  });
});
