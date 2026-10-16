**FAIL — source-traced upgrade failures.** Candidate: `HEAD = 5651d4720d90b6e4e3f4b40c0c986760dfc1c481`.

Tests and device upgrades: **NOT RUN — read-only role**. Existing tests below are coverage leads, not passing evidence. Audit documents were not modified.

Path abbreviations used below:

- `G/` = `app/shared/stores/global/`
- `P/` = `app/shared/stores/profile/`
- `L/` = `app/shared/lib/`
- `T/` = `app/__tests__/`

### 1. Epoch table

Neighbouring supplied dumps were compared after removing line-number noise, then their persistence declarations were read in Git. Additional version-history commits exposed boundaries missing from the dumps. These are source discovery epochs; exact shipped commits and changes inside unbounded release intervals still require the release historian.

| Epoch | Version range | Representative commit | Durable surface change and evidence |
|---|---|---|---|
| E1 | 0.0.1–early 0.0.2 | `957eed9ea` | Redux `SOVRAN`, version 30; no whitelist. Cashu uses the HD child’s **raw 32-byte private key** as seed. `helper/redux/store/index.ts:95@957eed9ea`; `helper/cashu/wallet.ts:37@957eed9ea`. |
| E2 | Later 0.0.2; subsequent 0.0.1 builds; 0.0.11–0.0.12 | `7327ed3b6` | Redux version 40; raw-child Cashu seed remains. `helper/redux/store/index.ts:239@7327ed3b6`; `helper/cashu/wallet.ts:36@7327ed3b6`. |
| E3 | 0.0.13 | `26162bd91` | Redux version 72; Cashu switches to BIP39 seed from stored `nut13` mnemonic. `helper/redux/store/index.ts:271@26162bd91`; `helper/cashu/wallet.ts:43@26162bd91`. |
| E4 | 0.0.17–0.0.18 | `47dda63e7` | Redux version 74. `helper/redux/store/index.ts:275@47dda63e7`. |
| E5 | 0.0.21 | `d4aa2a883` | Redux version 91. `helper/redux/store/index.ts:322@d4aa2a883`. |
| E6 | 0.0.22–0.0.24 | `a09fe2d54` | Redux version 120; migration 101 recomputes `nut13` using profile-array index. `helper/redux/store/index.ts:274@a09fe2d54`; `helper/redux/store/index.ts:353@a09fe2d54`. |
| E7 | 0.0.45 | `bab1c891f` | Redux version 251; mnemonic-to-SecureStore migration 151, settings migration 152; bare Zustand mint/settings/pricelist stores; Coco `coco.db`. `redux/store/index.ts:479@bab1c891f`; `stores/settingsStore.ts:200@bab1c891f`; `helper/coco/manager.ts:84@bab1c891f`. |
| E8 | 0.0.51 builds 1–4 | `3d34a34bd` | Adds audit, KYM and Routstr stores. `stores/auditMintStore.ts:90@6d67b2ead`; `stores/kymMintStore.ts:89@6d67b2ead`; `stores/routstrStore.ts:392@6d67b2ead`. Earlier builds’ names were verified with `git grep`. |
| E9 | 0.0.51 builds 5–9 | `6d67b2ead` | Adds BTCMap cache. `stores/btcMapStore.ts:346@6d67b2ead`. |
| E10 | 0.0.52 | `8d56486bf` | Adds scan history and transaction locations; settings gains P2PK/location preferences. `stores/scanHistoryStore.ts:166@8d56486bf`; `stores/transactionLocationStore.ts:91@8d56486bf`; `stores/settingsStore.ts:239@8d56486bf`. |
| E11 | 0.0.53–0.0.56 | `99eb79aaa` | Scan history includes transaction linking. `stores/scanHistoryStore.ts:36@99eb79aaa`; `stores/scanHistoryStore.ts:159@99eb79aaa`. |
| E12 | 0.0.58 | `59a27ff7a` | Adds profile list, mint distributions, search history and swaps. Account 0 uses bare keys; others use `:profile:<index>`. `stores/profileStore.ts:119@59a27ff7a`; `helper/profileScopedStorage.ts:31@59a27ff7a`. |
| E13 | 0.0.60 | `c998c51cf` | Adds NPC mint selection; additional settings. `stores/npcMintStore.ts:122@c998c51cf`; `stores/settingsStore.ts:375@c998c51cf`. |
| E14 | 0.0.61 | `a838d5bc3` | Adds social store, derived-key/Cashu-mnemonic caches and per-account migration markers; profile blob gains `cocoMigrationComplete`. `stores/nostrSocialStore.ts:320@a838d5bc3`; `helper/secureStorage.ts:7@a838d5bc3`; `stores/profileStore.ts:138@a838d5bc3`. |
| E15 | 0.0.62 | `19388f0e3` | Profile keys become `:profile:<pubkey>`; global migration marker; imported-nsec and Cashu-seed records; mint-profile cache. `shared/lib/migrations/globalMigrations.ts:41@19388f0e3`; `shared/lib/nostr/secureStorage.ts:9@19388f0e3`; `shared/stores/global/mintProfileStore.ts:67@19388f0e3`. |
| E16 | 0.0.63 | `28bf7713a` | Adds lifecycle, wallpaper files/store, profile themes, split-bill groups and transaction distribution. `shared/stores/global/walletLifecycleStore.ts:52@28bf7713a`; `shared/stores/global/wallpaperStore.ts:271@28bf7713a`; `shared/stores/profile/splitBillTransactionsStore.ts:409@28bf7713a`. |
| E17 | 0.1.0 | `88fad9741` | Schema-backed `persistConfig`, normally version 1; mint/NPC version 2; secure-key index; BLE messages, metadata/decryption caches and Whitenoise storage. `shared/stores/profile/mintStore.ts:62@88fad9741`; `shared/lib/nostr/secureStorage.ts:12@88fad9741`; `features/whitenoise/storage/asyncStorageBackend.ts:59@88fad9741`. |
| E18 | 0.1.1 | `4203ea8ec` | Consolidates four mint caches; adds signer stores/secrets, feed policies, own-content/media, redemption queue, annotations and data-migration level; social version 2, settings version 3. `shared/stores/global/mintMetadataStore.ts:365@4203ea8ec`; `shared/stores/profile/dataMigrationStore.ts:41@4203ea8ec`; `shared/stores/global/settingsStore.ts:418@4203ea8ec`. |
| E19 | 0.1.2–0.1.3 | `148ebd085`, `d9ad12c4b` | App moves under `app/`; profile/theme version 2, settings version 4; relay metadata. Supplied surfaces differ only in app version/build fields. `G/profileStore.ts:127@HEAD`; `P/themeStore.ts:62@HEAD`; `app/shared/stores/global/relayMetadataStore.ts:123@148ebd085`. |
| E20 | HEAD, 0.1.4 | `5651d4720` | Routstr version 3 and secure vaults; BTCMap moves to cache file; rejected durable blobs get preservation copies; additional stores and nearby-payment journal. `P/routstrStore.ts:1487@HEAD`; `G/btcMapStore.ts:319@HEAD`; `L/persist/preserveUnreadable.ts:63@HEAD`; `app/features/nearPay/lib/nearbyPayments.ts:83@HEAD`. |

