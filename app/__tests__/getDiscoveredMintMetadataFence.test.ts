/* eslint-disable import/first */
/**
 * A discovery answer is written into the saved mint rows only once those
 * stores have loaded, and never after Delete All ran while it was on its way.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({ buildNostrDataLayer: () => null }));
jest.mock('@/shared/lib/apiClient', () => ({ discoverMint: jest.fn() }));

import { ok } from 'neverthrow';

import { fenceDataReset } from '@/shared/lib/account/dataResetFence';
import { discoverMint } from '@/shared/lib/apiClient';
import { getDiscoveredMintMetadata } from '@/shared/lib/getDiscoveredMintMetadata';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { useMintTestnutStore } from '@/shared/stores/global/mintTestnutStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

const MINT = 'https://mint.example.com';
const row = { mintUrl: MINT, name: 'Example', state: 'OK', nMints: 3, nMelts: 1, nErrors: 0 };

beforeEach(async () => {
  jest.clearAllMocks();
  await Promise.all([
    useSettingsStore.persist.rehydrate(),
    useMintMetadataStore.persist.rehydrate(),
    useMintTestnutStore.persist.rehydrate(),
  ]);
  useMintMetadataStore.setState({ byMintUrl: {} });
});

it('writes a discovery answer once the stores have loaded', async () => {
  jest.mocked(discoverMint).mockResolvedValue(ok(row) as never);
  await expect(getDiscoveredMintMetadata(MINT)).resolves.toMatchObject({ displayName: 'Example' });
  expect(useMintMetadataStore.getState().getCached(MINT)).toMatchObject({ nMints: 3 });
});

it('drops a discovery answer that lands after Delete All', async () => {
  jest.mocked(discoverMint).mockImplementation(async () => {
    // Delete All runs while the request is on its way.
    fenceDataReset();
    return ok(row) as never;
  });
  await getDiscoveredMintMetadata(MINT);
  expect(useMintMetadataStore.getState().getCached(MINT)).toBeUndefined();
  expect(useMintTestnutStore.getState().byMintUrl).toEqual({});
});
