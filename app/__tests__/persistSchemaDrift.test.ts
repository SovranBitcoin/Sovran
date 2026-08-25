/* eslint-disable import/first */

// Persisted-schema drift guard. Importing a store registers its {name, version,
// schema} via persistConfig; this test snapshots each schema's JSON shape keyed
// by version. When a store's persisted schema changes:
//   - additive change  → update the snapshot (`jest -u`), done.
//   - non-additive change (rename/remove/tighten a field) → the diff is your
//     prompt to bump `version` + add a `migrate`, or you silently drop the
//     durable blob on next launch (createMergeWithSchema rejects → defaults).

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
// Native/ESM deps pulled in transitively by the completeness-backfill store
// imports; only the schemas matter here.
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({ normalizeRelayUrl: (url: string) => url }), {
  virtual: true,
});

import { z } from 'zod';

// Import the durable / data-loss-critical stores so they self-register. These
// hold data that is NOT cheaply refetchable, so a silent schema-drift drop is
// real user-data loss.
import '@/shared/stores/profile/transactionAnnotationStore';
import '@/shared/stores/profile/ownedMediaStore';
import '@/shared/stores/profile/nostrSocialStore';
import '@/shared/stores/profile/dataMigrationStore';
import '@/shared/stores/global/mintMetadataStore';
import '@/shared/stores/global/relayMetadataStore';
import '@/shared/stores/profile/mintStore';
// AI chat: apiKey + sessions (now incl. message attachments) + the
// last-known model lineup — none cheaply refetchable.
import '@/shared/stores/profile/routstrStore';
import '@/shared/stores/global/profileStore';
import '@/shared/stores/global/walletLifecycleStore';
import '@/shared/stores/profile/mintDistributionStore';
import '@/shared/stores/profile/npcMintStore';
import '@/shared/stores/profile/nutDropRedeemQueueStore';
import '@/shared/stores/profile/ownContentStore';
import '@/shared/stores/profile/searchHistoryStore';
import '@/shared/stores/profile/sendReachabilityStore';
import '@/shared/stores/profile/swapTransactionsStore';
import '@/shared/stores/profile/transactionDistributionStore';
import '@/shared/stores/profile/transactionLocationStore';
// Completeness backfill (2026-08-26): the hand-curated list above had silently
// decayed — every remaining persistConfig call site is imported so the
// completeness assertion below can hold the registry to the source tree.
import '@/features/bitchat/stores/bitchatDmMessages';
import '@/features/feed/stores/ignoreStore';
import '@/features/feed/stores/notificationPolicyStore';
import '@/features/nostrSigner/data/nip46ActivityStore';
import '@/features/nostrSigner/data/nip46ConnectionsStore';
import '@/shared/lib/nostr/media/mediaServerStore';
import '@/shared/lib/nostr/outbox/relayListStore';
import '@/shared/stores/global/btcMapStore';
import '@/shared/stores/global/mempoolAddressCache';
import '@/shared/stores/global/nostrMetadataCache';
import '@/shared/stores/global/pricelistStore';
import '@/shared/stores/global/settingsStore';
import '@/shared/stores/global/wallpaperStore';
import '@/shared/stores/profile/recentPeopleStore';
import '@/shared/stores/profile/scanHistoryStore';
import '@/shared/stores/profile/themeStore';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { persistRegistry } from '@/shared/lib/persist/persistConfig';

// Files that call persistConfig but deliberately do NOT register here.
// Every entry needs a reason — this is the visible exception list the
// completeness assertion enforces instead of a silently decaying import list.
const COMPLETENESS_EXCLUSIONS: Record<string, string> = {
  'shared/lib/persist/persistConfig.ts': 'the factory itself, not a store',
  'shared/lib/cache/createQueryCacheStore.ts':
    'cache-store factory with dynamic per-instance names; cache data is cheaply refetchable, outside the durable-data scope here',
};

/** Every file that calls persistConfig (plain or generic call). */
function persistConfigCallSites(root: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.') || entry === '__tests__') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\./.test(entry)) continue;
      if (/persistConfig\s*[<(]/.test(readFileSync(full, 'utf8'))) {
        hits.push(full.slice(root.length + 1));
      }
    }
  };
  for (const dir of ['shared', 'features', 'app']) walk(join(root, dir));
  return hits.sort();
}

describe('persisted schema drift', () => {
  it('registered at least the durable stores under test', () => {
    expect(persistRegistry.length).toBeGreaterThanOrEqual(18);
  });

  it('covers every persistConfig call site in the source tree (completeness)', () => {
    const files = persistConfigCallSites(process.cwd());
    const uncovered: string[] = [];
    for (const file of files) {
      if (COMPLETENESS_EXCLUSIONS[file]) continue;
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      // Store names declared near a persistConfig call. A file may declare
      // several; each must be registered (i.e. imported above).
      const names = [
        ...source.matchAll(
          /persistConfig\s*(?:<[^>]*>)?\s*\(\s*\{[\s\S]{0,400}?name:\s*'([^']+)'/g
        ),
      ].map((m) => m[1]);
      if (names.length === 0) {
        uncovered.push(`${file} (persistConfig call found but no name extracted)`);
        continue;
      }
      for (const name of names) {
        if (!persistRegistry.some((entry) => entry.name === name)) {
          uncovered.push(`${file} → '${name}' not registered (add its import above)`);
        }
      }
    }
    expect(uncovered).toEqual([]);
  });

  it.each(
    [...persistRegistry]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => [e.name, e] as const)
  )('%s schema matches the golden snapshot for its version', (_name, entry) => {
    const shape = z.toJSONSchema(entry.schema, { unrepresentable: 'any' });
    expect({ name: entry.name, version: entry.version, shape }).toMatchSnapshot(entry.name);
  });
});
