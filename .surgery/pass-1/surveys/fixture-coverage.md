# Fixture coverage of the persistence map

Survey for pass 1 (persisted state). Read-only; written 2026-11-10 against `surgery/pass-1` at `87b8afffe`.

**Question.** `docs/architecture/persistence/persistence-map.md` (2026-10-10, commit `5651d4720`) says "NO TEST" in
many rows. The release fixtures were built two days later (`5a7c90bee`, `c4c371fa4`, 2026-10-12). Which rows are
really covered today, and which are real gaps?

**Answer in short.** Every persisted *store* a release wrote is now held by a fixture from the epoch that
introduced it, with at least one fact read back through the current store. Almost every "NO TEST" cell on a store
row is stale. The real gaps are all outside the store registry, which is the only thing the completeness test
enforces: secure vault contents and hand-written keys that 0.1.4 adds (nearby-payment journal, Routstr SDK
recovery records), field-level additions to `profile-store` made after the E20 disk was generated, Whitenoise
storage, restore-in-progress states, and files and non-Coco SQLite.

## How this was checked

- Fixture contents were dumped by importing `app/__tests__/releaseFixtures/index.ts` with Bun and listing, per
  epoch, every AsyncStorage key, SecureStore key, file, database name, fact, kept key, default row and known gap.
  Nothing here is read off the fixture source by eye except where a line is cited.
- "Fact" means a `survives.facts` entry: `releaseFixtures.test.ts` (below **RF**) reads it through the live store
  after each of three cold starts. "Kept" means `keptAsyncStorage` / `keptSecureStore`: RF asserts the bytes are
  unchanged, and nothing reads them.
- RF also asserts, for every registry store with a row in the fixture, that it did not come back as defaults
  ("loads no store that held data as its defaults") and that no blob was rejected or set aside. So a store row
  without a fact of its own still has that coverage.
- Ran: `bun run test -- __tests__/releaseFixturesCompleteness.test.ts __tests__/releaseFixturesFrozen.test.ts
  __tests__/persistenceSurface.test.ts __tests__/releasedPersistedSurface.test.ts --runInBand` in `app/`:
  4 suites, 105 passed, 1 skipped. The full `test:upgrade` run was not repeated.
- `jg` was tried once and returned "discovery incomplete" (provider HTTP 402), so the rest is grep and `git show`.

Abbreviations: `T/` is `app/__tests__/`, `L/` is `app/shared/lib/`. Fixture names are `E07` … `E20`.

A constraint that shapes every suggestion below: **E1 to E19 are frozen by hash** over `asyncStorage`,
`secureStore`, `sqliteDatabases` and `files` (`T/releaseFixturesFrozen.test.ts:34`, `T/releaseFixtures/frozen.ts`).
Facts and kept lists are not hashed. So a new *fact about a key that is already there* can be added to an old
fixture; a new *key* can only go into E20 (still unfrozen) or into a separate test that builds on a fixture.

## (a) Row by row

Epoch columns give the fixtures that hold the key (verified from the dump), not the map's claim, where they differ.

### Stores, keys, secrets and files

