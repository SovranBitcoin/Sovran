/**
 * What became of the ecash that releases 0.0.1 to 0.0.40 stored themselves.
 *
 * `shared/lib/cashu/legacyEcashClaim` works through the old row one group at a
 * time and records each outcome here, so a finished group is never asked about
 * again and a group that cannot be finished is given up on after a fixed number
 * of attempts. The proofs themselves are never copied here: a record holds
 * amounts and hashes of proof secrets only.
 *
 * Global, because the row belongs to the installation. Each record names the
 * account its ecash is claimed into.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { persist, type StateStorage } from 'zustand/middleware';
import {
  LegacyGroupRecordSchema,
  LegacyQuoteRecordSchema,
  type LegacyEcashRecords,
  type LegacyGroupRecord,
  type LegacyQuoteRecord,
} from 'wallet';

import { redactError, storeLog } from '@/shared/lib/logger';
import { defineStore as create } from '@/shared/lib/persist/defineStore';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { tolerantRecord } from '@/shared/lib/persist/tolerant';

const UnitTallies = tolerantRecord(
  z.string().max(32),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
);

/** Left behind when the old row is removed, so support can tell that it happened. */
const RowRemoval = z.object({
  at: z.number().int().nonnegative(),
  groups: z.number().int().nonnegative(),
  /** Face value per unit. */
  claimed: UnitTallies,
  spent: UnitTallies,
  inWallet: UnitTallies,
});
type RowRemoval = z.infer<typeof RowRemoval>;

const PersistedLegacyEcash = z.object({
  groups: tolerantRecord(z.string().max(700), LegacyGroupRecordSchema),
  quotes: tolerantRecord(z.string().max(64), LegacyQuoteRecordSchema),
  rowRemoved: RowRemoval.nullable().default(null).catch(null),
});

interface LegacyEcashState extends LegacyEcashRecords {
  rowRemoved: RowRemoval | null;
  writeGroup: (id: string, record: LegacyGroupRecord) => void;
  writeQuote: (id: string, record: LegacyQuoteRecord) => void;
  /** The person declined to trust this mint. Its proofs stay in the old row. */
  leaveUnclaimed: (mintUrl: string, accountIndex: number) => void;
  markRowRemoved: (removal: RowRemoval) => void;
}

// The claim records "about to receive" before it asks the mint to swap, and
// has to know that record reached the disk. Zustand does not expose its saves,
// so the adapter keeps the latest one.
let latestSave: Promise<unknown> = Promise.resolve();
const storage: StateStorage = {
  getItem: (name) => AsyncStorage.getItem(name),
  removeItem: (name) => AsyncStorage.removeItem(name),
  setItem: (name, value) => {
    latestSave = AsyncStorage.setItem(name, value);
    // Zustand drops this promise. `legacyEcashRecordsSaved` is where a failed
    // save is noticed and acted on, so it is only logged here.
    return latestSave.catch((error: unknown) => {
      storeLog.error('store.legacy_ecash.save_failed', { error: redactError(error) });
    });
  },
};

/**
 * Resolves once the records as they are now are on disk, and rejects if they
 * are not. A save can fail, and it can also be held back or dropped without an
 * error (see `persist/preserveUnreadable`), so the disk is read back.
 */
export async function legacyEcashRecordsSaved(): Promise<void> {
  await latestSave;
  const { name, partialize } = useLegacyEcashStore.persist.getOptions();
  const saved = SavedBlob.safeParse(parseJson(name ? await AsyncStorage.getItem(name) : null));
  const current = JSON.stringify(partialize?.(useLegacyEcashStore.getState()));
  if (!saved.success || JSON.stringify(saved.data.state) !== current) {
    throw new Error('The old ecash records were not saved');
  }
}

const SavedBlob = z.object({ state: z.unknown() });
function parseJson(text: string | null): unknown {
  try {
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const useLegacyEcashStore = create<LegacyEcashState>({
  name: 'legacy-ecash-store',
  scope: 'global',
})(
  persist(
    (set) => ({
      groups: {},
      quotes: {},
      rowRemoved: null,
      writeGroup: (id, record) => set((state) => ({ groups: { ...state.groups, [id]: record } })),
      writeQuote: (id, record) => set((state) => ({ quotes: { ...state.quotes, [id]: record } })),
      leaveUnclaimed: (mintUrl, accountIndex) =>
        set((state) => ({
          groups: Object.fromEntries(
            Object.entries(state.groups).map(([id, record]) => [
              id,
              record.status === 'awaiting-trust' &&
              record.mintUrl === mintUrl &&
              record.accountIndex === accountIndex
                ? { ...record, status: 'left-unclaimed' as const, updatedAt: Date.now() }
                : record,
            ])
          ),
        })),
      markRowRemoved: (rowRemoved) => set({ rowRemoved }),
    }),
    persistConfig({
      name: 'legacy-ecash-store',
      storage,
      schema: PersistedLegacyEcash,
      logKey: 'legacy_ecash',
      partialize: (state) => ({
        groups: state.groups,
        quotes: state.quotes,
        rowRemoved: state.rowRemoved,
      }),
    })
  )
);

/** What the "trust this mint" prompt asks about. */
export interface LegacyClaimPrompt {
  mintUrl: string;
  amount: number;
  /** Null when the old app never recorded the keyset's unit. */
  unit: string | null;
}

/**
 * The first mint that holds unspent old ecash for this account and is not
 * trusted, or null. Groups of other units at the same mint are claimed by the
 * same act of trust and are left out of the amount.
 */
export function legacyClaimPrompt(
  groups: LegacyEcashRecords['groups'],
  accountIndex: number
): LegacyClaimPrompt | null {
  const waiting = Object.values(groups).filter(
    (record) => record.status === 'awaiting-trust' && record.accountIndex === accountIndex
  );
  const first = waiting[0];
  if (!first) return null;
  const amount = waiting
    .filter((record) => record.mintUrl === first.mintUrl && record.unit === first.unit)
    .reduce((total, record) => total + record.awaiting, 0);
  return { mintUrl: first.mintUrl, amount, unit: first.unit };
}
