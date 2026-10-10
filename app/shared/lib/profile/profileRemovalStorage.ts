import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { z } from 'zod';
import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import { unreadableKey } from '@/shared/lib/persist/preserveUnreadable';
import { withSkippedPersistWrites } from '@/shared/lib/persist/profileWriteBarrier';
import { sdkRecoveryVaultNames } from '@/shared/lib/routstr/sdk/driver';
import { NEARBY_PAYMENT_JOURNAL_KEY } from '@/features/nearPay/lib/nearbyPaymentStorage';
import { assertRoutstrStorageEmptyForRemoval } from '@/shared/lib/routstr/securePersistence';
import { prepareProfileSecureRemoval } from '@/shared/lib/nostr/secureStorage';
import { clearSecrets } from '@/features/nostrSigner/lib/bunkerSecrets';
import { WhitenoiseNamespace, whitenoisePrefix } from '@/features/whitenoise/storage/namespaces';
import { removePlaintextCaches } from '@/shared/lib/cache/createPubkeyScopedCache';
import '@/shared/lib/nostr/giftWrapCache';
import '@/shared/lib/nostr/nip04Cache';
import {
  useProfileStore,
  PROFILE_STORE_PERSIST_VERSION,
  type ProfileEntry,
} from '@/shared/stores/global/profileStore';
import type { RemovalPorts } from './removeProfile';
import {
  liveStores,
  declaredStores,
  persistedStoreKeys,
} from '@/shared/lib/account/accountRegistry';

const States = z.array(z.object({ state: z.string().max(32) })).max(64);
const CanonicalQuotes = z.array(
  z.object({
    state: z.string().max(32).nullable(),
    reusable: z.union([z.literal(0), z.literal(1)]),
    amountPaid: z.string().regex(/^(0|[1-9][0-9]{0,35})$/),
    amountIssued: z.string().regex(/^(0|[1-9][0-9]{0,35})$/),
  })
);
const TableNames = z.array(z.object({ name: z.string().max(128) })).max(128);
const PAYMENT_REQUESTS = 'coco_cashu_payment_request_receive_operations';
const PaymentRequests = z
  .array(
    z.object({
      state: z.string().max(32),
      singleUse: z.union([z.literal(0), z.literal(1)]),
    })
  )
  .max(64);
// The installed Coco v2 SQLite adapter's terminal states. Unknown tables/states refuse.
const terminalStates: Record<string, readonly string[]> = {
  coco_cashu_mint_quotes: ['ISSUED'],
  coco_cashu_canonical_mint_quotes: ['ISSUED'],
  coco_cashu_melt_quotes: ['PAID'],
  coco_cashu_send_operations: ['finalized', 'rolled_back'],
  coco_cashu_melt_operations: ['finalized', 'rolled_back'],
  coco_cashu_receive_operations: ['finalized', 'rolled_back'],
  coco_cashu_mint_operations: ['finalized', 'failed'],
  coco_cashu_payment_request_receive_operations: ['completed', 'cancelled'],
  coco_cashu_payment_request_receive_attempts: ['finalized', 'rejected'],
};
const knownTables = new Set([
  ...Object.keys(terminalStates),
  'coco_cashu_proofs',
  'coco_cashu_migrations',
  'coco_cashu_mints',
  'coco_cashu_keysets',
  'coco_cashu_counters',
  'coco_cashu_history',
  'coco_cashu_keypairs',
  'coco_cashu_auth_sessions',
]);
const walletName = (index: number) => (index === 0 ? 'coco.db' : `coco-${index}.db`);
const nostrName = (index: number) => (index === 0 ? 'nostr' : `nostr-${index}`);
const pathFor = (name: string) => `${FileSystem.documentDirectory}SQLite/${name}`;
const deletedWallets = new Set<string>();
const securePlans = new Map<string, () => Promise<void>>();
// A profile used after a partial removal must be re-inspected; it can hold new funds.
useProfileStore.subscribe((state) => {
  const active = state.profiles.find(
    (profile) => profile.accountIndex === state.activeAccountIndex
  );
  if (active) {
    securePlans.delete(active.pubkey);
    deletedWallets.delete(active.pubkey);
  }
});