| Durable thing | Fixtures holding it | Status | Evidence |
| --- | --- | --- | --- |
| Redux `persist:SOVRAN`, whole root | E1–E20 (every fixture) | COVERED | Kept byte for byte in all 20. RF "keeps the phrase and makes no new one" passes for E1–E6, which have no SecureStore at all, so the phrase is adopted from the row. `T/secureStorageLifecycle.test.ts` "a phone coming straight from a redux-era release" (9 cases). |
| Redux Nostr profiles: phrase, nsec, identity | E1–E6 (in the row) | COVERED for phrase and account 0 key; GAP for contacts, follows, messages, search | RF "opens every account with the key it had" for E1–E6. No fact, no reader and no known gap for the social data in the row: it is kept, not imported. Fixtures hold one redux profile only; several redux profiles are covered only by `T/legacyEcashClaim.test.ts` "old profiles and accounts" (8 cases). |
| Redux Cashu profiles: proofs, counters, mints | E1–E11 (`reduxEcash`) | COVERED (read); device for the swap | RF "keeps the ecash in the redux row" (`readLegacyEcash` finds exactly the per-mint amounts). Claiming: `T/legacyEcashClaim.test.ts` (about 60 cases). Counters and transactions in the row: not imported, no test. |
| Redux settings, pricelist, Bitrefill, VPN, eSIM | E1–E6 (in the row) | PARTLY | Row kept; nothing reads these reducers and no fact says they are lost. No `knownGaps` entry records the loss as accepted. |
| `persist:root` | none | GAP (nothing to lose) | No fixture holds it; no reader at HEAD (grep: no hit outside docs). Written only by `stores/migrateSettings.ts:97@bab1c891f`. |
| `user_mnemonic` | E7–E20 | COVERED | RF "keeps the phrase and makes no new one"; kept in E7–E20. |
| `derived_keys_<index>` | E14–E20 (indexes 0, 1) | COVERED | RF "opens every account with the key it had". E14–E16 carry the old 31-multiplier hash tag (`E14-0.0.61.ts:22`, `E15-0.0.62.ts:24`), so the hash transition the map says is untested is exercised. `T/accountIntegrityBoundaries.test.ts` "the install $epoch left" runs E17–E19. |
| `cashu_mnemonic_<index>` | E14–E20 (0, 1; imported from E15) | COVERED | As above; kept byte for byte from E17. `accountIntegrityBoundaries` asserts `cache.wallet-phrase` passes for E17–E19. |
| `cashu_seed_<index>` | E15–E20 | COVERED E17–E19; PARTLY E15–E16 | `accountIntegrityBoundaries` asserts `cache.wallet-seed` passes for E17–E19. In E15–E16 the cache is on disk with the old tag (`E15-0.0.62.ts:32–44`) and nothing reads it: RF does not open a wallet. Loss is a re-derivation, not money. |
| `imported_nsec_<pubkey>` | E15–E20 | COVERED | Kept; RF opens account 112058190 with the imported key in six fixtures. `T/loadAccountKeys.test.ts` "an imported profile" (10 cases). |
| `migrations_complete` (bare) | none | n/a (inferred never written) | Only ever a name in a delete list: `helper/secureStorage.ts:11,140,264@a838d5bc3`; no writer found at `bab1c891f`, `99eb79aaa`, `59a27ff7a`, `c998c51cf`. The map's "E7–E18" is not supported by the source read here. |
| `migrations_complete_<index>` | E14–E20 | COVERED (tombstone) | On disk; RF "changes nothing on a later launch" shows they are left alone. Deleted by Delete All: `T/secureStorageLifecycle.test.ts` "clears caller and indexed orphan keys, deleting the index last". |
| `secure_key_index` | E17–E20 | COVERED | Same test; E20 index also lists the vault manifests. |
| `settings-store` | E7–E20 | COVERED | Fact "the accepted terms" from E7; ten settings facts by E19. Also `T/settingsStorePersistResilience.test.ts`, `T/releaseUpgrade.test.ts`. |
| `mint-store` | bare E7–E14, `:profile:<i>` E12–E14, `:profile:<pk>` E15–E20 | COVERED | Fact "the selected mint" from E7, per account from E12; `standingQuotes`, `receiveMintByMethod` from E19. Bare-key path: `T/preProfileUpgrade.test.ts`. |
| `pricelist-store` | E7–E20 | COVERED | Fact "the cached price" from E7. |
| `audit-mint-store`, `kym-mint-store` | E8–E17 | COVERED | Read through `mint-metadata-store` facts from E8 ("the audit counts of the mint"). |
| `mint-profile-store` | E15–E17 | COVERED | Fact "the follower count of a mint" (E15). |
| `mint-info-cache` | E17 | COVERED | Facts "the cached name / icon of a mint", "that the four mint caches were folded in" (E17). |
| `btcmap-store` | row E9–E19, cache file E20 | COVERED | Facts from E9; E20 holds `cache/store-btcmap-store.json` in `files`. `T/fileCacheStorage.test.ts`. |
| `routstr-store` | bare E8–E14, index E12–E14, pubkey E15–E20 | COVERED | Fact "the Routstr key" from E8, read through the real secure adapter and vault; six facts for account 0 and three for account 1 by E19. Oversized: `T/routstrOversizedUpgrade.test.ts` (7 cases). Still open: F88. |
| `scan-history-store` | E10–E20 | COVERED | Facts from E10, three accounts from E15. Oversized: `T/scanHistoryUpgrade.test.ts` (6 cases). |
| `transaction-location-store` | E10–E20 | COVERED | Fact "where a payment was made" from E10. |
| `profile-store` | E12–E20 | COVERED | RF account checks; facts from E12; imported `source` from E15. |
| `mint-distribution-store` | E12–E20 | COVERED | Fact "the mint split of account 0" from E12. |
| `search-history-store` | E12–E20 | COVERED | Fact from E12. Oversized old fields: no test (see (b) 9). |
| `swap-transactions-store` | E12–E20 | COVERED for a finished swap | Facts from E12. Every fixture's group is `state: 'finished'` (`E19-0.1.2.ts:162`); an unfinished swap is not held. |
| `npc-mint-store` | E13–E20 | COVERED | Fact from E13. |
| `nostr-social-store` | E14–E20 | COVERED | Facts from E14, three accounts from E15. |
| `global-migrations-completed` | E15–E20 | COVERED | Held; RF runs `migrateThenLoad` over it. `T/globalMigrationsRunner.test.ts` "upgrading from a released build" (3 cases). |
| `profile-transition-in-progress` | none | GAP (small) | No fixture; `T/profileTransitionLock.test.ts` covers taking and releasing the guard. Nothing tests `clearTransitionGuardOnStartup` (`L/profile/profileTransition.ts:79`, called at `shared/providers/AccountProviders.tsx:184`). |
| `wallet-lifecycle` | E16–E20 | COVERED for `not-needed`; GAP for a restore in progress | Facts from E7 (stamped by migration). Every fixture holds `restoreStatus: 'not-needed'`. Pending, in-progress and failed are covered only at the migration: `T/lifecycleStampMigration.test.ts` `it.each(['pending','in-progress','failed','complete'])`, `T/releaseUpgrade.test.ts` "preserves the wallet restore decision". |
| `wallpaper-store` | E16–E20 | PARTLY | Fact "the wallpaper catalogue" only. `downloaded` is dropped when the image file is missing and the runner has no such file (`E19-0.1.2.ts:1078`). |
| `theme-store` | E16–E20 | COVERED (the loss is recorded) | E16–E18 choices are reset on purpose: known gaps, `accepted`. E19–E20 facts pass. `T/themeStoreMigrate.test.ts`. |
| `split-bill-transactions-store` | E16–E17 | COVERED as kept; unread | Kept byte for byte (`E17-0.1.0.ts:1250`, FOLLOWUP F89). No reader: F89 is open. |
| `transaction-distribution-store` | E16–E20 | COVERED | Fact from E16. |
| `bitchat-dm-messages-store` | E17–E20 | COVERED | Fact from E17. Restart demotion: `T/bitchatDmMessages.test.ts:228`. |
| `nostr-metadata-cache` | E17–E20 | COVERED | Fact from E17. |
| `send-reachability-store` | E17–E20 | COVERED | Fact from E17. |
| `nip04-cache:v1:<pk>`, `nip04-cache-neg:v1:<pk>` | E17–E20, account 0 only | PARTLY | Kept, never hydrated by RF. `T/pubkeyScopedCache.test.ts` "hydrate adopts valid saved entries" uses today's shape, not a cited released one. |
| `nip17-unwrap-cache:v1:<pk>`, `-neg` | none | GAP (cache) | No fixture holds it. Prefix unchanged since `shared/lib/nostr/giftWrapCache.ts:6@88fad9741`. |
| Whitenoise `whitenoise:<accountIndex>:<ns>:<key>` | none | GAP in fixtures; envelope pinned elsewhere | `T/whitenoiseStorage.test.ts` (pass 0 characterization) pins the `{v:1,d}` envelope, scoping and the wipe. See (b) 3. |
| `mint-metadata-store` | E18–E20 | COVERED | Facts from E8 (through the import) and E18 (own row). |
| `mempool-address-cache` | E18–E20 | COVERED | Fact from E18. |
| `data-migration-store` | E18–E20 | COVERED | Facts for all three accounts. |
| `transaction-annotation-store` | E18–E20 | COVERED | Fact from E18. |
| `own-content-store` | E18–E20 | COVERED for a confirmed note | Fact from E18. A pending publish is not held (`status: 'confirmed'`, `E19-0.1.2.ts:710`). |
| `owned-media-store` | E18–E20 | COVERED | Fact from E18. |
| `recent-people-store` | E18–E20 | COVERED | Fact from E18. |
| `nut-drop-redeem-queue` | E18–E20 | COVERED | Fact "the unredeemed nearby token of account 0" (a queued token, `status: 'untrusted-mint'`). Over-limit entry: repaired since this survey (`T/releasedWriterBounds.test.ts`, section 10). |
| `feed-ignore-store`, `notification-policy-store` | E18–E20 | COVERED | Four and two facts from E18. |
| `nip46-connections-store` | E18–E20 | COVERED | Three facts from E18 (app, standing permission, standing refusal). |
| `nip46-activity-store` | E18–E20 | COVERED in E20; accepted loss in E18–E19 | Old entries age out after 30 days by design (known gap, `accepted`); E20 uses a year-2100 entry and passes. |
| `nip46_bunker_secrets_<pubkey>` | none | GAP (nothing to lose) | Schema identical at `features/nostrSigner/lib/bunkerSecrets.ts:39–47@4203ea8ec` and HEAD; ten-minute bearer tokens. `T/nip46BunkerSecrets.test.ts` covers self-heal. |
| `nip46-pending-pairing` (AsyncStorage) | none | COVERED by another test | `T/nip46PairingIntentStorage.test.ts` "the row older builds left in plain storage" (3 cases): never read, removed on the next take or clear. An upgrade drops a pairing in flight, by design. |
| `npc_since:profile:<pubkey>` | E17–E20, accounts 0 and 1 | PARTLY | Kept; nothing reads it back through `AsyncStorageSinceStore` (`L/cashu/npc.ts:99`). No test of the reader found. |
| `relay-metadata-store` | E19–E20 | COVERED | Fact from E19. |
| `nostr-media-server-store`, `nostr-relay-list-store` | E18–E20 | COVERED | Facts from E18, relay list for two accounts. |

