/**
 * @jest-environment node
 */

/**
 * Values the 0.1.3 writers could save without a limit that 0.1.3's reader
 * turned down.
 *
 * Each case below is a value a 0.1.3 store action saved without a limit,
 * while the 0.1.3 read schema held a limit (`.max`) on that field and had
 * no per-field or per-entry tolerance around it. The row is the E19 disk's own
 * row for that store (frozen fixture, 0.1.2 and 0.1.3; not edited here) with
 * that one value added, written as 0.1.3's `partialize` and the zustand
 * `{state, version}` envelope wrote it, under the key 0.1.3 used. The current
 * app is then started over that disk with the release-fixture runner's own
 * launch (`releaseFixtures/launch.ts`): global migrations, every persisted
 * store through its real options and scoped storage, the accounts' keys, one
 * write from every store, and an account switch.
 *
 * A store that has been repaired reads whatever a release could have written:
 * its case "over the limit" expects every other value to load as saved, and
 * nothing to be copied aside; the limit now holds only for new writes, which
 * the store's own tests pin. A store not repaired is a CHARACTERIZATION: its
 * case pins what the person is left with today, and its `QUIRK:` lines name
 * what is lost, the valid data beside the one long value included, because
 * the schema rejects the whole blob. In both, the control case beside it holds
 * the same row with the value exactly at the limit, and loads whole.
 *
 * In every one of these stores the 0.1.3 READER already had the same limit as
 * today's (cited per case): the mismatch is between a released writer and
 * both readers, not a limit added after 0.1.3. What changed since 0.1.3 is
 * that the rejected bytes are now copied aside to `<store>:unreadable` before
 * the first overwrite (`shared/lib/persist/preserveUnreadable.ts`); 0.1.3 had
 * no such copy.
 *
 * References: `G/` = `app/shared/stores/global/`, `P/` =
 * `app/shared/stores/profile/`, `L/` = `app/shared/lib/`, all `@d9ad12c4b`
 * (0.1.3) unless they say HEAD.
 */

// Mocks storage with in-memory maps; nothing above loads storage.
import { install, launch } from './releaseFixtures/launch';
import type { Launch } from './releaseFixtures/launch';
import { fixture as E19 } from './releaseFixtures/E19-0.1.2';
import { ACCOUNTS, IMPORTED, PHRASE_HASH, accountKey } from './releaseFixtures/format';
import type { ReleaseFixture } from './releaseFixtures/format';

// Each case starts the whole app over a disk; allow what the fixture runner allows.
jest.setTimeout(120_000);

const A0 = ACCOUNTS[0].pubkey;
const A1 = ACCOUNTS[1].pubkey;

type Row = { state: Record<string, unknown>; version: number };
type State = Record<string, unknown>;

/** E19's own row for a key: what a 0.1.3 install held there. */
const e19Row = (key: string): Row => E19.asyncStorage[key] as Row;

/** The bytes zustand's persist wrote: `JSON.stringify({ state, version })`. */
const released = (version: number, state: object): string => JSON.stringify({ state, version });

const longText = (length: number) => 'x'.repeat(length);

/** Where the rejected bytes are copied: before the scope, so `<store>:unreadable:profile:<pubkey>`. */
const sideKey = (store: string, pubkey?: string) =>
  pubkey ? accountKey(`${store}:unreadable`, pubkey) : `${store}:unreadable`;

interface Started {
  /** The disk that was installed, to start the app over again with `launch`. */
  variant: ReleaseFixture;
  run: Launch;
  /** The store's state right after that account's copy loaded and wrote once. */
  loaded: State;
  /** The row as it is on disk after the launch, parsed. */
  saved: Row | undefined;
}

/**
 * One cold start of the current app over E19 with one row replaced.
 * `account` says whose copy of a per-account store to read; omit for a global store.
 */