### 2. Item table

Common reader behavior:

- HEAD profile key: `<name>:profile:<pubkey>`; bare-key fallback exists only without a profile. `L/cashu/profileScopedStorage.ts:104@HEAD`, `:142@HEAD`.
- Index migration copies account-0 bare keys and other accounts’ numeric suffixes **only when `profile-store` already supplies their pubkeys**. Existing destination wins; old source is removed. `L/migrations/globalMigrations.ts:138@HEAD`, `:154@HEAD`.
- `persistConfig` defaults to version 1 and an **identity migration**, so legacy Zustand version 0 is not rejected merely for lacking a migrator. Schema rejection returns defaults; ordinary durable stores preserve the original at `<name>:unreadable[:profile:<pubkey>]` before overwrite. `L/persist/persistConfig.ts:135@HEAD`, `:174@HEAD`; `L/persist/preserveUnreadable.ts:63@HEAD`.

Each row applies from its listed introduction through later epochs unless its outcome says removed.

| Epoch | Item / released shape | Released shape evidence | HEAD reader | Outcome | Existing test |
|---|---|---|---|---|---|
| E1–E14 | Redux `persist:SOVRAN`; versions 30/40/72/74/91/120/251; **no whitelist**, whole root | `helper/redux/store/index.ts:95@957eed9ea`; `redux/store/index.ts:558@bab1c891f` | No reader; current registries are `L/migrations/globalMigrations.ts:336@HEAD`, `L/migrations/dataMigrations.ts:40@HEAD` | Ignored, left on disk; Redux migrations never run | **NO TEST** |
| E1–E14 | Redux Nostr profiles: phrase, nsec, root xpriv/xpub, `nut13`, identity/current profile; contacts/follows/messages/search | `app/onboard/animate.tsx:125@a09fe2d54`; `helper/redux/nostr/reducer.ts:85@a09fe2d54` | `L/nostr/secureStorage.ts:335@HEAD`; `G/profileStore.ts:288@HEAD` | No Redux import. HEAD reads SecureStore and Zustand instead | **NO TEST** |
| E1–E14 | Redux Cashu profiles: proofs, counters, mints, transactions; shared keys/keysets/info/audits | `helper/redux/cashu/reducer.ts:24@a09fe2d54`, `:60@a09fe2d54` | No Redux importer in `L/migrations/dataMigrations.ts:40@HEAD` | Ignored, left on disk; pre-Coco balances/pending data not imported | **NO TEST** |
| E1–E14 | Redux settings, pricelist, Bitrefill, VPN and eSIM state | `helper/redux/store/reducer.ts:16@a09fe2d54` | No Redux reader in current migration registries above | Ignored, left on disk | **NO TEST** |
| E7–E15 | `persist:root` compatibility/cleanup key | `stores/migrateSettings.ts:27@bab1c891f`, `:93@bab1c891f` | No HEAD reader; `G/settingsStore.ts:473@HEAD` reads `settings-store` | Ignored, left on disk. Actual Redux key was `persist:SOVRAN` | **NO TEST** |
| E7+ | SecureStore `user_mnemonic`: root phrase | `helper/secureStorage.ts:8@bab1c891f`, `:37@bab1c891f` | `L/nostr/secureStorage.ts:335@HEAD` | Same key read; valid BIP39 retained. Invalid/read-error records preserved; recovery path used | `T/secureStorageLifecycle.test.ts:126@HEAD`, case “keeps an existing valid seed without RNG or writes”; `:208`, corrupt-phrase case |
| E14+ | `derived_keys_<index>`: npub/nsec/pubkey/privateKeyHex/mnemonicHash | `helper/secureStorage.ts:167@a838d5bc3`, `:193@a838d5bc3` | `L/nostr/secureStorage.ts:628@HEAD`; `L/nostr/loadAccountKeys.ts:151@HEAD` | Matching cache read; old hash mismatch causes rederivation and overwrite | **NO TEST for every released cache shape** |
| E14+ | `cashu_mnemonic_<index>`: `{value,mnemonicHash}` | `helper/secureStorage.ts:171@a838d5bc3`, `:221@a838d5bc3` | `L/nostr/secureStorage.ts:644@HEAD`; `L/nostr/loadAccountKeys.ts:133@HEAD` | Matching cache read; mismatch rederived/overwritten | **NO TEST for historical hash transition** |
| E15+ | `cashu_seed_<index>`: cached BIP39 seed/hash | `shared/lib/nostr/secureStorage.ts:16@19388f0e3` | `L/nostr/secureStorage.ts:675@HEAD` | Read; invalid-length cache deleted and subsequently rederived | `T/secureStorageLifecycle.test.ts:232@HEAD`, “deletes a cached Cashu seed whose decoded length is not 64 bytes” |
| E15+ | `imported_nsec_<pubkey>` | `shared/lib/nostr/secureStorage.ts:17@19388f0e3` | `L/nostr/secureStorage.ts:716@HEAD`; `L/nostr/loadAccountKeys.ts:84@HEAD` | Same key read; decoded pubkey must match profile; otherwise recovery/re-import | **NO TEST for complete release-upgrade path** |
| E7–E18 | `migrations_complete`; later `migrations_complete_<index>` | `helper/secureStorage.ts:258@a838d5bc3`, `:263@a838d5bc3` | Tombstone only: `L/nostr/secureStorage.ts:694@HEAD` | Ignored on launch; retained until explicit deletion | **NO TEST for skipped unfinished Redux migration** |
| E17+ | `secure_key_index`: secret-key deletion inventory | `shared/lib/nostr/secureStorage.ts:26@88fad9741` | `L/nostr/secureStorage.ts:553@HEAD` | Retained/read for enumeration; newly written keys added | `T/secureStorageLifecycle.test.ts:248@HEAD`, “clears caller and indexed orphan keys, deleting the index last” |
| E7+ | `settings-store`: theme/language/display/experimental/terms; later currency, P2PK, location, onboarding/mock/routing preferences | `stores/settingsStore.ts:200@bab1c891f`; `:239@99eb79aaa`; `:344@59a27ff7a` | `G/settingsStore.ts:473@HEAD` | Versions 0–3 migrate to 4; developer/mock settings reset, ordinary settings retained; retired fields stripped. Global theme handled separately | `T/settingsStorePersistResilience.test.ts:207@HEAD`, developer-reset case; `:259`, legacy acceptance case |
| E7+ | `mint-store`: `selectedMints`; E17+ scalar `selectedMint` | `stores/mintStore.ts:103@bab1c891f`; `shared/stores/profile/mintStore.ts:62@88fad9741` | `P/mintStore.ts:165@HEAD`, migration `:89@HEAD` | Index keys renamed where profile list exists; v0/v1 picks first nonempty map value; v2 read with additive defaults | **NO TEST for all old maps/skipped bootstrap** |
| E7+ | `pricelist-store`: `{pricelist,lastUpdated}` | `stores/pricelistStore.ts:137@bab1c891f` | `G/pricelistStore.ts:107@HEAD` | Bare key retained; additive server timestamp defaults | `T/persistRoundTrip.test.ts:320@HEAD`, legacy-price timestamp cases |
| E8–E17 | `audit-mint-store`: `{cache}` | `stores/auditMintStore.ts:90@6d67b2ead` | `G/mintMetadataStore.ts:638@HEAD` | Imported into unified metadata; raw audit detail reduced to scalar summaries; old key deleted | `T/mintMetadataStore.test.ts:65@HEAD`, “merges the four legacy blobs into one entry and drops review rows” |
| E8–E17 | `kym-mint-store`: `{cache}` | `stores/kymMintStore.ts:89@6d67b2ead` | `G/mintMetadataStore.ts:683@HEAD` | Scores/counts imported; raw recommendations dropped; old key deleted | Same test above |
| E15–E17 | `mint-profile-store`: `{cache}` | `shared/stores/global/mintProfileStore.ts:67@19388f0e3` | `G/mintMetadataStore.ts:677@HEAD` | Followers/reputation imported; old key deleted | Same test above |
| E17 | `mint-info-cache`: `{byMintUrl}` | `shared/stores/global/mintInfoCache.ts:102@88fad9741` | `G/mintMetadataStore.ts:664@HEAD` | Identity imported; old key deleted | Same test above |
| E9+ | `btcmap-store`: places/detail caches | `stores/btcMapStore.ts:346@6d67b2ead` | `G/btcMapStore.ts:319@HEAD`; `L/persist/fileCacheStorage.ts:65@HEAD` | AsyncStorage value adopted into `cache/store-btcmap-store.json`; old row removed. Unreadable row dropped | `T/fileCacheStorage.test.ts:89@HEAD`, “takes over the row an earlier release wrote, and frees it”; `:101`, unreadable Android row |
| E8+ | `routstr-store`: API key/balance/chat/sessions; bare before E12, index-scoped E12–E14, pubkey-scoped E15+ | `stores/routstrStore.ts:392@6d67b2ead`; `:394@59a27ff7a`; `shared/stores/profile/routstrStore.ts:363@28bf7713a` | `P/routstrStore.ts:1487@HEAD`; `L/routstr/securePersistence.ts:68@HEAD` | Credentials copied/verified in secure vault, plaintext cleared; v0/v1→v3 issuer/prompt/provider migrations. **Bare pre-profile installs and oversized old sessions are unsafe**, below | `T/routstrSecurePersistence.test.ts:70@HEAD`, secure-copy case; `T/routstrStorePersistResilience.test.ts:155@HEAD`, one-session legacy case. **NO TEST for failures below** |
| E10+ | `scan-history-store`: full entries including raw/processed/type/source/date; transactionId added E11 | `stores/scanHistoryStore.ts:166@8d56486bf`; `:194@99eb79aaa` | `P/scanHistoryStore.ts:106@HEAD`, `:200@HEAD` | Normal entries read; processed field omitted from new projection. **Over 500 entries or raw over 16,384 chars rejects whole history**; preservation copy before overwrite | **NO TEST for upgrading oversized released history** |
| E10+ | `transaction-location-store`: `{locations}` | `stores/transactionLocationStore.ts:91@99eb79aaa` | `P/transactionLocationStore.ts:80@HEAD`; `L/migrations/dataMigrations.ts:140@HEAD` | Read/scoped rename; locations imported into annotations | `T/dataMigrations.test.ts:54@HEAD`, “imports all four released side-data stores into annotation keys” |
| E12+ | `profile-store`: activeAccountIndex/profiles; E14+ Coco completion flags | `stores/profileStore.ts:119@59a27ff7a`; `:138@a838d5bc3` | `G/profileStore.ts:288@HEAD`, migration `:141@HEAD` | v0/v1→2 strips `cocoMigrationComplete`; preserves account rows; invalid active index repaired | `T/profileStorePersistResilience.test.ts:29@HEAD`, unknown-source case. **NO TEST for importing Redux-only profiles** |
| E12+ | `mint-distribution-store`: `{distributions}` | `stores/mintDistributionStore.ts:505@59a27ff7a` | `P/mintDistributionStore.ts:470@HEAD` | Index rename, identity migration/schema merge | **NO TEST for complete released fixtures** |
| E12+ | `search-history-store`: `{recentSearches}` | `stores/searchHistoryStore.ts:136@59a27ff7a` | `P/searchHistoryStore.ts:102@HEAD` | Index rename, identity migration; bounded schema can reject old oversized fields | **NO TEST for complete released fixtures** |
| E12+ | `swap-transactions-store`: `{groups,quoteIdToGroup}` | `stores/swapTransactionsStore.ts:261@59a27ff7a` | `P/swapTransactionsStore.ts:303@HEAD`; `L/migrations/dataMigrations.ts:150@HEAD` | Read/scoped rename; swap links imported into annotations | `T/dataMigrations.test.ts:54@HEAD`; `T/swapTransactionsStorePersistResilience.test.ts:39@HEAD`, enum-resilience case |
| E13+ | `npc-mint-store`: mintUrls map/lastSyncedAt; later scalar mintUrl | `stores/npcMintStore.ts:122@c998c51cf` | `P/npcMintStore.ts:102@HEAD`, migration `:49@HEAD` | v0/v1→2 selects first nonempty URL; old sync timestamp dropped | **NO TEST for all released maps** |
| E14+ | `nostr-social-store`: contact/follow state, likes/reposts/optimistic maps; later engagement map | `stores/nostrSocialStore.ts:320@a838d5bc3` | `P/nostrSocialStore.ts:710@HEAD` | Index rename; v0/v1→2 folds engagement maps; later fields default | `T/nostrSocialStoreMigrate.test.ts:12@HEAD`, “folds the three legacy parallel maps into engagementByEventId” |
| E15+ | `global-migrations-completed`: array of IDs | `shared/lib/migrations/globalMigrations.ts:93@19388f0e3` | `L/migrations/globalMigrations.ts:348@HEAD` | Known IDs skipped; absent/unparseable marker replays migrations; throwing read stops startup | `T/globalMigrationsRunner.test.ts:138@HEAD`, marker-read failure; `:216`, interrupted released launch |
| E15+ | `profile-transition-in-progress`: `{startedAt}` | `shared/lib/profile/profileSessionOrchestrator.ts:43@19388f0e3` | `L/profile/profileTransition.ts:78@HEAD` | Removed on startup, best effort | **NO TEST identified for released-marker upgrade** |
| E16+ | `wallet-lifecycle`: seedCreatedAt/restoreStatus/lastRestoreAt; later error/backup fields | `shared/stores/global/walletLifecycleStore.ts:52@28bf7713a` | `G/walletLifecycleStore.ts:78@HEAD`; `L/migrations/globalMigrations.ts:288@HEAD` | Existing record read; missing/default lifecycle stamped if onboarding seen; pending restore decisions preserved | `T/lifecycleStampMigration.test.ts:32@HEAD`, no-record upgrader; `:50`, restore-state cases |
| E16+ | `wallpaper-store`: catalog/albums/downloaded metadata/timestamp | `shared/stores/global/wallpaperStore.ts:271@28bf7713a` | `G/wallpaperStore.ts:298@HEAD` | Read; local URIs reconstructed against current document directory; integrity verification scheduled | **NO TEST identified for every historical catalog shape** |
| E16+ | `theme-store`: album/unitWallpapers/mode | `shared/stores/profile/themeStore.ts:208@28bf7713a` | `P/themeStore.ts:62@HEAD` | **v0/v1 overwritten with defaults**, intentionally; v2 retained | `T/themeStoreMigrate.test.ts:12@HEAD`, “discards prior album, unit wallpapers, and mode from a v1 blob” |
| E16–E17 | `split-bill-transactions-store`: groups/quoteIdToSplitBill, participant invoices/status | `shared/stores/profile/splitBillTransactionsStore.ts:55@28bf7713a`, `:409@28bf7713a` | No reader/import in `L/migrations/dataMigrations.ts:40@HEAD` | Ignored, left on disk | **NO TEST** |
| E16+ | `transaction-distribution-store`: `{distributions}` | `shared/stores/profile/transactionDistributionStore.ts:146@28bf7713a` | `P/transactionDistributionStore.ts:141@HEAD`; `L/migrations/dataMigrations.ts:130@HEAD` | Read; imported into annotations | `T/dataMigrations.test.ts:54@HEAD` |
| E17+ | BLE `bitchat-dm-messages-store`: `{byPeer}` | `features/bitchat/stores/bitchatDmMessages.ts:191@88fad9741` | `app/features/bitchat/stores/bitchatDmMessages.ts:270@HEAD` | Read; own sending/sent messages demoted to failed/app_restart | **NO historical upgrade test identified** |
| E17+ | `nostr-metadata-cache`: `{byPubkey}` | `shared/stores/global/nostrMetadataCache.ts:224@88fad9741` | `G/nostrMetadataCache.ts:128@HEAD` | Same pubkey scope; schema merge | **NO historical upgrade test identified** |
| E17+ | `send-reachability-store`: `{byTransactionId}` | `shared/stores/profile/sendReachabilityStore.ts:89@4203ea8ec` | `P/sendReachabilityStore.ts:104@HEAD` | Same scoped key/read | **NO historical upgrade test identified** |
| E17+ | NIP04/NIP17 positive/negative caches: `nip04-cache:v1:<pubkey>`, `nip04-cache-neg:v1:<pubkey>`, `nip17-unwrap-cache:v1:<pubkey>`, `nip17-unwrap-cache-neg:v1:<pubkey>` | `shared/lib/nostr/nip04Cache.ts:5@88fad9741`; `shared/lib/nostr/giftWrapCache.ts:6@88fad9741` | `L/cache/createPubkeyScopedCache.ts:186@HEAD` | Read lazily; valid entries adopted, invalid entries ignored; later flush replaces cache snapshot | **NO complete historical-fixture test identified** |
| E17+ | Whitenoise `whitenoise:<accountIndex>:<namespace>:<key>`; namespaces group-state, key-package, invite-received/unread/seen, inbox-cursor, history, dm-index; `{v:1,d}`, byte/bigint tags | `features/whitenoise/storage/namespaces.ts:8@88fad9741`, `:24@88fad9741`; `features/whitenoise/storage/asyncStorageBackend.ts:59@88fad9741` | `app/features/whitenoise/storage/asyncStorageBackend.ts:98@HEAD`; `:150@HEAD` | Version-1 envelope read as is. Bare/pre-envelope or malformed values return null and remain until later writes | **NO every-namespace release-upgrade test identified** |
| E18+ | `mint-metadata-store`: `{byMintUrl,legacyMigrated}` | `shared/stores/global/mintMetadataStore.ts:365@4203ea8ec` | `G/mintMetadataStore.ts:394@HEAD` | Same bare key/schema; legacy import skipped once flagged complete | `T/mintMetadataStore.test.ts:65@HEAD` |
| E18+ | `mempool-address-cache`: `{byAddress}` | `shared/stores/global/mempoolAddressCache.ts:97@4203ea8ec` | `G/mempoolAddressCache.ts:108@HEAD` | Same bare key/schema | **NO historical fixture test identified** |
| E18+ | `data-migration-store`: `{level}` | `shared/stores/profile/dataMigrationStore.ts:41@4203ea8ec` | `P/dataMigrationStore.ts:40@HEAD`; `L/migrations/dataMigrations.ts:53@HEAD` | Level 0 runs side-data import; level ≥1 skips it | `T/dataMigrations.test.ts:135@HEAD`, waits for durable annotations; `:182`, rejected-write case |
| E18+ | `transaction-annotation-store`: `{annotations}` | `shared/stores/profile/transactionAnnotationStore.ts:54@4203ea8ec` | `P/transactionAnnotationStore.ts:54@HEAD` | Same key; migration fills missing fields, existing annotations win | `T/dataMigrations.test.ts:99@HEAD`, fill-gaps case |
| E18+ | `own-content-store`: `{byId}` | `shared/stores/profile/ownContentStore.ts:175@4203ea8ec` | `P/ownContentStore.ts:181@HEAD` | Read; pending publishes persisted as recoverable local entries | **NO historical fixture test identified** |
| E18+ | `owned-media-store`: `{byBlob}` | `shared/stores/profile/ownedMediaStore.ts:156@4203ea8ec` | `P/ownedMediaStore.ts:172@HEAD` | Same key/schema | **NO historical fixture test identified** |
| E18+ | `recent-people-store`: `{entries}` | `shared/stores/profile/recentPeopleStore.ts:77@4203ea8ec` | `P/recentPeopleStore.ts:160@HEAD` | Same key/schema | **NO historical fixture test identified** |
| E18+ | `nut-drop-redeem-queue`: `{byTokenHash}` | `shared/stores/profile/nutDropRedeemQueueStore.ts:213@4203ea8ec` | `P/nutDropRedeemQueueStore.ts:281@HEAD` | Same key/schema; rejected blob preservation applies | **NO every released pending-token fixture test identified** |
| E18+ | `feed-ignore-store`; `notification-policy-store` | `app/features/feed/stores/ignoreStore.ts:177@148ebd085`; `app/features/feed/stores/notificationPolicyStore.ts:70@HEAD` | Same files `:180@HEAD`, `:70@HEAD` | Scoped schema merge; policy/block/filter state retained when valid | **NO complete historical fixture test identified** |
| E18+ | `nip46-connections-store`: apps; `nip46-activity-store`: entries, version 1 | `features/nostrSigner/data/nip46ConnectionsStore.ts:650@4203ea8ec`; `nip46ActivityStore.ts:149@4203ea8ec` | `app/features/nostrSigner/data/nip46ConnectionsStore.ts:681@HEAD`; `nip46ActivityStore.ts:156@HEAD` | Same scoped keys/schema | **NO complete historical fixture test identified** |
| E18+ | SecureStore `nip46_bunker_secrets_<pubkey>`; pairing credential array | `features/nostrSigner/lib/bunkerSecrets.ts:33@4203ea8ec`, `:68@4203ea8ec` | `app/features/nostrSigner/lib/bunkerSecrets.ts:88@HEAD` | Same key read; pairing lifecycle subsequently expires/consumes entries | **NO native upgrade test identified** |
| E18+ | AsyncStorage `nip46-pending-pairing` | `features/nostrSigner/lib/pairingIntentStorage.ts:22@4203ea8ec`, `:76@4203ea8ec` | `app/features/nostrSigner/lib/pairingIntentStorage.ts:75@HEAD` | Same key read; explicit pairing lifecycle removes it | **NO release-upgrade test identified** |
| E18+ | `npc_since:profile:<pubkey>`: timestamp string | `shared/lib/cashu/npc.ts:57@4203ea8ec` | `L/cashu/npc.ts:102@HEAD`, `:127@HEAD` | Read as number; absent/nonfinite defaults to 0 | **NO historical cursor fixture test identified** |
| E19+ | `relay-metadata-store`: `{byRelayUrl}` | `app/shared/stores/global/relayMetadataStore.ts:123@148ebd085` | `G/relayMetadataStore.ts:126@HEAD` | Same bare key/schema | **NO historical fixture test identified** |
| E18+ | `nostr-media-server-store`: `{server}`; `nostr-relay-list-store`: entries/timestamp/published/source | `shared/lib/nostr/media/mediaServerStore.ts:42@4203ea8ec`; `shared/lib/nostr/outbox/relayListStore.ts:113@4203ea8ec` | `L/nostr/media/mediaServerStore.ts:63@HEAD`; `L/nostr/outbox/relayListStore.ts:120@HEAD` | Same scoped keys/schema | `T/mediaServerStore.test.ts:131@HEAD`, “preserves legacy persisted URLs without tightening the hydration schema”; **NO complete relay-list upgrade test identified** |