### Files and HEAD-only additions

| Durable thing | Fixtures holding it | Status | Evidence |
| --- | --- | --- | --- |
| `document/vpn_<hash>.conf` | none | GAP (nothing to lose) | No reader, no fixture; E1–E6 hold only `persist:SOVRAN`. |
| `document/wallpapers/<theme>.png` | none | GAP (device) | The runner's file mock is empty. `T/wallpaperStorage.test.ts` covers download and promotion, not an upgrade. |
| `document/sovran-logs/*` | none | GAP (logs) | RF mocks `loggerFile` out. `T/loggerFile.test.ts` is not an upgrade test. |
| Native-harness document files | none | n/a | Harness only. |
| `cta-store`, `mint-testnut-store` | E20 | COVERED | Two facts each. |
| `ai-provider-directory-store`, `dm-last-message-store`, `own-profile-metadata-store` | E20 | COVERED | Facts for account 0. |
| `vertex-budget-store` | E20 (accounts 0, 1) | PARTLY | Kept only: made per account on demand, so nothing loads it at startup (`E20-0.1.4.ts:138`). `T/vertexBudgetStore.test.ts`. |
| `mint-changes-cache`, `mint-discover-cache`, `own-profile-stats-cache` | E18–E20 (stats), E19–E20 (changes), E20 (discover) | COVERED (accepted) | Default rows in E20; known gaps `accepted` in E18–E19. Note the map dates these E20; the fixtures show `own-profile-stats-cache` from 0.1.1 and `mint-changes-cache` from 0.1.2. |
| `ui.settledHeaderHeight.v1` | none | GAP (UI cache) | No fixture, nothing to lose. |
| Secure vault `routstr_v1_<pk>_<sha>_manifest` and chunks | E20 (three accounts) | COVERED for `routstr-store` | Written by this build into `E20-0.1.4.upgraded.json`; read back by the Routstr facts. `T/routstrSecureVault.test.ts`, `T/routstrSecurePersistence.test.ts`. Device: F42. |
| `routstr-sdk:<key>:profile:<pk>` and its four vaults | none | GAP | See (b) 1. `T/routstrSecurePersistence.test.ts` "keeps SDK recovery writes bound to their captured owner" uses today's code on both sides. |
| Secure `nearby-payment-journal` | none | GAP | See (b) 1. `T/nearbyPayments.test.ts` (8 cases) uses today's code on both sides. |
| `legacy-ecash-store` | E20 | COVERED | Fact "the record of an old Lightning receive that was looked at". |