async function inspectWallet(
  profile: ProfileEntry
): Promise<'empty' | 'balance' | 'pending' | 'unreadable'> {
  if (
    !Number.isSafeInteger(profile.accountIndex) ||
    profile.accountIndex < 0 ||
    !/^[0-9a-f]{64}$/.test(profile.pubkey)
  )
    return 'unreadable';
  if (persistRegistry.some((entry) => entry.capturedOwner === profile.pubkey)) return 'unreadable';
  const name = walletName(profile.accountIndex);
  const path = pathFor(name);
  for (const suffix of ['.pre-v2', '.pre-v2-wal', '.pre-v2-shm', '.pre-v2-journal']) {
    if ((await FileSystem.getInfoAsync(`${path}${suffix}`)).exists) return 'unreadable';
  }
  if (!(await FileSystem.getInfoAsync(path)).exists) {
    // Only an acknowledged deletion in this runtime can bypass reopening on retry.
    if (!deletedWallets.has(profile.pubkey)) return 'unreadable';
  } else {
    const db = await SQLite.openDatabaseAsync(name, { useNewConnection: true });
    try {
      await db.execAsync('PRAGMA query_only = ON; BEGIN;');
      const check = await db.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check');
      if (check?.quick_check !== 'ok') return 'unreadable';
      const tables = TableNames.parse(
        await db.getAllAsync(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
      );
      if (tables.some(({ name }) => !knownTables.has(name))) return 'unreadable';
      if (
        ![
          'coco_cashu_proofs',
          'coco_cashu_mint_quotes',
          'coco_cashu_canonical_mint_quotes',
          'coco_cashu_melt_quotes',
          'coco_cashu_send_operations',
          'coco_cashu_receive_operations',
          'coco_cashu_melt_operations',
          'coco_cashu_mint_operations',
        ].every((name) => tables.some((table) => table.name === name))
      )
        return 'unreadable';
      const proofs = States.parse(
        await db.getAllAsync('SELECT DISTINCT state FROM coco_cashu_proofs')
      );
      if (proofs.some(({ state }) => state !== 'spent')) return 'balance';
      // Reusable quotes can accrue new funds after an ISSUED observation. Offline state
      // cannot prove them settled; never delete their signing/accounting records.
      const quotes = CanonicalQuotes.parse(
        await db.getAllAsync(
          'SELECT state, reusable, amountPaid, amountIssued FROM coco_cashu_canonical_mint_quotes'
        )
      );
      for (const quote of quotes) {
        if (quote.reusable === 1 || quote.state !== 'ISSUED') return 'pending';
        if (BigInt(quote.amountPaid) > BigInt(quote.amountIssued)) return 'pending';
        if (quote.amountPaid !== quote.amountIssued) return 'unreadable';
      }
      for (const { name } of tables) {
        const terminal = terminalStates[name];
        if (!terminal) continue;
        if (name === PAYMENT_REQUESTS) {
          // Every profile has a standing request it can be paid through. It is
          // an address: the row holds request details, never proofs or a
          // payment. A payment the wallet has taken in is an attempt, and the
          // attempts table below still refuses on one that is not finished.
          // Counting the standing request itself as pending made removal
          // impossible for any profile that had ever been opened. A one-off
          // request is still waiting for a specific payment and still refuses.
          //
          // Not covered: a payment delivered over Nostr that the wallet has not
          // taken in yet has no attempt row. It can be fetched again with the
          // same key while relays keep it (ADR 0030).
          const requests = PaymentRequests.parse(
            await db.getAllAsync(`SELECT DISTINCT state, singleUse FROM ${PAYMENT_REQUESTS}`)
          );
          if (
            requests.some(
              ({ state, singleUse }) =>
                !terminal.includes(state) && !(state === 'active' && singleUse === 0)
            )
          )
            return 'pending';
          continue;
        }
        const states = States.parse(await db.getAllAsync(`SELECT DISTINCT state FROM ${name}`));
        if (states.some(({ state }) => !terminal.includes(state))) return 'pending';
      }
    } finally {
      // Close failure aborts preflight too. No migrations, manager, seed or network.
      await db.closeAsync();
    }
  }
  // Plaintext SDK records can also contain payment tokens or provider credentials.
  assertRoutstrStorageEmptyForRemoval(
    await AsyncStorage.getItem(`routstr-store:profile:${profile.pubkey}`)
  );
  const keys = await AsyncStorage.getAllKeys();
  for (const key of keys) {
    if (key.startsWith('routstr-sdk:') && key.endsWith(`:profile:${profile.pubkey}`)) {
      // Unknown SDK data is deliberately refused rather than classified from display copy.
      const raw = await AsyncStorage.getItem(key);
      if (raw !== null && !['null', '{}', '[]'].includes(raw)) return 'unreadable';
    }
  }
  if (!securePlans.has(profile.pubkey))
    securePlans.set(
      profile.pubkey,
      await prepareProfileSecureRemoval(profile.accountIndex, profile.pubkey, [
        ...persistedStoreKeys('profile'),
        ...sdkRecoveryVaultNames(),
        NEARBY_PAYMENT_JOURNAL_KEY,
      ])
    );
  return 'empty';
}

async function deleteFiles(name: string): Promise<void> {
  for (const suffix of [
    '-journal',
    '-wal',
    '-shm',
    '.pre-v2',
    '.pre-v2-wal',
    '.pre-v2-shm',
    '.pre-v2-journal',
    '',
  ]) {
    const path = `${pathFor(name)}${suffix}`;
    await FileSystem.deleteAsync(path, { idempotent: true });
    if ((await FileSystem.getInfoAsync(path)).exists)
      throw new Error('Account database deletion failed');
  }
}

/**
 * Delete the Nostr cache database of each account, by file. Used by delete-all:
 * the cache is still open then, and unlinking the file does not need it closed.
 */
export async function deleteNostrCaches(accountIndexes: readonly number[]): Promise<void> {
  for (const index of accountIndexes) await deleteFiles(nostrName(index));
}

export const profileRemovalPorts: RemovalPorts = {
  inventory: () => useProfileStore.getState(),
  inspect: inspectWallet,
  prepare: async (profile) => {
    const secure = securePlans.get(profile.pubkey);
    if (!secure) throw new Error('Account secure deletion plan is unavailable');
    const keys = await AsyncStorage.getAllKeys();
    const prefixes = Object.values(WhitenoiseNamespace).map(
      (ns) => `${whitenoisePrefix(profile.accountIndex, ns)}:`
    );
    const scoped = persistedStoreKeys('profile').flatMap((name) => [
      `${name}:profile:${profile.pubkey}`,
      // A blob the store could not load, kept beside it.
      `${unreadableKey(name)}:profile:${profile.pubkey}`,
    ]);
    // Include retired query-cache blobs using registry metadata, even if never mounted.
    for (const entry of declaredStores) {
      if (entry.profileStorage && entry.queryCache)
        scoped.push(`${entry.name}:profile:${profile.pubkey}`);
    }
    const owned = keys.filter(
      (key) =>
        prefixes.some((prefix) => key.startsWith(prefix)) ||
        (key.startsWith('routstr-sdk:') && key.endsWith(`:profile:${profile.pubkey}`))
    );
    return [
      {
        name: 'profile storage and Whitenoise/Routstr state',
        run: async () => {
          for (const key of new Set([...scoped, ...owned])) await AsyncStorage.removeItem(key);
        },
      },
      {
        name: 'query and plaintext caches',
        run: async () => {
          withSkippedPersistWrites(() => {
            for (const entry of liveStores) entry.queryCache?.removeViewer(profile.pubkey);
          });
          await removePlaintextCaches(profile.pubkey);
        },
      },
      { name: 'Nostr database', run: () => deleteFiles(nostrName(profile.accountIndex)) },
      { name: 'account keys and payment recovery records', run: secure },
      {
        name: 'NIP-46 bunker secrets',
        run: async () => {
          const result = await clearSecrets(profile.pubkey);
          if (result.isErr()) throw new Error('Bunker secret deletion failed');
        },
      },
      {
        name: 'wallet database',
        run: async () => {
          await deleteFiles(walletName(profile.accountIndex));
          deletedWallets.add(profile.pubkey);
        },
      },
      {
        name: 'profile list',
        run: async () => {
          const options = useProfileStore.persist.getOptions();
          // Metadata updates during the awaited commit must not re-save the removed row.
          useProfileStore.persist.setOptions({
            storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
          });
          try {
            const state = useProfileStore.getState();
            const profiles = state.profiles.filter((entry) => entry.pubkey !== profile.pubkey);
            await AsyncStorage.setItem(
              'profile-store',
              JSON.stringify({
                state: { activeAccountIndex: state.activeAccountIndex, profiles },
                version: PROFILE_STORE_PERSIST_VERSION,
              })
            );
            useProfileStore.setState((current) => ({
              profiles: current.profiles.filter((entry) => entry.pubkey !== profile.pubkey),
            }));
          } finally {
            useProfileStore.persist.setOptions({ storage: options.storage });
          }
          securePlans.delete(profile.pubkey);
          deletedWallets.delete(profile.pubkey);
        },
      },
    ];
  },
};