Files and HEAD-only additions:

| Epoch | Item | Released shape evidence | HEAD reader | Outcome | Test |
|---|---|---|---|---|---|
| E1–E6 | `document/vpn_<hash>.conf` | `app/VpnShare.tsx:18@957eed9ea`; `app/vpn.tsx:119@a09fe2d54` | No reader found in HEAD migration/store/file searches | Ignored, left on disk | **NO TEST** |
| E16+ | `document/wallpapers/<theme>.png`; staging/backup files in later implementations | `shared/lib/wallpaperStorage.ts:11@28bf7713a` | `L/wallpaperStorage.ts:185@HEAD`, `:194@HEAD` | Canonical files reused; store URIs reconstructed; orphan cleanup is a separate operation | **NO real filesystem-upgrade test run** |
| E18+ | `document/sovran-logs/log.txt`, `log.prev.txt`; cache `sovran-log-export.txt` | `shared/lib/loggerFile.ts:75@4203ea8ec`, `:221@4203ea8ec` | `L/loggerFile.ts:35@HEAD`, `:221@HEAD` | Existing logs reused/rotated when logging runs; export overwritten on export | **NO upgrade test identified** |
| E19+ | Native-harness document files: clipboard, mint-fault rules/ledger, state mirror | `app/shared/lib/e2e/clipboard/io.ts:86@148ebd085`; `mintFaults/io.ts:57@148ebd085`; `stateMirror.ts:128@148ebd085` | Corresponding HEAD readers remain: `clipboard/io.ts:110@HEAD`; `mintFaults/io.ts:104@HEAD`; `stateMirror.ts:82@HEAD` | Harness-only state; read/rewritten when enabled | **NO release-upgrade test identified** |
| E20 | New global stores: `cta-store`/dismissed, `mint-testnut-store`/byMintUrl | `G/ctaStore.ts:56@HEAD`; `G/mintTestnutStore.ts:116@HEAD` | Same | Absent on old releases; starts defaults | **NO old value to migrate** |
| E20 | New profile stores: `ai-provider-directory-store`, `dm-last-message-store`, `own-profile-metadata-store`, `vertex-budget-store` | `P/aiProviderDirectoryStore.ts:110@HEAD`; `P/dmLastMessageStore.ts:63@HEAD`; `P/ownProfileMetadataStore.ts:118@HEAD`; `P/vertexBudgetStore.ts:55@HEAD` | Same | Absent on inspected releases; defaults/new writes | **NO old value to migrate** |
| E20 | Persisted query caches: `mint-changes-cache`, `mint-discover-cache`, `own-profile-stats-cache`; `{byKey}`, bare host-scoped keys | `app/features/mint/data/mintChangesCache.ts:19@HEAD`; `mintDiscoverCache.ts:19@HEAD`; `L/profile/ownProfileStatsStore.ts:16@HEAD` | `L/cache/createQueryCacheStore.ts:238@HEAD` | New caches; invalid blobs may be replaced | **NO old value to migrate** |
| E20 | `ui.settledHeaderHeight.v1` | `app/shared/ui/composed/settledHeaderHeight.ts:29@HEAD` | Same file `:45@HEAD` | New UI cache | **NO old value to migrate** |
| E20 | Secure vault `routstr_v1_<pubkey>_<sha256(name)>_manifest`, chunks `<prefix>_<slot>_<index>`; manifest version 1 | `L/persist/secureVaultManifest.ts:6@HEAD`, `:13@HEAD`, `:18@HEAD` | `L/persist/secureVault.ts:25@HEAD` | New secure representation; verified committed generation read | `T/routstrSecureVault.test.ts:24@HEAD`, large-token round trip; `:32`, failed replacement |
| E20 | Routstr SDK `routstr-sdk:<key>:profile:<pubkey>`; sensitive keys `api_keys`, `child_keys`, `xcashu_tokens`, `cached_receive_tokens` | `L/routstr/sdk/driver.ts:14@HEAD` | Same file `:45@HEAD` | Sensitive plaintext copied to verified vault then removed; nonsensitive values remain AsyncStorage | `T/routstrSecurePersistence.test.ts:136@HEAD`, captured-owner case |
| E20 | Secure `nearby-payment-journal`: version 1 inbound/outbound intent | `app/features/nearPay/lib/nearbyPaymentStorage.ts:2@HEAD`; `nearbyPayments.ts:83@HEAD` | `nearbyPayments.ts:92@HEAD` | New vault; malformed journal throws rather than resetting | **NO old value to migrate** |