async function startWith(
  key: string,
  bytes: string,
  store: string,
  options: {
    account?: number;
    files?: Record<string, string>;
  } = {}
): Promise<Started> {
  const variant: ReleaseFixture = {
    ...E19,
    asyncStorage: { ...E19.asyncStorage, [key]: bytes },
    files: { ...E19.files, ...options.files },
    survives: {
      ...E19.survives,
      facts: [{ what: 'loaded', store, accountIndex: options.account, path: [], equals: null }],
    },
    knownGaps: [],
  };
  install(variant);
  const run = await launch(variant);
  const raw = run.disk.asyncStorage[key];
  return {
    variant,
    run,
    loaded: run.facts.loaded as State,
    saved: raw === undefined ? undefined : (JSON.parse(raw) as Row),
  };
}

beforeAll(() => {
  // The logger prints every entry; a launch makes hundreds.
  for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
    jest.spyOn(console, method).mockImplementation(() => {});
  }
});
afterAll(() => jest.restoreAllMocks());

// ── 1. profile-store: a cached kind-0 label ──────────────────────────────────

/**
 * Writer: `L/nostr/ownsync/useOwnEventsSync.ts:59-68` parses the account's own
 * kind-0 and hands `display_name || name` and `picture` to
 * `updateProfileMetadata` (`G/profileStore.ts:233-242`), which copies them
 * into the row uncapped; `partialize` :259-262 saves the whole list; version
 * 2 (`PROFILE_STORE_PERSIST_VERSION` :127). The 0.1.3 reader had the same
 * caps (:100-101) and rejected the whole list. Repaired: a label over the cap
 * is read as absent, and `updateProfileMetadata` clips a name and does not
 * save a picture URL over the cap (`profileStoreActions.test.ts`).
 */
describe('profile-store: a kind-0 label longer than the cached-label limit', () => {
  const KEY = 'profile-store';
  const row = e19Row(KEY);
  // The list as this build writes it: 0.1.4's wallet fields on every account
  // (as in E20), so the repair is seen to keep them too.
  const profiles: State[] = (row.state.profiles as State[]).map((profile) => ({
    ...profile,
    walletDatabaseCreated: true,
    ...(profile.pubkey === IMPORTED.pubkey ? { walletPhraseFingerprint: PHRASE_HASH } : {}),
  }));
  const withLabel = (label: { cachedDisplayName?: string; cachedPicture?: string }) => {
    const [first, ...rest] = profiles;
    return released(2, { ...row.state, profiles: [{ ...first, ...label }, ...rest] });
  };

  it.each([
    ['cachedDisplayName', 513, 'cachedPicture'],
    ['cachedPicture', 2049, 'cachedDisplayName'],
  ])(
    'keeps every account over three launches when %s is %i characters, and drops only that label',
    async (field, length, otherLabel) => {
      const bytes = withLabel({ [field]: longText(length) });
      const first = await startWith(KEY, bytes, KEY);
      const second = await launch(first.variant);
      const third = await launch(first.variant);

      for (const run of [first.run, second, third]) {
        const loaded = run.facts.loaded as State;
        // Every account, in order, with the one in use still in use.
        expect(loaded.activeAccountIndex).toBe(1);
        expect(run.activeAccountIndex).toBe(1);
        expect(run.openedPubkeys).toEqual(
          Object.fromEntries(E19.survives.accounts.map((a) => [a.accountIndex, a.pubkey]))
        );
        const [zero, ...rest] = loaded.profiles as State[];
        // Account 0 keeps all it had but the one label too long to read.
        const { [field]: _tooLong, ...kept } = profiles[0];
        expect(zero).toEqual(kept);
        expect(zero[field]).toBeUndefined();
        expect(zero[otherLabel]).toBe(profiles[0][otherLabel]);
        // The other accounts, imported identity and wallet fields included, are as saved.
        expect(rest).toEqual(profiles.slice(1));
        expect(run.rejections).toEqual([]);
        expect(run.defaultedRows.filter((r) => r.startsWith(`${KEY} `))).toEqual([]);
        expect(run.disk.asyncStorage[sideKey(KEY)]).toBeUndefined();
      }
      // The next save writes the list without the long label.
      const saved = JSON.parse(third.disk.asyncStorage[KEY]) as Row;
      expect((saved.state.profiles as State[]).map((p) => p.pubkey)).toEqual(
        profiles.map((p) => p.pubkey)
      );
      expect((saved.state.profiles as State[])[0]).not.toHaveProperty(field);
      // The keys themselves are untouched.
      expect(third.disk.secureStore[`imported_nsec_${IMPORTED.pubkey}`]).toBe(
        E19.secureStore[`imported_nsec_${IMPORTED.pubkey}`]
      );
    }
  );

  it.each([
    ['cachedDisplayName', 512],
    ['cachedPicture', 2048],
  ])('keeps every account when %s is exactly %i characters', async (field, length) => {
    const bytes = withLabel({ [field]: longText(length) });
    const { run, loaded } = await startWith(KEY, bytes, KEY);

    expect(run.rejections).toEqual([]);
    expect((loaded.profiles as State[]).map((p) => p.pubkey)).toEqual([A0, A1, IMPORTED.pubkey]);
    expect(loaded.activeAccountIndex).toBe(1);
    expect(run.activeAccountIndex).toBe(1);
    expect((loaded.profiles as State[])[0][field]).toBe(longText(length));
    expect(run.disk.asyncStorage[sideKey(KEY)]).toBeUndefined();
  });
});