## (b) Real gaps, ranked by what the person would lose

1. **Money: what 0.1.4 writes outside the store registry is in no fixture.** E20 is the 0.1.4 fixture and will be
   frozen when 0.1.5 work starts. It holds no `nearby-payment-journal` vault (inbound and outbound payment bytes
   awaiting delivery; a malformed journal throws rather than resetting, `app/features/nearPay/lib/nearbyPayments.ts:95@HEAD`)
   and no Routstr SDK vaults (`api_keys`, `child_keys`, `xcashu_tokens`, `cached_receive_tokens`,
   `L/routstr/sdk/driver.ts:16–21@HEAD`). The completeness test walks `storeRegistryManifest` only
   (`T/releaseFixturesCompleteness.test.ts:95`), so nothing fails for their absence.
   Smallest addition: write one journal and one SDK record through `createSecureVault` with this build, add the
   resulting SecureStore rows to E20, and add a test beside RF that reads them back through `NearbyPaymentJournal`
   and `createSdkStorageDriver` after `launch()`. Shapes: `nearbyPayments.ts:57@HEAD` (`version: z.literal(1)`),
   `driver.ts:14@HEAD`; cite them at the release commit when it is cut. Then make the completeness test require a
   row or a reason for each entry of `secureStoreFiles` in `T/fixtures/persistence-surface.json`.

