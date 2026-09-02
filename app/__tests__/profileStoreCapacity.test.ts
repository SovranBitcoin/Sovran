/**
 * @jest-environment node
 */

import { z } from 'zod';

import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import { MAX_PROFILES, useProfileStore } from '@/shared/stores/global/profileStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

/**
 * `PersistedProfileStore` caps `profiles` at `MAX_PROFILES` and `addProfile`
 * appended without one, so a 65th profile made the blob unparseable — and
 * `createMergeWithSchema` is all-or-nothing, so the next launch discarded the
 * GLOBAL profile store: every profile the user has, and the active index.
 *
 * The refusal has to be reported, not silent: `profileSessionOrchestrator`
 * switches into the index it just asked for, and doing that for a profile the
 * store does not hold leaves the app running as an account nothing knows
 * about.
 */
function registered() {
  const entry = persistRegistry.find((candidate) => candidate.name === 'profile-store');
  if (!entry) throw new Error('profile-store missing from persistRegistry');
  return entry;
}

/** The blob the store would write, as AsyncStorage would hand it back. */
function projection(): unknown {
  const partialize = registered().partialize as (state: unknown) => unknown;
  return JSON.parse(JSON.stringify(partialize(useProfileStore.getState() as never)));
}

/** The ceiling the schema declares, read back out of it rather than retyped. */
function schemaCap(): number {
  const shape: unknown = z.toJSONSchema(registered().schema, {
    unrepresentable: 'any',
    io: 'input',
  });
  const max = (shape as { properties?: { profiles?: { maxItems?: number } } }).properties?.profiles
    ?.maxItems;
  if (max === undefined) throw new Error('profile schema no longer declares a maximum');
  return max;
}

const pubkey = (i: number) => `${i}`.padStart(64, '0');

/** The store's own post-rehydration hook, as `persist` would call it. */
function afterHydrate(): (state: ReturnType<typeof useProfileStore.getState>) => void {
  const options = useProfileStore.persist.getOptions() as {
    onRehydrateStorage?: () => (state: unknown, error?: unknown) => void;
  };
  const handler = options.onRehydrateStorage?.();
  if (!handler) throw new Error('profile-store has no onRehydrateStorage');
  return (state) => handler(state, undefined);
}

beforeEach(() => useProfileStore.setState({ profiles: [], activeAccountIndex: 0 }));

describe('profile store capacity', () => {
  it('declares the same ceiling the writer enforces', () => {
    expect(schemaCap()).toBe(MAX_PROFILES);
  });

  it('refuses the profile past the ceiling instead of losing all of them', () => {
    for (let i = 0; i < MAX_PROFILES; i++) {
      expect(useProfileStore.getState().addProfile(i, pubkey(i))).toBe(true);
    }

    expect(useProfileStore.getState().addProfile(MAX_PROFILES, pubkey(MAX_PROFILES))).toBe(false);

    const state = useProfileStore.getState();
    expect(state.profiles).toHaveLength(MAX_PROFILES);
    // The ones already there are the ones kept — nothing is evicted to make
    // room, because evicting a profile is losing access to its wallet.
    expect(state.profiles[0].accountIndex).toBe(0);
    expect(registered().schema.safeParse(projection()).success).toBe(true);
  });

  it('reports success for a profile that is already recorded', () => {
    expect(useProfileStore.getState().addProfile(7, pubkey(7))).toBe(true);
    // A duplicate is not a failure: the caller asked for it to be present and
    // it is. Returning false here would abort a switch that is fine.
    expect(useProfileStore.getState().addProfile(7, pubkey(7))).toBe(true);
    expect(useProfileStore.getState().profiles).toHaveLength(1);
  });

  it('refuses an index another identity already holds', () => {
    // An imported profile's index is a 31-bit hash of its npub, so it can in
    // principle land on a derived index. Saying "already there" then would let
    // `createAndSwitchProfile` restart into somebody else's identity.
    expect(useProfileStore.getState().addProfile(5, pubkey(5), 'imported')).toBe(true);
    expect(useProfileStore.getState().addProfile(5, pubkey(99))).toBe(false);
    expect(useProfileStore.getState().profiles).toHaveLength(1);
    expect(useProfileStore.getState().profiles[0].pubkey).toBe(pubkey(5));
  });

  it('repairs an active index no profile stands behind', () => {
    // `getActiveProfilePubkey()` returns undefined for it, and
    // `createProfileScopedStorage` then falls back to the BARE key — every
    // profile-scoped store silently reading and writing unscoped state shared
    // across profiles. The schema permits the shape, so the repair is on
    // rehydrate rather than a refine that would discard the blob.
    useProfileStore.setState({
      activeAccountIndex: 0,
      profiles: [{ accountIndex: 7, pubkey: pubkey(7), addedAt: 1 }],
    });

    afterHydrate()(useProfileStore.getState());

    expect(useProfileStore.getState().activeAccountIndex).toBe(7);
  });

  it('leaves a consistent active index alone', () => {
    useProfileStore.setState({
      activeAccountIndex: 7,
      profiles: [
        { accountIndex: 7, pubkey: pubkey(7), addedAt: 1 },
        { accountIndex: 8, pubkey: pubkey(8), addedAt: 2 },
      ],
    });

    afterHydrate()(useProfileStore.getState());

    expect(useProfileStore.getState().activeAccountIndex).toBe(7);
  });

  it('still accepts an existing profile when the list is full', () => {
    for (let i = 0; i < MAX_PROFILES; i++) useProfileStore.getState().addProfile(i, pubkey(i));
    expect(useProfileStore.getState().addProfile(0, pubkey(0))).toBe(true);
  });
});