The following HEAD query names are **not durable**: search-posts, feed-page, notification-followers-page, notifications-page, mint-reviews, dm-conversations, dm-thread and profile-search; their declarations specify `persist:false`. Evidence: respective files under `app/features/*/data`, including `searchPostsCache.ts:20@HEAD`, `feedCache.ts:19@HEAD`, `mintReviewsCache.ts:18@HEAD`, `dmSnapshotCaches.ts:20@HEAD`, `:33@HEAD`, and `profileSearchCache.ts:17@HEAD`.

SecureStore options were unchanged at the JavaScript level: iOS `requireAuthentication:false`, Android `{}`; **no explicit `keychainService` or accessibility setting found**. Evidence: `helper/secureStorage.ts:12@bab1c891f`, `:35@bab1c891f`; `shared/lib/nostr/secureStorage.ts:29@19388f0e3`; `L/nostr/secureStorage.ts:55@HEAD`. Native continuity remains unproven across SecureStore major changes: `package.json:112@957eed9ea` (`^14.0.0`), `package.json:80@bab1c891f` (`~15.0.7`), `package.json:115@88fad9741` (`~55.0.8`), `app/package.json:147@HEAD` (`~56.0.4`).

### 3. Ranked findings

1. **Critical — Redux-only upgrades strand phrases, identities and bearer proofs.**

   Failing state: a 0.0.24 install with populated `persist:SOVRAN`, unspent `cashu.profiles[0].proofs`, and its phrase only in `nostr.profiles[0].mnemonic`; no `profile-store` or `user_mnemonic`.

   HEAD never reads that Redux key. Its mnemonic creation guard checks only `profile-store`, so this state can generate a new root and bootstrap a new profile while leaving the old wallet inaccessible. The migration that moved the phrase existed in an intermediate release and is gone from HEAD.

   Evidence: `helper/redux/cashu/reducer.ts:24@a09fe2d54`; `app/onboard/animate.tsx:125@a09fe2d54`; `redux/store/index.ts:479@bab1c891f`; `L/nostr/secureStorage.ts:430@HEAD`, `:445@HEAD`, `:457@HEAD`; `app/shared/providers/NostrKeysProvider.tsx:331@HEAD`. **NO TEST.**