2. **Keys and money safety: `profile-store` fields added after the E20 disk was generated.** `walletDatabaseCreated`
   (decides whether an empty wallet database asks for a restore) and `walletPhraseFingerprint` (which phrase an
   imported account's wallet was made from) are at `app/shared/stores/global/profileStore.ts:131,134@HEAD`. Neither
   appears anywhere in `T/releaseFixtures/` (grep: 0 hits). `swap-transactions-store` gained `mintOperationId`
   (`app/shared/stores/profile/swapTransactionsStore.ts:162@HEAD`), also absent. The README asks for "each field the
   release adds a value … with a fact for each"; no test enforces it at field level.
   Smallest addition: `withState('profile-store', …)` in `E20-0.1.4.ts` setting both fields on the right rows, and
   two facts (`profiles.0.walletDatabaseCreated`, `profiles.2.walletPhraseFingerprint`). Behaviour is otherwise
   covered by `T/walletDatabaseLost.test.ts` and `T/profileWalletPhraseFingerprint.test.ts`.

3. **Keys: Whitenoise group state and key packages (0.1.0 on) are in no fixture.** The key is
   `whitenoise:<accountIndex>:<namespace>:<key>` while everything else per account moved to the pubkey.
   What was verified:
   - The storage code is blob-identical from 0.1.0 to HEAD (`asyncStorageBackend.ts` is `ecb6de15d` at `88fad9741`,
     `4203ea8ec`, `v0.1.3` and HEAD; only `namespaces.ts` changed, between 0.1.1 and 0.1.3). The vendored
     `marmot-ts` tree is `d2fd68e41` at all four. So the pass 0 test pins the released envelope by identity.
   - Removing an account at HEAD deletes its prefixes (`L/profile/profileRemovalStorage.ts:289–311`; asserted in
     `T/removeProfile.test.ts:161–174`), its `nostr-<i>` database and its wallet database. Delete All wipes every
     index (`L/profile/profileSessionOrchestrator.ts:633`).
   - No release could remove a single account: `removeProfileData` does not exist at `v0.1.3` (grep), so no
     released install has orphaned index rows from a removal.
   - Indexes are stored on the profile row, not positional, so reordering cannot change them. A derived index is
     reused after the highest account is removed (`profileStore.ts:296–301`: max + 1), which is safe because the
     same phrase derives the same key at that index and the rows were wiped. An imported account's index is
     `pubkey mod 2^31` (`L/nostr/keyDerivation.ts:124`), stable across re-import.
   - Inferred, not verified: an imported index can equal a derived index with probability about n / 2^31, and
     nothing was found that checks for it on import. The same collision would share `coco-<i>.db` and `nostr-<i>`.
   Smallest addition: one `whitenoise:0:group-state:<hex>` and one `whitenoise:1:dm-index:<pk>` row in E20 with
   both in `keptAsyncStorage`, shapes from `features/whitenoise/storage/namespaces.ts:8–27@88fad9741` and
   `asyncStorageBackend.ts:59@88fad9741`. That catches a migration that renames or sweeps the prefix. The MLS
   content itself needs a device. The feature is off by default (`whitenoiseEnabled`, `settingsStore.ts:191`).

4. **Money path: a restore that was pending, running or failed at upgrade is in no fixture.** All five fixtures with
   a lifecycle row (E16–E20) hold `not-needed`; E7–E15 have no row and are stamped by the migration. The enum is `walletLifecycleStore.ts:36–37@d9ad12c4b`. The migration is
   tested; the whole launch is not. Smallest addition, without touching frozen data: a test that spreads E19,
   overrides `wallet-lifecycle.state.restoreStatus` with each of the three and runs RF's `launch`, expecting the
   status unchanged after three starts. The same "variant of a frozen fixture" shape serves items 5 and 6.

5. **Operations in flight in the app's own stores.** Not held: an unfinished swap group, a pending own-note
   publish, a sending nearby message (the E17 pending rows are split-bill participants, `E17-0.1.0.ts:198`).
   Held: a queued nut-drop token (E18–E20), a reusable receive quote (E19–E20), and in the Coco databases a
   prepared send, a pending melt, a pending mint and a prepared receive (`T/cocoDatabases/README.md:51–54`,
   `T/cocoDatabaseUpgrade.test.ts` "keeps every operation, with what it needs to finish or roll back").
   Other tests: `T/bitchatDmMessages.test.ts:228`, `T/ownContentStore.test.ts:53`,
   `T/nutDropRedeemQueueStore.test.ts:128`. Swap resume is F139 (open).

6. **A store at its size limit.** Covered for `routstr-store` (`routstrOversizedUpgrade`, `persistedCapacity`),
   `scan-history-store` (`scanHistoryUpgrade`), `profile-store` (`profileStoreCapacity`). Characterized as a
   loss for `nut-drop-redeem-queue` when surveyed; repaired since. Not covered for the other bounded stores, `search-history-store`
   among them, which the map itself flags; F48 (open) is the general entry. Not audited store by store here.

7. **Coco's `.pre-v2` backup files** (`SQLite/coco*.db.pre-v2`, `-wal`, `-shm`): a copy of spendable proofs, written
   since 0.1.2 (`app/shared/lib/cashu/manager.ts:152@d9ad12c4b`), and **absent from the map's tables**. Tested:
   `T/cocoBackupLifecycle.test.ts` (4 cases), `T/cocoDatabaseUpgrade.test.ts` "keeps a copy of a pre-v2 database".
   A documentation gap, not a test gap.

8. **Things only a device can show** (the runner's stated limits): the NDK cache `nostr`, `nostr-<i>` (name pinned
   by `T/releasedPersistedSurface.test.ts` source pin; nothing opens an old file; F77), the real keychain (F42,
   F111), wallpaper images, logs. `@nostr-dev-kit/ndk-mobile` is `^0.2.2` since 0.0.58 and resolves to 0.2.2
   (`bun.lock:893`), but it is not in `STORAGE_LIBRARIES` (`T/persistenceSurface.test.ts:30`), so a bump that
   changes the cache schema turns nothing red. One line fixes that.

9. **Low value, nothing lost:** `nip17-unwrap-cache` rows and other accounts' `nip04-cache` rows (add to E20 kept
   list); `npc_since` reader (a reset refetches from 0); `profile-transition-in-progress` startup clear (a marker
   under ten seconds old blocks a switch, `profileTransition.ts:33`); `persist:root`; `vpn_*.conf`.