// ── 2. swap-transactions-store: a leg's error message ────────────────────────

/**
 * Writer: `setLegStatus` (`P/swapTransactionsStore.ts:279-293`) stores the
 * `errorMessage` it is given as it is; the rebalance orchestrator passes the
 * caught error's message through (`app/features/mint/hooks/
 * useMintRebalanceOrchestrator.ts:289-294`). `partialize` :304-307, version 1
 * (no `version` option, `L/persist/persistConfig.ts`). 0.1.3 read limit :142,
 * which rejected every group. `groups` is a plain `z.record` at both (:167,
 * HEAD :193). Repaired: an over-long message is read as absent, and
 * `setLegStatus` and `addLeg` clip a new one (`swapTransactionsStoreLegPatch.test.ts`).
 */
describe('swap-transactions-store: an unfinished leg with a long error message', () => {
  const KEY = accountKey('swap-transactions-store', A0);
  const row = e19Row(KEY);
  const RUNNING_ID = 'swap-1790000000000-7';
  const LEG_ID = 'leg-1790000000000-8';
  const leg = {
    id: LEG_ID,
    fromMintUrl: 'https://mint.minibits.cash/Bitcoin',
    toMintUrl: 'https://mint.coinos.io',
    amount: 1000,
    mintQuoteId: 'mint-quote-running-1',
    mintOperationId: 'mint-op-running-1',
    meltQuoteId: 'melt-quote-running-1',
    meltOperationId: 'melt-op-running-1',
    localStatus: 'paymentPending',
  };
  const group = {
    id: RUNNING_ID,
    unit: 'sat',
    createdAt: 1_790_000_000_000,
    title: 'Rebalance',
    state: 'running',
  };
  const quoteIdToGroup = {
    ...(row.state.quoteIdToGroup as State),
    'mint-quote-running-1': { groupId: RUNNING_ID, legId: LEG_ID, kind: 'mint' },
    'melt-quote-running-1': { groupId: RUNNING_ID, legId: LEG_ID, kind: 'melt' },
  };
  const withRunningSwap = (errorMessage: string) =>
    released(1, {
      groups: {
        ...(row.state.groups as State),
        [RUNNING_ID]: { ...group, legs: [{ ...leg, errorMessage }] },
      },
      quoteIdToGroup,
    });

  it('keeps every group, the unfinished leg and the quote index when one error message is 2049 characters', async () => {
    const bytes = withRunningSwap(longText(2049));
    const { run, loaded, saved } = await startWith(KEY, bytes, 'swap-transactions-store', {
      account: 0,
    });

    // The group E19 already held, untouched; the unfinished one with its leg's
    // ids, quote ids and state, and only the unreadable message gone.
    expect(loaded.groups).toEqual({
      ...(row.state.groups as State),
      [RUNNING_ID]: { ...group, legs: [leg] },
    });
    expect(loaded.quoteIdToGroup).toEqual(quoteIdToGroup);
    expect(run.rejections).toEqual([]);
    expect(run.defaultedRows).not.toContain('swap-transactions-store (account 0)');
    expect(run.disk.asyncStorage[sideKey('swap-transactions-store', A0)]).toBeUndefined();
    expect(saved!.state).toEqual({ groups: loaded.groups, quoteIdToGroup });
  });

  it('keeps both groups when the error message is exactly 2048 characters', async () => {
    const bytes = withRunningSwap(longText(2048));
    const { run, loaded } = await startWith(KEY, bytes, 'swap-transactions-store', {
      account: 0,
    });

    expect(run.rejections).toEqual([]);
    expect(Object.keys(loaded.groups as State).sort()).toEqual(
      [...Object.keys(row.state.groups as State), RUNNING_ID].sort()
    );
    expect((loaded.groups as Record<string, { legs: State[] }>)[RUNNING_ID].legs[0]).toEqual({
      ...leg,
      errorMessage: longText(2048),
    });
    expect(loaded.quoteIdToGroup).toEqual(quoteIdToGroup);
    expect(run.disk.asyncStorage[sideKey('swap-transactions-store', A0)]).toBeUndefined();
  });
});

