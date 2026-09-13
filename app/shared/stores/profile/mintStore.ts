import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { storeLog } from '@/shared/lib/logger';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

export type Bip321RailId = 'onchain' | 'bolt12' | 'creq';
export type Bip321ExcludedRails = Partial<Record<Bip321RailId, boolean>>;

const profileStorage = createProfileScopedStorage();

/** The wallet's active mint unit — NOT the fiat display currency
 *  (settingsStore.displayCurrency); this is the unit ecash is denominated
 *  in (coco v2 multi-unit balances/quotes/proofs are per mint+unit). */
export type ActiveUnit = 'sat' | 'usd' | 'eur' | 'gbp';

interface MintState {
  selectedMint: string | undefined;
  activeUnit: ActiveUnit;
  /** Standing reusable-quote identity per `${mintUrl}|${method}|${unit}` —
   *  pins the receive-hub Bolt12/Onchain tabs to ONE quote so fixed-amount
   *  requests (also reusable quotes) can never displace the standing QR. */
  standingQuotes: Record<string, string>;
  /** Per-method "Receiving with" mint for the receive-hub tabs (bolt12 /
   *  onchain), mirroring npcMintStore's role for the Lightning/npub.cash
   *  tab. Unset methods fall back to the hub's current mint. */
  receiveMintByMethod: Record<string, string>;
  /** Cashu rail: advertise a NUT-10 P2PK lock in the standing payment
   *  request so payers lock ecash to this wallet's key. */
  creqP2pkLock: boolean;
  creqMintsPreferred: boolean;
  /** Cashu rail: mints the user toggled OFF in the payment request's
   *  Advanced section (url → true). Advertisement-only — the mint stays
   *  trusted, so payments sent to an old copy of the request still claim. */
  creqExcludedMints: Record<string, boolean>;
  /** Unified URI advertisement preferences, scoped to this profile. */
  bip321ExcludedRails: Bip321ExcludedRails;
}

interface MintActions {
  setSelectedMint: (mintUrl: string) => void;
  setActiveUnit: (unit: ActiveUnit) => void;
  setStandingQuote: (key: string, quoteId: string) => void;
  setReceiveMintForMethod: (method: 'bolt12' | 'onchain', mintUrl: string) => void;
  setCreqP2pkLock: (enabled: boolean) => void;
  setCreqMintsPreferred: (enabled: boolean) => void;
  setCreqMintExcluded: (mintUrl: string, excluded: boolean) => void;
  setBip321RailExcluded: (rail: Bip321RailId, excluded: boolean) => void;
  resetBip321RailExclusions: (rails: Bip321RailId[]) => void;
}

type MintStore = MintState & MintActions;

type V1Persisted = { selectedMints?: Record<string, string | undefined> };
type V2Persisted = { selectedMint?: string };

const PersistedMintStore = z.object({
  selectedMint: z.string().max(2048).optional(),
  // Additive tolerant field (no version bump needed): old blobs rehydrate to
  // 'sat'; an unknown persisted value degrades to 'sat' instead of wiping the
  // store (sovran-data persisted-schema invariant).
  activeUnit: z.enum(['sat', 'usd', 'eur', 'gbp']).default('sat').catch('sat'),
  // Additive tolerant field: a corrupt map degrades to {} (new standing
  // quotes get created and re-recorded) instead of wiping the store.
  standingQuotes: z.record(z.string(), z.string().max(256)).default({}).catch({}),
  receiveMintByMethod: z.record(z.string(), z.string().max(2048)).default({}).catch({}),
  // Additive tolerant field: corrupt value degrades to false (lock off).
  creqP2pkLock: z.boolean().default(false).catch(false),
  creqMintsPreferred: z.boolean().default(false).catch(false),
  // Additive tolerant field: a corrupt map degrades to {} (all mints
  // advertised again) instead of wiping the store.
  creqExcludedMints: z.record(z.string().max(2048), z.boolean()).default({}).catch({}),
  // Zod 4 enum-keyed records are exhaustive: partialRecord preserves sparse
  // exclusions such as { bolt12: true }. Invalid maps reset only this field.
  bip321ExcludedRails: z
    .partialRecord(z.enum(['onchain', 'bolt12', 'creq']), z.boolean())
    .default({})
    .catch({}),
});