10. **The surface scan has blind spots** that let a durable addition through. `T/fixtures/persistence-surface.json`
    records AsyncStorage keys only when the call has a string literal, so it lists 8 keys and misses every key
    passed as a constant (`nip46-pending-pairing`, `npc_since:…`, `profile-transition-in-progress`,
    `global-migrations-completed`, `persist:SOVRAN`, the Whitenoise prefixes). Secure keys come only from
    `STORAGE_KEYS` in `secureStorage.ts`, so `nip46_pending_pairing`, `nip46_bunker_secrets_`, `nearby-payment-journal`
    and the vault prefix are not listed. Database names need a `.db` suffix, so `nostr` and `nostr-<i>` are not
    listed. Files on disk are not scanned. A new key in a file that already touches storage passes silently.

State space, in one table:

| State | In a fixture | Other test |
| --- | --- | --- |
| Several accounts, one imported | E15–E20 (0, 1, 112058190); active account varies (0, 1, imported) | `accountIntegrityBoundaries` over E17–E19 |
| An account removed | No. No release could do it | `T/removeProfile.test.ts` (about 30 cases) at HEAD; killed partway is F92 (open) |
| Pending send, melt, receive | Coco database files only | `cocoDatabaseUpgrade` |
| Queued nut-drop redeem | E18–E20 | `nutDropRedeemQueueStore`, `nutDropRedeemQueueOversize` |
| Pending NIP-46 pairing | No | `nip46PairingIntentStorage` (dropped by design) |
| Profile transition marker | No | Guard only; startup clear untested |
| Restore pending | No | `lifecycleStampMigration`, `releaseUpgrade`, `restoreGateDecision` |
| Store at its limit | No | See item 6 |
| Secrets present, stores missing | E1–E11 lack `profile-store`; reinstall case not in a fixture | `T/migrateThenLoad.test.ts:124` "a reinstall: the keychain survived and storage is empty"; `lifecycleStampMigration:109` |
| Stores present, secrets missing | No | `secureStorageLifecycle` "does not replace a missing root beneath saved or unreadable account data"; `preProfileUpgrade` "when the phrase cannot be used"; `walletDatabaseLost` |
| Wallet database for an unlisted account | No | None; F91 (open) |