2. **Critical — the earliest releases’ deterministic Cashu seed is not HEAD’s seed.**

   Failing state: proofs/counters created by 0.0.1–0.0.12 under raw HD child `k = derive(m/44'/129372'/0'/i'/0/0).privateKey`.

   Those releases pass `k` directly as `bip39seed`. HEAD passes `mnemonicToSeedSync(entropyToMnemonic(k), '')`. These are different seeds despite the same phrase/path. Recovering the root phrase in HEAD therefore does not recover that early deterministic wallet.

   Evidence: `helper/cashu/wallet.ts:37@957eed9ea`, `:41@957eed9ea`; `helper/cashu/wallet.ts:36@7327ed3b6`, `:40@7327ed3b6`; `L/nostr/keyDerivation.ts:78@HEAD`, `:81@HEAD`, `:89@HEAD`. Existing `T/keyDerivation.test.ts:63@HEAD` checks current vectors, not this raw-32-byte legacy chain. **NO legacy-chain test.**

3. **Critical — 0.0.51→HEAD can orphan a paid Routstr credential because no profile list exists yet.**

   Failing state: bare `routstr-store` with API key and paid balance, valid SecureStore phrase, but no `profile-store`.

   Global migration returns immediately, then records completion. Nostr bootstrap later creates the profile. Routstr’s secure reader requires an existing pubkey and reads that pubkey’s scoped key; it does not adopt the bare credential. Subsequent launches skip the completed key migration.

   Evidence: `stores/routstrStore.ts:392@6d67b2ead`; `L/migrations/globalMigrations.ts:139@HEAD`, `:386@HEAD`; `app/shared/providers/NostrKeysProvider.tsx:331@HEAD`; `L/cashu/profileScopedStorage.ts:77@HEAD`; `L/routstr/securePersistence.ts:70@HEAD`. **NO TEST.**