// v1 -> v2: the storage seam (createProfileScopedStorage) already partitions
// by profile pubkey, so the inner `selectedMints` record held at most one
// meaningful entry per profile. Collapse to a scalar.
function v1ToV2(state: unknown): V2Persisted {
  if (!state || typeof state !== 'object' || !('selectedMints' in state)) {
    return { selectedMint: undefined };
  }
  const map = (state as V1Persisted).selectedMints;
  const first = map
    ? Object.values(map).find((v): v is string => typeof v === 'string' && v.length > 0)
    : undefined;
  return { selectedMint: first };
}

// Append-only migration chain. Each guard fires when the persisted blob is
// older than the step it gates. Zustand only calls migrate on a version
// mismatch, so an "already current" branch would be unreachable.
function migrateMintStore(state: unknown, version: number): V2Persisted {
  let s: unknown = state;
  if (version < 2) s = v1ToV2(s);
  return s as V2Persisted;
}

export const useMintStore = create<MintStore>()(
  persist(
    (set) => ({
      selectedMint: undefined,
      activeUnit: 'sat',
      standingQuotes: {},
      receiveMintByMethod: {},
      creqP2pkLock: false,
      creqMintsPreferred: false,
      creqExcludedMints: {},
      bip321ExcludedRails: {},

      setSelectedMint: (mintUrl: string) => {
        storeLog.info('store.mint.set_selected', { mintUrl });
        set({ selectedMint: mintUrl });
      },

      setActiveUnit: (unit: ActiveUnit) => {
        set((state) => {
          storeLog.info('store.mint.set_active_unit', { from: state.activeUnit, to: unit });
          return { activeUnit: unit };
        });
      },

      setStandingQuote: (key: string, quoteId: string) => {
        storeLog.info('store.mint.set_standing_quote', { keyLength: key.length });
        set((state) => ({ standingQuotes: { ...state.standingQuotes, [key]: quoteId } }));
      },

      setCreqMintsPreferred: (enabled: boolean) => {
        storeLog.info('store.mint.set_creq_mints_preferred', { enabled });
        set({ creqMintsPreferred: enabled });
      },

      setCreqP2pkLock: (enabled: boolean) => {
        storeLog.info('store.mint.set_creq_p2pk_lock', { enabled });
        set({ creqP2pkLock: enabled });
      },

      setCreqMintExcluded: (mintUrl: string, excluded: boolean) => {
        storeLog.info('store.mint.set_creq_mint_excluded', {
          mintUrlLength: mintUrl.length,
          excluded,
        });
        set((state) => {
          const next = { ...state.creqExcludedMints };
          if (excluded) next[mintUrl] = true;
          else delete next[mintUrl];
          return { creqExcludedMints: next };
        });
      },

      setBip321RailExcluded: (rail, excluded) => {
        storeLog.info('store.mint.set_bip321_rail_excluded', { rail, excluded });
        set((state) => {
          const next = { ...state.bip321ExcludedRails };
          if (excluded) next[rail] = true;
          else delete next[rail];
          return { bip321ExcludedRails: next };
        });
      },

      resetBip321RailExclusions: (rails) => {
        storeLog.info('store.mint.bip321_exclusions_reset', { count: rails.length });
        set((state) => {
          const next = { ...state.bip321ExcludedRails };
          for (const rail of rails) delete next[rail];
          return { bip321ExcludedRails: next };
        });
      },

      setReceiveMintForMethod: (method: 'bolt12' | 'onchain', mintUrl: string) => {
        storeLog.info('store.mint.set_receive_mint_for_method', {
          method,
          mintUrlLength: mintUrl.length,
        });
        set((state) => ({
          receiveMintByMethod: { ...state.receiveMintByMethod, [method]: mintUrl },
        }));
      },
    }),
    persistConfig({
      name: 'mint-store',
      storage: profileStorage,
      schema: PersistedMintStore,
      version: 2,
      migrate: migrateMintStore,
      partialize: (state) => ({
        selectedMint: state.selectedMint,
        activeUnit: state.activeUnit,
        standingQuotes: state.standingQuotes,
        receiveMintByMethod: state.receiveMintByMethod,
        creqP2pkLock: state.creqP2pkLock,
        creqMintsPreferred: state.creqMintsPreferred,
        creqExcludedMints: state.creqExcludedMints,
        bip321ExcludedRails: state.bip321ExcludedRails,
      }),
    })
  )
);