## (c) Stale cells of the map

The map states that it records the candidate before the audit's fixes, so some of this is by design. These cells
would mislead a reader today.

"NO TEST" cells that should cite RF and the fixture range from table (a): Redux row (all four), `derived_keys`,
`cashu_mnemonic`, `imported_nsec`, `migrations_complete_<i>`, `mint-store`, `scan-history-store` (also
`scanHistoryUpgrade`), `routstr-store` "NO TEST for failures below" (now `routstrOversizedUpgrade`,
`preProfileUpgrade`, `routstrFirstLaunch`), `profile-store` "Redux-only profiles" (`secureStorageLifecycle`
redux-era cases, `legacyEcashClaim`), `mint-distribution-store`, `search-history-store`, `npc-mint-store`,
`wallpaper-store` (catalogue only), `split-bill-transactions-store` (kept, F89), `bitchat-dm-messages-store`,
`nostr-metadata-cache`, `send-reachability-store`, `mempool-address-cache`, `own-content-store`,
`owned-media-store`, `recent-people-store`, `nut-drop-redeem-queue`, `feed-ignore-store`,
`notification-policy-store`, `nip46-connections-store`, `nip46-activity-store`, `relay-metadata-store`,
`nostr-relay-list-store`, and the E20 rows marked "NO old value to migrate" that now have E20 facts.

Cells whose content is wrong at HEAD:

- `nip46-pending-pairing`: the map says HEAD reads the AsyncStorage key (`pairingIntentStorage.ts:75@HEAD`). Since
  `67e38b085` (2026-10-12) the intent lives in SecureStore under `nip46_pending_pairing` and the old row is only
  removed (`pairingIntentStorage.ts:31–33`). The new secure key is in no row of the map.
- Redux rows: "No reader", "Ignored, left on disk". HEAD adopts the phrase from the row
  (`L/nostr/secureStorage.ts`, `readReduxEraRoot`) and claims its ecash, then removes the row
  (`L/cashu/legacyEcashClaim.ts`). The E21 row at the bottom says so; the E1–E14 rows do not.
- `legacy-ecash-store` is labelled E21, but there is no E21 in the epoch table and the store is in the E20 fixture.
  E20's `commit` is `5651d4720`, which predates the store.
- Query caches are labelled E20-new; fixtures written from the old source hold `own-profile-stats-cache` at 0.1.1
  and `mint-changes-cache` at 0.1.2.