// ── 3. nostr-social-store: the kind-3 contacts document ──────────────────────

/**
 * Writer: own-event sync passes the newest kind-3's tags and content
 * (`L/nostr/ownsync/useOwnEventsSync.ts:121-125`, tags as the relay sent them,
 * :54) to `setContactsFromRelay` (`P/nostrSocialStore.ts:416-438`), which
 * stores both unchanged; `partialize` :701-714, version 2 (:699). 0.1.3 read
 * limits :383-386 (content length, tag value length, values per tag, tag
 * count), none of which the writer held, and any one over them rejected the
 * whole journal. Repaired: the contacts document is read with no limit, as it
 * was saved; it is what the next follow or unfollow is built from, so it must
 * come back byte for byte. No write limit: the document is the person's own
 * signed event, and a clipped copy would publish a different follow list.
 */
describe('nostr-social-store: a contacts document longer than the 0.1.3 limits', () => {
  const KEY = accountKey('nostr-social-store', A0);
  const row = e19Row(KEY);
  const tags = row.state.contactsTags as string[][];
  const withContacts = (contacts: { contactsContent?: string; contactsTags?: string[][] }) =>
    released(2, { ...row.state, ...contacts });
  const longPetnameTag = (length: number) => [
    ...tags,
    ['p', 'c'.repeat(64), 'wss://relay.example', longText(length)],
  ];
  const wideTag = (values: number) => [
    ...tags,
    ['p', 'd'.repeat(64), ...Array.from({ length: values - 2 }, (_, i) => `v${i}`)],
  ];
  const manyTags = (count: number) => [
    ...tags,
    ...Array.from({ length: count - tags.length }, (_, i) => [
      'p',
      i.toString(16).padStart(64, '0'),
    ]),
  ];

  it.each([
    ['content of 65537 characters', { contactsContent: longText(65_537) }],
    ['a tag value of 2049 characters', { contactsTags: longPetnameTag(2049) }],
    ['a tag of 17 values', { contactsTags: wideTag(17) }],
    ['50001 tags', { contactsTags: manyTags(50_001) }],
  ])('keeps the whole social journal and the contacts as saved for %s', async (_what, contacts) => {
    const bytes = withContacts(contacts);
    const { run, loaded, saved } = await startWith(KEY, bytes, 'nostr-social-store', {
      account: 0,
    });

    // The follow list, likes, deleted-note ids and zap totals, as saved.
    expect(loaded).toMatchObject({ ...row.state, ...contacts });
    // The contacts document, byte for byte, in memory and in the next save.
    const document: State = { ...row.state, ...contacts };
    expect(JSON.stringify(loaded.contactsTags)).toBe(JSON.stringify(document.contactsTags));
    expect(loaded.contactsContent).toBe(document.contactsContent);
    expect(JSON.stringify(saved!.state.contactsTags)).toBe(JSON.stringify(document.contactsTags));
    expect(saved!.state.contactsContent).toBe(document.contactsContent);
    expect(run.rejections).toEqual([]);
    expect(run.defaultedRows).not.toContain('nostr-social-store (account 0)');
    expect(run.disk.asyncStorage[sideKey('nostr-social-store', A0)]).toBeUndefined();
  });

  it.each([
    ['content of 65536 characters', { contactsContent: longText(65_536) }],
    ['a tag value of 2048 characters', { contactsTags: longPetnameTag(2048) }],
    ['a tag of 16 values', { contactsTags: wideTag(16) }],
    ['50000 tags', { contactsTags: manyTags(50_000) }],
  ])('keeps the social journal for %s', async (_what, contacts) => {
    const bytes = withContacts(contacts);
    const { run, loaded } = await startWith(KEY, bytes, 'nostr-social-store', { account: 0 });

    expect(run.rejections).toEqual([]);
    expect(loaded).toMatchObject({ ...row.state, ...contacts });
    expect(run.disk.asyncStorage[sideKey('nostr-social-store', A0)]).toBeUndefined();
  });
});