4. **Critical — oversized legacy Routstr sessions can replace the credential vault with defaults.**

   Failing state: 0.0.63 profile-scoped Routstr blob containing a funded API key and **1,025 valid sessions**. The old writer prepends sessions without a cap.

   HEAD’s adapter first secures the credential and strips plaintext. Schema merge then rejects `sessions.length > 1024`, returning defaults. This store opts out of unreadable preservation. A subsequent store mutation writes the default secret fields through the adapter, replacing the committed vault value with empty credentials; further vault generations can overwrite retained slots too. Chat state is also replaced.

   Evidence: `shared/stores/profile/routstrStore.ts:240@28bf7713a`, `:250@28bf7713a`, `:365@28bf7713a`; `P/routstrStore.ts:942@HEAD`, `:1491@HEAD`; `L/persist/createMergeWithSchema.ts:23@HEAD`; `L/routstr/securePersistence.ts:85@HEAD`, `:110@HEAD`, `:131@HEAD`, `:134@HEAD`; `L/persist/secureVault.ts:48@HEAD`. Existing legacy test uses one session: `T/routstrStorePersistResilience.test.ts:155@HEAD`. **NO oversized-upgrade test.**

5. **High — valid old scan histories are rejected wholesale; annotations can checkpoint without them.**

   Failing state: a 0.0.58–0.0.63 scoped history with **501 scans**, or one raw payload of **16,385 characters**, including transaction links.

   Older writers stored unrestricted arrays/raw strings. HEAD rejects the entire blob and exposes an empty history. A preservation copy protects bytes before overwrite, but HEAD has no automatic recovery reader for that copy. The side-data migration reads the empty runtime history and can advance its level without importing those links.

   Evidence: `stores/scanHistoryStore.ts:84@99eb79aaa`, `:194@99eb79aaa`; `P/scanHistoryStore.ts:108@HEAD`, `:124@HEAD`; `L/persist/preserveUnreadable.ts:63@HEAD`; `L/migrations/dataMigrations.ts:112@HEAD`, `:68@HEAD`. `T/scanHistoryStoreNormalise.test.ts:74@HEAD` tests new-write eviction, not old hydration. **NO failing-state upgrade test.**