- `migrations_complete` (bare) "E7–E18": no writer found; see table (a).
- `send-reachability-store` is labelled E17+ with evidence at `4203ea8ec` (0.1.1); the E17 fixture holds it.
  `npc_since` is labelled E18+; the E17 fixture holds it, citing `L/cashu/npc.ts:39,58`.
- Test line numbers have drifted, for example `T/secureStorageLifecycle.test.ts:126,208,232,248` are now 202,
  609, 633, 649. Case names still match.
- Missing rows: the `.pre-v2` backup files; `walletDatabaseCreated`, `walletPhraseFingerprint`, `mintOperationId`;
  `<name>:unreadable[:profile:<pk>]` copies appear only in the prose above the table (F72).
- `evidence-ledger.md` "Not covered at all" still says no Coco database from 0.6.0 to rc.47 exists to test with;
  `T/cocoDatabases/` now has all eleven.

## (d) `knownGaps`

Every entry is `followUp: 'accepted'`. None names a follow-up id, so there is nothing to check for open or closed.
E1–E6, E12–E15 and E20 have none.

| Fixtures | `what` | Follow-up | Why (from the fixture) |
| --- | --- | --- | --- |
| E7, E8, E9, E10, E11 | the wallpaper theme | accepted | Choices before theme-store version 2 are reset on purpose; with no account list the settings theme is dropped without being moved |
| E16 | theme-store | accepted | Same reset |
| E17, E18 | theme-store; the light appearance of account 0; the wallpaper of account 0; the wallpaper album of account 0; the wallpaper of account 1; the light appearance of the imported account | accepted | Same reset |
| E18, E19 | nip46-activity-store; the signer activity of account 0 | accepted | Activity older than 30 days is dropped on load, as the release did |
| E18, E19 | own-profile-stats-cache; the cached follower counts of its own accounts | accepted | Query caches are emptied on every account switch and fetched again |
| E19 | mint-changes-cache; the cached mint changes | accepted | Same |

Related, not a `knownGaps` entry: `E17-0.1.0.ts:1250` carries `FOLLOWUP(F89)` on the kept split-bill row.
`docs/follow-ups/F89.md` exists and is listed as open (medium, decision). F138 (open) notes that the theme reset
and the 0.0.1–0.0.12 seed difference are accepted losses with no entry of their own.

Losses that are real, visible in the fixtures, and recorded nowhere as a known gap: the Redux social data and
settings in E1–E6 (kept on disk, never imported, no fact and no gap entry).

## (e) Not read

- The fixture files E01–E19 line by line. Their keys, facts, kept lists and gaps were dumped programmatically;
  individual row shapes and their `path:line@commit` citations were not checked against the old source.
- `docs/architecture/persistence/audit-2026-10-10/`, `epoch-diff.txt`, `release-provenance.md`, `derivation.md`,
  `store-builds.tsv`, `docs/architecture/account-lifecycle.md` (one line only), the ADRs.
- Follow-up files other than the README index, F89 and F138. "Open" means the file exists and is in the index.
- Test bodies beyond their case titles, except where a line is cited. Coverage claims for "other test" columns
  rest on titles for `removeProfile`, `nearbyPayments`, `routstrSecurePersistence`, `restoreGateDecision`,
  `ownContentStore`, `walletDatabaseLost`.
- Whether a Routstr vault with no store row, or a store row with no vault, is handled: not checked.
- Whether importing an nsec checks its derived index against existing accounts: not found, not proven absent.
- Bounded schemas store by store (item 6).
- `wallet/` and `nostr/` packages for durable writes of their own; `persistenceSurface` scans them and its record
  lists none.
- The NDK cache adapter's schema and what an old cache holds beyond refetchable data.
- `surface.sh` was not rerun; the two saved outputs in the session scratchpad were compared after stripping line
  numbers. Durable changes found that way since the map: `legacy-ecash-store`, the pairing intent's move to
  SecureStore, `walletDatabaseRecord.ts` writing `profile-store`, the leftover-store adoption migration, removal
  of `persist:SOVRAN` by the claim, and `document/e2e/runner.json` (harness). Whether the default build includes
  `nearPay` (ADR 21) was not checked.