// ── 4. own-content-store: a long own note ────────────────────────────────────

/**
 * Writer: own-event sync feeds each own kind-1 to `ingestSeen`
 * (`L/nostr/ownsync/useOwnEventsSync.ts:116-118`), which copies the event
 * (`feedEventFrom`, `P/ownContentStore.ts:70-77`; `ingestSeen` :157-168);
 * `prune` caps counts and age, not text. `partialize` :185-192, version 1.
 * 0.1.3 read limit :105; HEAD the same field. `byId` is a plain `z.record`
 * (:121).
 */
describe('own-content-store: an own note longer than the content limit', () => {
  const KEY = accountKey('own-content-store', A0);
  const row = e19Row(KEY);
  const LONG_ID = 'e'.repeat(64);
  const withLongNote = (content: string) =>
    released(1, {
      byId: {
        ...(row.state.byId as State),
        [LONG_ID]: {
          event: {
            id: LONG_ID,
            kind: 1,
            pubkey: A0,
            content,
            tags: [],
            created_at: 1_790_000_000,
          },
          authorPubkey: A0,
          status: 'confirmed',
          updatedAt: 1_790_000_000_000,
        },
      },
    });

  it('loses every own note when one is 65537 characters', async () => {
    const bytes = withLongNote(longText(65_537));
    const { run, loaded } = await startWith(KEY, bytes, 'own-content-store', { account: 0 });

    // QUIRK: E19's short "gm from the fixture" note goes with the long one.
    expect(loaded.byId).toEqual({});
    expect(run.rejections).toContain('store.own_content.merge_rejected');
    expect(run.defaultedRows).toContain('own-content-store (account 0)');
    expect(run.disk.asyncStorage[sideKey('own-content-store', A0)]).toBe(bytes);
  });

  it('keeps both notes when the long one is exactly 65536 characters', async () => {
    const bytes = withLongNote(longText(65_536));
    const { run, loaded } = await startWith(KEY, bytes, 'own-content-store', { account: 0 });

    expect(run.rejections).toEqual([]);
    expect(Object.keys(loaded.byId as State).sort()).toEqual(
      [...Object.keys(row.state.byId as State), LONG_ID].sort()
    );
    expect(run.disk.asyncStorage[sideKey('own-content-store', A0)]).toBeUndefined();
  });
});

// ── 5. nostr-relay-list-store: more relays than the list limit ───────────────

/**
 * Writer: `addRelay` (`L/nostr/outbox/relayListStore.ts:94-96`, through
 * `upsert` :65-77) appends a distinct normalized URL with no count cap, and
 * `setFromRelay` :87-92 assigns a relay's list whole. `partialize` :121-126,
 * version 1. 0.1.3 read limit :51; HEAD the same line.
 */