6. **High — released split-bill records have no HEAD reader or importer.**

   Failing state: a 0.0.63/0.1.0 split-bill group with participant invoices, quote links and partially paid status.

   Its old key remains on disk, but the HEAD data registry imports only scan/distribution/location/swap metadata. Split-bill account data becomes inaccessible. This trace does **not** establish loss of the underlying Coco funds.

   Evidence: `shared/stores/profile/splitBillTransactionsStore.ts:55@28bf7713a`, `:409@28bf7713a`; `L/migrations/dataMigrations.ts:40@HEAD`, `:94@HEAD`. **NO TEST.**

7. **Low — upgrade deliberately discards prior theme choices.**

   Failing state: any version-0/1 theme blob with an album or unit overrides. HEAD replaces it with `{activeAlbumSlug:null, unitWallpapers:{}, mode:'dark'}`. This also discards the version-0 theme just seeded by the global legacy-theme migration.

   Evidence: `L/migrations/globalMigrations.ts:248@HEAD`; `P/themeStore.ts:62@HEAD`; `T/themeStoreMigrate.test.ts:12@HEAD`, `:26@HEAD`. This is tested intended behavior, but it does not satisfy the skill’s “nothing lost” invariant.

Remaining coverage gaps:

- **Native secret continuity:** no signed iOS/Android upgrade evidence for SecureStore 15→55→56 or native accessibility/service defaults; dependency pins are cited above.
- **Historical completeness:** supplied dumps omit several release revisions and do not establish every persistence-changing commit inside inferred/bounded shipment intervals.
- **No MMKV found:** searched supplied epoch surfaces and source for `new MMKV(`, `createMMKV(` and `MMKV.`.
- **No additional raw AsyncStorage writers found in inspected snapshots:** searched `setItem`, `multiSet`, `mergeItem`, `multiMerge`, persistence adapters and namespace constructors. SDK-owned/native persistence beyond the app adapters remains a separate coverage gap.
- **No HEAD explicit version bump lacking a migrator found among inspected `persistConfig` stores:** explicit migrations or the identity default apply. That does **not** make their old shapes schema-compatible: `L/persist/persistConfig.ts:135@HEAD`, `:173@HEAD`.