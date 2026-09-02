import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';
import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

// `jest.mock` is hoisted above the imports above, so this still applies.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

/**
 * The store end of the note-stats contract.
 *
 * `recordZapPaid` persists `expectedSats = baseSats + deltaSats` under
 * `z.number().int()`, where `baseSats` is the post's `satsZapped`. `NoteStats`
 * has always declared that an integer, but every tier reached it through a
 * TypeScript cast, so a provider that broke the contract sent a fraction
 * through — and `createMergeWithSchema` is all-or-nothing, so it discarded the
 * WHOLE social store on the next launch: follow set, contact tags, engagement
 * map, both deletion sets.
 *
 * `toNoteStats` now holds that contract at the tier boundary
 * (`nostr/src/facade/noteStatsContract.ts`). This is the other half: given a
 * `satsZapped` that satisfies it, what the store persists must parse.
 */
const STORE_NAME = 'nostr-social-store';
const EVENT_ID = 'e'.repeat(64);
const PUBKEY = 'a'.repeat(64);

function registered() {
  const entry = persistRegistry.find((e) => e.name === STORE_NAME);
  if (!entry) throw new Error(`${STORE_NAME} is not registered`);
  return entry;
}

/** The blob the store would write, as AsyncStorage would hand it back. */
function projection(): unknown {
  const partialize = registered().partialize as (state: unknown) => unknown;
  return JSON.parse(JSON.stringify(partialize(useNostrSocialStore.getState() as never)));
}

beforeEach(() => {
  // Every persisted key this file touches, so one case cannot leak into the
  // next and make a later `safeParse` fail for the wrong reason.
  useNostrSocialStore.setState({
    contactsTags: [['p', PUBKEY]],
    followingPubkeys: { [PUBKEY]: true },
    optimisticZapsByEventId: {},
    optimisticLikesByEventId: {},
    optimisticRepostsByEventId: {},
    zappedByEventId: {},
  });
});

describe('optimistic zap persistence', () => {
  it('persists a zap taken from a contract-satisfying aggregate', () => {
    // 21 is what the tier boundary yields for a provider that sent 21.5 —
    // `nostr/__tests__/note-stats-contract.test.ts` pins that half.
    useNostrSocialStore.getState().recordZapPaid(EVENT_ID, 100, 21);

    const blob = projection();
    expect(registered().schema.safeParse(blob).success).toBe(true);

    // And the merge keeps the rest of the blob rather than falling back.
    const current: { contactsTags: string[][]; followingPubkeys: Record<string, true> } = {
      contactsTags: [],
      followingPubkeys: {},
    };
    const merged = createMergeWithSchema(STORE_NAME, registered().schema)(blob, current);
    expect(merged.contactsTags).toEqual([['p', PUBKEY]]);
    expect(Object.keys(merged.followingPubkeys)).toEqual([PUBKEY]);
  });

  it('is the field that would have failed, so the guarantee is load-bearing', () => {
    // Straight past the boundary, which is what used to happen: this is the
    // wipe the contract now prevents, demonstrated rather than asserted away.
    useNostrSocialStore.getState().recordZapPaid(EVENT_ID, 100, 21.5);
    expect(registered().schema.safeParse(projection()).success).toBe(false);
  });

  it('still persists a whole-sat zap unchanged', () => {
    useNostrSocialStore.getState().recordZapPaid(EVENT_ID, 100, 21);
    expect(registered().schema.safeParse(projection()).success).toBe(true);
    expect(useNostrSocialStore.getState().optimisticZapsByEventId[EVENT_ID].expectedSats).toBe(121);
  });
});