describe('nostr-relay-list-store: a relay list longer than 64', () => {
  const KEY = accountKey('nostr-relay-list-store', A0);
  const row = e19Row(KEY);
  const withRelays = (count: number) =>
    released(1, {
      ...row.state,
      entries: [
        ...(row.state.entries as State[]),
        ...Array.from({ length: count - (row.state.entries as State[]).length }, (_, i) => ({
          url: `wss://relay${i}.example.com`,
          read: true,
          write: i % 2 === 0,
        })),
      ],
      source: 'local',
    });

  it('loses the whole relay configuration at 65 relays', async () => {
    const bytes = withRelays(65);
    const { run, loaded } = await startWith(KEY, bytes, 'nostr-relay-list-store', {
      account: 0,
    });

    // QUIRK: the person's relays, the published marker and the list's time
    // are gone; the account falls back to the bootstrap relays.
    expect(loaded.entries).toEqual([]);
    expect(loaded.hasPublished).toBe(false);
    expect(loaded.updatedAt).toBe(0);
    expect(loaded.source).toBe('default');
    expect(run.rejections).toContain('store.nostr_relay_list.merge_rejected');
    expect(run.defaultedRows).toContain('nostr-relay-list-store (account 0)');
    expect(run.disk.asyncStorage[sideKey('nostr-relay-list-store', A0)]).toBe(bytes);
  });

  it('keeps the relay configuration at exactly 64 relays', async () => {
    const bytes = withRelays(64);
    const { run, loaded } = await startWith(KEY, bytes, 'nostr-relay-list-store', {
      account: 0,
    });

    expect(run.rejections).toEqual([]);
    expect(loaded.entries).toHaveLength(64);
    expect(loaded).toMatchObject({ hasPublished: true, source: 'local' });
    expect(run.disk.asyncStorage[sideKey('nostr-relay-list-store', A0)]).toBeUndefined();
  });
});

// ── 6. search-history-store: one long recorded search ────────────────────────

/**
 * Writer: `addSearch` (`P/searchHistoryStore.ts:56-86`) trims and refuses
 * fewer than 2 characters, then caps the count, not the length. Its one
 * caller records the settled query of a search with at least one result
 * (`app/shared/ui/composed/search/UnifiedSearch.tsx:54-61`), under the
 * surface `'contacts' | 'feed' | 'wallet'` (`useRecentSearches.ts:16`), so a
 * context longer than 64 is not reachable from 0.1.3's UI. `partialize` :102,
 * version 1. 0.1.3 read limit :40; HEAD the same field.
 */
describe('search-history-store: a recorded search longer than 2048', () => {
  const KEY = accountKey('search-history-store', A0);
  const row = e19Row(KEY);
  const withFeedSearch = (query: string) =>
    released(1, {
      recentSearches: {
        ...(row.state.recentSearches as State),
        feed: [
          { query, timestamp: 1_790_000_000_000, context: 'feed' },
          { query: 'nutzap', timestamp: 1_789_000_000_000, context: 'feed' },
        ],
      },
    });

  it('loses every surface’s searches when one is 2049 characters', async () => {
    const bytes = withFeedSearch(longText(2049));
    const { run, loaded } = await startWith(KEY, bytes, 'search-history-store', {
      account: 0,
    });

    // QUIRK: the contacts searches E19 held, and the other feed search, go too.
    expect(loaded.recentSearches).toEqual({});
    expect(run.rejections).toContain('store.search_history.merge_rejected');
    expect(run.defaultedRows).toContain('search-history-store (account 0)');
    expect(run.disk.asyncStorage[sideKey('search-history-store', A0)]).toBe(bytes);
  });

  it('keeps every surface’s searches when the long one is exactly 2048', async () => {
    const bytes = withFeedSearch(longText(2048));
    const { run, loaded } = await startWith(KEY, bytes, 'search-history-store', {
      account: 0,
    });

    expect(run.rejections).toEqual([]);
    expect(Object.keys(loaded.recentSearches as State).sort()).toEqual(['contacts', 'feed']);
    expect((loaded.recentSearches as Record<string, unknown[]>).feed).toHaveLength(2);
    expect(run.disk.asyncStorage[sideKey('search-history-store', A0)]).toBeUndefined();
  });
});

