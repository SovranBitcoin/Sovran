/**
 * @jest-environment node
 *
 * "Search all mints" in recovery: the NUT-27 backup's mints come first, then
 * the directory's audited mints, de-duplicated; the seed copy is always
 * zeroed; offline relays, no backup or no seed leave just the audited list;
 * and an abort settles with nothing.
 */
import { mnemonicToSeedSync } from '@scure/bip39';
import { ok } from 'neverthrow';

import type { DiscoverMint, discoverMints } from '@/shared/lib/apiClient';
import {
  discoverRecoveryMintUrls,
  relayEventsReader,
} from '@/features/settings/lib/recoveryDiscovery';
import {
  deriveMintBackupKeys,
  encodeMintBackupEvent,
  mintBackupFilter,
} from '@/shared/lib/cashu/nut27MintBackup';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = () => mnemonicToSeedSync(MNEMONIC);

const audited = (urls: string[]) =>
  jest.fn<ReturnType<typeof discoverMints>, Parameters<typeof discoverMints>>(async () =>
    ok({
      mints: urls.map((mintUrl): DiscoverMint => ({
        mintUrl,
        averageScore: null,
        reviewCount: 0,
        hasAudit: true,
        state: 'OK',
      })),
    })
  );

const backupEvent = (mints: string[]) =>
  encodeMintBackupEvent(deriveMintBackupKeys(seed()), { mints }, { createdAt: 10 });

describe('discoverRecoveryMintUrls', () => {
  it('puts backed-up mints ahead of audited ones, without duplicates or known mints', async () => {
    const copy = seed();
    const urls = await discoverRecoveryMintUrls({
      knownUrls: ['https://known.example'],
      fetchMints: audited([
        'https://audited.example',
        'https://BOTH.example/',
        'https://known.example',
      ]),
      backup: {
        readSeed: async () => copy,
        fetchEvents: async () => [backupEvent(['https://mine.example', 'https://both.example'])],
      },
    });
    expect(urls).toEqual([
      'https://mine.example',
      'https://both.example',
      'https://audited.example',
    ]);
    expect(copy.every((byte) => byte === 0)).toBe(true);
  });

  it('zeroes the seed copy when the relay read throws', async () => {
    const copy = seed();
    const urls = await discoverRecoveryMintUrls({
      knownUrls: [],
      fetchMints: audited(['https://audited.example']),
      backup: {
        readSeed: async () => copy,
        fetchEvents: async () => {
          throw new Error('offline');
        },
      },
    });
    expect(urls).toEqual(['https://audited.example']);
    expect(copy.every((byte) => byte === 0)).toBe(true);
  });

  it('falls back to the audited list with no seed, no backup, or a failing seed read', async () => {
    const fetchMints = audited(['https://audited.example']);
    for (const backup of [
      undefined,
      { readSeed: async () => null, fetchEvents: async () => [] },
      { readSeed: async () => seed(), fetchEvents: async () => [] },
      {
        readSeed: async (): Promise<Uint8Array> => {
          throw new Error('locked');
        },
        fetchEvents: async () => [],
      },
    ]) {
      await expect(
        discoverRecoveryMintUrls({ knownUrls: [], fetchMints, backup })
      ).resolves.toEqual(['https://audited.example']);
    }
  });

  it('returns nothing once aborted, and still zeroes the seed', async () => {
    const controller = new AbortController();
    const copy = seed();
    const urls = discoverRecoveryMintUrls({
      knownUrls: [],
      fetchMints: audited(['https://audited.example']),
      backup: {
        readSeed: async () => {
          controller.abort();
          return copy;
        },
        fetchEvents: async () => [backupEvent(['https://mine.example'])],
      },
      signal: controller.signal,
    });
    await expect(urls).resolves.toEqual([]);
    expect(copy.every((byte) => byte === 0)).toBe(true);
  });
});

describe('relayEventsReader', () => {
  const filter = mintBackupFilter('ab'.repeat(32));

  it('reads every configured relay and merges what answered', async () => {
    const queryRelay = jest.fn(async (url: string) => {
      if (url === 'wss://down.example') throw new Error('down');
      return { events: [{ id: url }] };
    });
    const read = relayEventsReader({
      relayUrls: () => ['wss://a.example', 'wss://down.example', 'wss://b.example'],
      queryRelay,
    });
    await expect(read(filter)).resolves.toEqual([
      { id: 'wss://a.example' },
      { id: 'wss://b.example' },
    ]);
    expect(queryRelay).toHaveBeenCalledWith('wss://a.example', [filter], expect.any(Number));
  });

  it('settles with nothing as soon as it is aborted', async () => {
    const controller = new AbortController();
    const read = relayEventsReader({
      relayUrls: () => ['wss://slow.example'],
      queryRelay: () => new Promise(() => {}),
    });
    const pending = read(filter, controller.signal);
    controller.abort();
    await expect(pending).resolves.toEqual([]);
  });
});
