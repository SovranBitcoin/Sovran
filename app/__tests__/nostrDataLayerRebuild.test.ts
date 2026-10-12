/**
 * @jest-environment node
 *
 * What a rebuilt or disposed Nostr data layer leaves behind: no listener on
 * the old profile cache, and no snapshot of one account written into the
 * profile mirror once it belongs to another.
 */
import type { facade } from 'nostr';

import { accountHolders } from '@/shared/lib/account/accountRegistry';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { peekNostrDataLayer } from '@/shared/lib/nostr/dataLayerRegistry';

const ACCOUNT_A = 'a'.repeat(64);
const ACCOUNT_B = 'b'.repeat(64);
const CONTACT = 'c'.repeat(64);

let mockPubkey: string | undefined = ACCOUNT_A;
let mockRelayTier = true;
const mockPersistOwnerSnapshot = jest.fn();

jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/shared/lib/nostr/nostrTierConfig', () => ({
  getNostrTierConfig: () => ({
    nagg: { enabled: true, appViewBaseUrl: 'https://nagg.invalid' },
    primal: { enabled: false, urls: [] },
    relay: { enabled: mockRelayTier, relays: ['wss://relay.invalid'] },
  }),
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({ getActiveProfile: () => (mockPubkey ? { pubkey: mockPubkey } : null) }),
  },
}));
jest.mock('@/shared/stores/global/nostrMetadataCache', () => ({
  cachedProfileToMetadata: (record: facade.CachedProfile) => ({ name: record.name }),
  useNostrMetadataCache: {
    getState: () => ({ byPubkey: {}, persistOwnerSnapshot: mockPersistOwnerSnapshot }),
  },
}));

const holder = () => {
  const found = accountHolders.find((entry) => entry.name === 'nostr.data-layer');
  if (!found) throw new Error('The data layer is not registered with the account registry');
  return found;
};

function seeContact(layer: facade.NostrDataLayer | null, name: string): void {
  if (!layer) throw new Error('No layer was built');
  layer.cache.ingestProfileMetadata({ [CONTACT]: { name } }, 1, 'cache');
}

beforeEach(async () => {
  jest.useFakeTimers();
  await holder().dispose();
  mockPubkey = ACCOUNT_A;
  mockRelayTier = true;
  mockPersistOwnerSnapshot.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

it('drops the old account’s pending snapshot when a rebuild finds another account', () => {
  const old = buildNostrDataLayer();
  seeContact(old, 'Seen by A');

  mockPubkey = ACCOUNT_B;
  const next = buildNostrDataLayer();
  expect(next).not.toBe(old);
  expect(mockPersistOwnerSnapshot).not.toHaveBeenCalled();
  expect(old?.cache.profiles.get(CONTACT)).toBeUndefined();

  // Nothing of the old layer is still scheduled, and it no longer listens.
  seeContact(old, 'Late write to the old layer');
  jest.advanceTimersByTime(60_000);
  expect(mockPersistOwnerSnapshot).not.toHaveBeenCalled();
});

it('writes nothing when its timer fires after the account changed and nothing rebuilt it', () => {
  // A layer built again between the switch's dispose and its account flip.
  const layer = buildNostrDataLayer();
  seeContact(layer, 'Seen by A');

  mockPubkey = ACCOUNT_B;
  jest.advanceTimersByTime(60_000);
  expect(mockPersistOwnerSnapshot).not.toHaveBeenCalled();
});

it('saves the pending snapshot when only the tiers change', () => {
  const old = buildNostrDataLayer();
  seeContact(old, 'Seen by A');

  mockRelayTier = false;
  expect(buildNostrDataLayer()).not.toBe(old);
  expect(mockPersistOwnerSnapshot).toHaveBeenCalledTimes(1);
  expect(mockPersistOwnerSnapshot).toHaveBeenCalledWith({ [CONTACT]: { name: 'Seen by A' } });

  seeContact(old, 'Late write to the old layer');
  jest.advanceTimersByTime(60_000);
  expect(mockPersistOwnerSnapshot).toHaveBeenCalledTimes(1);
});

it('is emptied by the account switch while the old account still owns storage', async () => {
  const old = buildNostrDataLayer();
  seeContact(old, 'Seen by A');
  expect(holder().inspect?.()).toBe(false);

  await holder().dispose();
  expect(mockPersistOwnerSnapshot).toHaveBeenCalledTimes(1);
  expect(mockPersistOwnerSnapshot).toHaveBeenCalledWith({ [CONTACT]: { name: 'Seen by A' } });
  expect(holder().inspect?.()).toBe(true);
  expect(peekNostrDataLayer()).toBeNull();
  expect(old?.cache.profiles.get(CONTACT)).toBeUndefined();

  mockPubkey = ACCOUNT_B;
  seeContact(old, 'Late write to the old layer');
  jest.advanceTimersByTime(60_000);
  expect(mockPersistOwnerSnapshot).toHaveBeenCalledTimes(1);
  expect(buildNostrDataLayer()).not.toBe(old);
  expect(mockPersistOwnerSnapshot).toHaveBeenCalledTimes(1);
});