// ── 7. mint-metadata-store: one mint's name ──────────────────────────────────

/**
 * Writer: `identityFromInfo` (`G/mintMetadataStore.ts:150-159`) copies a
 * mint's NUT-06 `name`, `icon_url` and `description` as they are;
 * `setIdentity` :205-207 merges them through `mergeCached` :183-196.
 * `partialize` :323-326, version 1. 0.1.3 read limits :105-108; HEAD
 * :126-129. `byMintUrl` is a plain `z.record` (:130, HEAD :162).
 */
describe('mint-metadata-store: a mint name longer than 256', () => {
  const KEY = 'mint-metadata-store';
  const row = e19Row(KEY);
  const byMintUrl = row.state.byMintUrl as Record<string, State>;
  const [MINT, MINT_B] = Object.keys(byMintUrl);
  const withName = (displayName: string) =>
    released(1, {
      ...row.state,
      byMintUrl: { ...byMintUrl, [MINT_B]: { ...byMintUrl[MINT_B], displayName } },
    });

  it('loses every mint’s metadata when one name is 257 characters', async () => {
    const bytes = withName(longText(257));
    const { run, loaded, saved } = await startWith(KEY, bytes, KEY);

    // QUIRK: the other mint's name, reviews, audit and social scores go too.
    expect(loaded.byMintUrl).toEqual({});
    // The import-marker reset re-runs the one-time import of the pre-0.1.1
    // caches (`migrateLegacyMintCaches`); E19 holds none, so it brings nothing
    // back and sets the marker again. Because of that the runner's
    // defaulted-row check does not flag this store.
    expect(loaded.legacyMigrated).toBe(true);
    expect(run.defaultedRows.some((r) => r.startsWith('mint-metadata-store '))).toBe(false);
    expect(saved!.state).toEqual({ byMintUrl: {}, legacyMigrated: true });
    expect(run.rejections).toContain('store.mint_metadata.merge_rejected');
    expect(run.disk.asyncStorage[sideKey(KEY)]).toBe(bytes);
  });

  it('keeps every mint’s metadata when the name is exactly 256', async () => {
    const bytes = withName(longText(256));
    const { run, loaded } = await startWith(KEY, bytes, KEY);

    expect(run.rejections).toEqual([]);
    expect((loaded.byMintUrl as Record<string, State>)[MINT]).toMatchObject(byMintUrl[MINT]);
    expect((loaded.byMintUrl as Record<string, State>)[MINT_B].displayName).toBe(longText(256));
    expect(loaded.legacyMigrated).toBe(true);
    expect(run.disk.asyncStorage[sideKey(KEY)]).toBeUndefined();
  });
});

// ── 8. wallpaper-store: a catalog larger than the limits ─────────────────────

/**
 * Writer: `setCatalog` (`G/wallpaperStore.ts:137-153`) saves the albums and
 * wallpapers it is given, with no count cap; its caller
 * (`L/wallpaperSync.ts:97-99`) filters by author, not by count. `partialize`
 * :298-304, version 1. 0.1.3 read limits :117-118; HEAD the same lines.
 * Reachability depends on the catalog server sending that many, which the
 * source does not show.
 */
describe('wallpaper-store: a catalog with more albums or wallpapers than the limits', () => {
  const KEY = 'wallpaper-store';
  const row = e19Row(KEY);
  const albums = row.state.albums as State[];
  const catalog = row.state.catalog as State[];
  // The downloaded image, where the current app looks for it
  // (`L/wallpaperStorage.ts` `getWallpaperUri`); without it `verifyIntegrity`
  // drops the download whatever the schema says.
  const IMAGE = { 'document/wallpapers/aurora-01.png': 'png bytes' };
  const withCatalog = (albumCount: number, wallpaperCount: number) =>
    released(1, {
      ...row.state,
      albums: [
        ...albums,
        ...Array.from({ length: albumCount - albums.length }, (_, i) => ({
          slug: `album-${i}`,
          displayName: `Album ${i}`,
          description: '',
          sortOrder: i + 1,
          topic: 'Nature',
          coverThemeName: `album-${i}-01`,
          author: null,
        })),
      ],
      catalog: [
        ...catalog,
        ...Array.from({ length: wallpaperCount - catalog.length }, (_, i) => ({
          themeName: `extra-${i}`,
          blossomUrl: `https://blossom.example/${i}.png`,
          albumSlug: 'album-0',
        })),
      ],
    });

  it.each([
    ['1001 albums', 1001, 1],
    ['10001 wallpapers', 1, 10_001],
  ])('loses the downloaded wallpaper with %s', async (_what, albumCount, wallpaperCount) => {
    const bytes = withCatalog(albumCount, wallpaperCount);
    const { run, loaded } = await startWith(KEY, bytes, KEY, { files: IMAGE });

    // QUIRK: the record of the wallpaper already downloaded to the phone goes
    // with the catalog, which could be fetched again; the file stays orphaned.
    expect(loaded.downloaded).toEqual({});
    expect(loaded.albums).toEqual([]);
    expect(loaded.catalog).toEqual([]);
    expect(loaded.catalogLastFetched).toBe(0);
    expect(run.rejections).toContain('store.wallpaper.merge_rejected');
    expect(run.disk.asyncStorage[sideKey(KEY)]).toBe(bytes);
  });

  it('keeps the downloaded wallpaper with exactly 1000 albums and 10000 wallpapers', async () => {
    const bytes = withCatalog(1000, 10_000);
    const { run, loaded } = await startWith(KEY, bytes, KEY, { files: IMAGE });

    expect(run.rejections).toEqual([]);
    expect(Object.keys(loaded.downloaded as State)).toEqual(
      Object.keys(row.state.downloaded as State)
    );
    expect(loaded.albums).toHaveLength(1000);
    expect(loaded.catalog).toHaveLength(10_000);
    expect(run.disk.asyncStorage[sideKey(KEY)]).toBeUndefined();
  });
});

// ── 9. wallet-lifecycle: a long restore error ────────────────────────────────

/**
 * Writer: `setRestoreStatus` (`G/walletLifecycleStore.ts:55-56`) stores any
 * error string; `partialize` :66-71, version 1. Its only 0.1.3 callers pass
 * no error (`app/shared/blocks/AppGate.tsx:220,223`), so no released path is
 * known to write a long one: this pins the store boundary only. 0.1.3 read
 * limit :41; HEAD :47.
 */
describe('wallet-lifecycle: a restore error longer than 500', () => {
  const KEY = 'wallet-lifecycle';
  const row = e19Row(KEY);
  const LIFECYCLE = {
    seedCreatedAt: row.state.seedCreatedAt,
    restoreStatus: 'failed',
    lastRestoreAt: 1_789_000_000_000,
  };
  const withError = (lastRestoreError: string) => released(1, { ...LIFECYCLE, lastRestoreError });

  it('loses when the seed was made, and the failed status, at 501 characters', async () => {
    const bytes = withError(longText(501));
    const { run, loaded } = await startWith(KEY, bytes, KEY);

    // QUIRK: `seedCreatedAt` (what tells this install apart from a reinstall)
    // and the failed restore status are lost with the error text.
    expect(loaded).toMatchObject({
      seedCreatedAt: null,
      restoreStatus: 'unknown',
      lastRestoreAt: null,
      lastRestoreError: null,
    });
    expect(run.rejections).toContain('store.wallet_lifecycle.merge_rejected');
    expect(run.disk.asyncStorage[sideKey(KEY)]).toBe(bytes);
  });

  it('keeps the record at exactly 500 characters', async () => {
    const bytes = withError(longText(500));
    const { run, loaded } = await startWith(KEY, bytes, KEY);

    expect(run.rejections).toEqual([]);
    expect(loaded).toMatchObject({ ...LIFECYCLE, lastRestoreError: longText(500) });
    expect(run.disk.asyncStorage[sideKey(KEY)]).toBeUndefined();
  });
});
