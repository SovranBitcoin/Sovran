# Persisted Zustand reader survey

Candidate: `87b8afffee50316f65b36d8a3efa422898e1cbd3` (`surgery/pass-1`), 2026-11-10. Read-only source survey; not release certification. No product edits, checkout, stash, commit, native run, or funded action. Only this report was written.

**Result: seven additional verified writer/reader mismatch families, plus API-only candidates.** The highest impact is an oversized cached Nostr display name rejecting the global account list. The evidence does not establish destruction of proofs or secret keys. Ordinary stores retain rejected bytes separately, but run on defaults; no automatic recovery of that copy was demonstrated. Most reported bounds already existed in 0.1.3: these are released self-incompatible writers, not necessarily newly tightened readers.

Paths below are repository-relative. `@HEAD` means the pinned SHA above, never an assumed moving main. `G/` = `app/shared/stores/global/`, `P/` = `app/shared/stores/profile/`, `L/` = `app/shared/lib/`. Before 0.1.2 omit `app/` from paths cited at 0.1.0/0.1.1. Releases checked: 0.1.0 `d23d07230`, 0.1.1 `4203ea8ec`, 0.1.2 `148ebd085`, 0.1.3 `d9ad12c4b`. The map's E17 representative is not the 0.1.0 tag; this survey used the requested tag commit. First epochs in the inventory come from the map where it names the store; fixture presence is separately recorded, not treated as proof of introduction.

## Common reader and failure semantics

`L/persist/persistConfig.ts:139-145@HEAD` supplies version **1**, identity migration, and schema-backed merge unless overridden. Absence of an explicit version option therefore does **not** mean absence of a disk version. `createJSONStorage` writes Zustand `{state,version}` envelopes. Legacy bare persist options commonly used implicit version 0.

`L/persist/createMergeWithSchema.ts:26-40@HEAD`: any failed root parse returns current/default state. Only settings opts into independent-field salvage (`G/settingsStore.ts:478@HEAD`). `.default` rescues absence, not an oversized or otherwise invalid present value. `.optional` likewise does not rescue an invalid present value. `z.looseObject` tolerates extra fields but still rejects invalid declared fields.

Failure codes in the table:

- **D**: defaults; raw rejected bytes copied before overwrite to `<name>:unreadable`, using the same account scope; writes refused if the copy cannot be verified or a storage read failed. `L/persist/preserveUnreadable.ts:63-134@HEAD`. Schema rejection itself does not throw or mark hydration failed. Preservation is not an accepted hydration or recovery UI.
- **I**: settings keeps independently valid fields; same preservation guard.
- **C**: disposable cache defaults, replacement allowed (`preserveUnreadable:false`).
- **R**: Routstr defaults, secure adapter owns preservation, and writes suppressed until a load is accepted (`P/routstrStore.ts:912-978,1660,1841@HEAD`). No claim of paid-key deletion after the existing fix; new changes in the rejected session do not save (known F88).

Global keys are the exact store name. Account keys are `<name>:profile:<pubkey>` (`L/cashu/profileScopedStorage.ts`); index/bare-key migrations are already documented in the existing map. BTCMap now stores its envelope at `cache/store-btcmap-store.json`, adopting the older AsyncStorage key. Query cache schema is shared in `L/cache/createQueryCacheStore.ts:168-179@HEAD`: byKey key max 256, timestamp integer/nonnegative, viewerKey max 128 with default, cursor max 2048 optional, arbitrary data; partialize writes byKey unchanged; version 1/identity migration.

## Inventory

All 45 manifest rows with `persisted:true` are below, including three query caches. Fixture column means ordinary state coverage through `releaseFixtures.test.ts`, not a boundary-value test and not a test run in this survey. `E20` is unreleased. See the source appendix for each schema, projection, custom migration and explicit version.

| Name / storage key | Scope | Version / migration | Releases that wrote it; first epoch | Failed read | Fixture/test pin |
|---|---|---|---|---|---|
| `bitchat-dm-messages-store` | per-account | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E17 | D | `E17-0.1.0.ts`; ordinary values |
| `feed-ignore-store` | per-account | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E17 (present in 0.1.0 tag; map groups under E18) | D | `E18-0.1.1.ts`; ordinary values |
| `notification-policy-store` | per-account | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E17 (present in 0.1.0 tag; map groups under E18) | D | `E18-0.1.1.ts`; ordinary values |
| `mint-changes-cache` | global | 1 / identity | 0.1.2, 0.1.3; E19 | C | `E19-0.1.2.ts`; ordinary values |
| `mint-discover-cache` | global | 1 / identity | none; E20 | C | `E20-0.1.4.ts`; ordinary values |
| `nip46-activity-store` | per-account | 1 / identity | 0.1.1, 0.1.2, 0.1.3; E18 | D | `E18-0.1.1.ts`; ordinary values |
| `nip46-connections-store` | per-account | 1 / identity | 0.1.1, 0.1.2, 0.1.3; E18 | D | `E18-0.1.1.ts`; ordinary values |
| `nostr-media-server-store` | per-account | 1 / identity | 0.1.1, 0.1.2, 0.1.3; E18 | D | `E18-0.1.1.ts`; ordinary values |
| `nostr-relay-list-store` | per-account | 1 / identity | 0.1.1, 0.1.2, 0.1.3; E18 | D | `E18-0.1.1.ts`; ordinary values |
| `own-profile-stats-cache` | global | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E17 | C | `E18-0.1.1.ts`; ordinary values |
| `btcmap-store` | global | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E9 | C | `E09-0.0.51.ts`; ordinary values |
| `cta-store` | global | 1 / identity | none; E20 | D | `E20-0.1.4.ts`; ordinary values |
| `legacy-ecash-store` | global | 1 / identity | none; E20 | D | `E20-0.1.4.ts`; ordinary values |
| `mempool-address-cache` | global | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E17 | D | `E18-0.1.1.ts`; ordinary values |
| `mint-metadata-store` | global | 1 / identity | 0.1.1, 0.1.2, 0.1.3; E18 | D | `E08-0.0.50.ts`; ordinary values |
| `mint-testnut-store` | global | 1 / identity | none; E20 | D | `E20-0.1.4.ts`; ordinary values |
| `nostr-metadata-cache` | per-account | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E17 | D | `E17-0.1.0.ts`; ordinary values |
| `pricelist-store` | global | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E7 | D | `E07-0.0.45.ts`; ordinary values |
| `profile-store` | global | 2 / custom | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E12 | D | `E12-0.0.57.ts`; ordinary values |
| `relay-metadata-store` | global | 1 / identity | 0.1.2, 0.1.3; E18 | D | `E19-0.1.2.ts`; ordinary values |
| `settings-store` | global | 4 / custom | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E7 | I | `E07-0.0.45.ts`; ordinary values |
| `wallet-lifecycle` | global | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E16 | D | `E07-0.0.45.ts`; ordinary values |
| `wallpaper-store` | global | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E16 | D | `E16-0.0.63.ts`; ordinary values |
| `ai-provider-directory-store` | per-account | 1 / identity | none; E20 | D | `E20-0.1.4.ts`; ordinary values |
| `data-migration-store` | per-account | 1 / identity | 0.1.1, 0.1.2, 0.1.3; E18 | D | `E18-0.1.1.ts`; ordinary values |
| `dm-last-message-store` | per-account | 1 / identity | none; E20 | D | `E20-0.1.4.ts`; ordinary values |
| `mint-distribution-store` | per-account | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E12 | D | `E12-0.0.57.ts`; ordinary values |
| `mint-store` | per-account | 2 / custom | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E7 | D | `E07-0.0.45.ts`; ordinary values |
| `nostr-social-store` | per-account | 2 / custom | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E14 | D | `E14-0.0.61.ts`; ordinary values |
| `npc-mint-store` | per-account | 2 / custom | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E13 | D | `E13-0.0.60.ts`; ordinary values |
| `nut-drop-redeem-queue` | per-account | 1 / identity | 0.1.1, 0.1.2, 0.1.3; E18 | D | `E18-0.1.1.ts`; ordinary values |
| `own-content-store` | per-account | 1 / identity | 0.1.1, 0.1.2, 0.1.3; E18 | D | `E18-0.1.1.ts`; ordinary values |
| `owned-media-store` | per-account | 1 / identity | 0.1.1, 0.1.2, 0.1.3; E18 | D | `E18-0.1.1.ts`; ordinary values |
| `own-profile-metadata-store` | per-account | 1 / identity | none; E20 | D | `E20-0.1.4.ts`; ordinary values |
| `recent-people-store` | per-account | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E17 | D | `E18-0.1.1.ts`; ordinary values |
| `routstr-store` | per-account | 3 / custom | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E8 | R | `E08-0.0.50.ts`; ordinary values |
| `scan-history-store` | per-account | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E10 | D | `E10-0.0.52.ts`; ordinary values |
| `search-history-store` | per-account | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E12 | D | `E12-0.0.57.ts`; ordinary values |
| `send-reachability-store` | per-account | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E17 | D | `E17-0.1.0.ts`; ordinary values |
| `swap-transactions-store` | per-account | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E12 | D | `E12-0.0.57.ts`; ordinary values |
| `theme-store` | per-account | 2 / custom | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E16 | D | `E07-0.0.45.ts`; ordinary values |
| `transaction-annotation-store` | per-account | 1 / identity | 0.1.1, 0.1.2, 0.1.3; E18 | D | `E18-0.1.1.ts`; ordinary values |
| `transaction-distribution-store` | per-account | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E16 | D | `E16-0.0.63.ts`; ordinary values |
| `transaction-location-store` | per-account | 1 / identity | 0.1.0, 0.1.1, 0.1.2, 0.1.3; E10 | D | `E10-0.0.52.ts`; ordinary values |
| `vertex-budget-store` | per-account | 1 / identity | none; E20 | D | `E20-0.1.4.ts`; ordinary values |

## Reader stricter than a released writer

Concrete blobs below use executable JavaScript notation solely to avoid printing thousands of characters. Wrap each state as `JSON.stringify({version: V,state: STATE})`; omitted root fields have defaults. Findings 1–7 are source-traced writer/reader mismatches. Reachability through the named store action is confirmed; no claim that a production phone actually held the sample, or that an upstream server necessarily sends it. Cases 1–6 were also checked with the installed Zod against extracted HEAD schema declarations; all rejected with `too_big` at the stated path. This was an in-memory expression, not a new Jest test or whole-app upgrade. Case 7 is source-traced only.

### 1. High — one cached profile label can hide every account

**CONFIRMED.** `G/profileStore.ts:127-128,148-150@HEAD` caps cachedDisplayName at 512 and cachedPicture at 2048, inside a non-tolerant profile array. The whole global profile list and active account index revert to defaults. Secret keys and databases are separate; this report does not claim they are erased.

Released writer: `app/shared/lib/nostr/ownsync/useOwnEventsSync.ts:59-68@d9ad12c4b` JSON-parses kind-0 and passes display_name/name/picture straight through. `G/profileStore.ts:233-242,259-262@d9ad12c4b` copies those strings and persists the entire profiles array without capping. Earlier released writers do the same at `shared/stores/global/profileStore.ts:202-211,226@d23d07230` and `@4203ea8ec`; 0.1.2 is identical to 0.1.3 here. This also permits a present wrong-type JSON metadata value, since the TypeScript assertion is not runtime parsing.

Rejected state (V=2): `{activeAccountIndex:0,profiles:[{accountIndex:0,pubkey:'a'.repeat(64),addedAt:1,cachedDisplayName:'x'.repeat(513)}]}`. Substitute `cachedPicture:'x'.repeat(2049)` for the second cap. Existing E19 fixture uses `cachedDisplayName:'fixture zero'` (`E19-0.1.2.ts:428`), and its fact at line 1102 checks an ordinary label. No oversized label/picture case in the release fixture corpus. Existing F72 acknowledges rejected profile recovery generally, but does not pin this released writer. Suggested fix: tolerate cached presentation fields individually; never drop account identity rows because metadata is oversized.

### 2. Medium — one swap error erases every swap group from the reader

**CONFIRMED at the store boundary.** `P/swapTransactionsStore.ts:169,178,193-195@HEAD` rejects errorMessage >2048 or legs >256; groups uses ordinary z.record, not tolerantRecord. Losing the store loses group/leg associations, local statuses and the quote index used in grouping. Coco retains the underlying payments; no proof-loss claim.

`P/swapTransactionsStore.ts:279-293,304-307@d9ad12c4b` persists errorMessage unchanged through setLegStatus; 0.1.2 same. Earlier `shared/stores/profile/swapTransactionsStore.ts:272-286,319@d23d07230` and `@4203ea8ec` have the same mismatch. A real released caller passes the error through (`app/features/mint/hooks/useMintRebalanceOrchestrator.ts:289-294@d9ad12c4b`); the source survey does not establish a particular upstream mint error exceeding the bound.

Rejected V=1 state: `{groups:{g:{id:'g',unit:'sat',createdAt:1,title:'Swap',state:'running',legs:[{id:'l',fromMintUrl:'https://a.example',toMintUrl:'https://b.example',amount:1,errorMessage:'x'.repeat(2049)}]}}}`. E19 lines 669 onward use ordinary groups; facts at 1311/1318 do not exercise long errors. Other ID, title, quote and chain-path bounds in this schema are listed in the appendix; not all remote-value reachability was proven. Suggested fix: tolerate optional diagnostic fields independently and preserve valid groups; check old long groups before imposing any new writer cap.

### 3. Medium — an oversized kind-3 field discards the entire social journal

**CONFIRMED.** `P/nostrSocialStore.ts:386-411@HEAD`: contactsContent max 65536; tag strings max2048, inner tags max16, outer tags max50000. These are outside containment. One failure drops contacts, engagement, deletion and optimistic maps together. tolerant followingPubkeys does not protect siblings.

`P/nostrSocialStore.ts:416-439,701-716@d9ad12c4b` stores tags/content unchanged. Released own-event sync passes kind-3 through (`app/shared/lib/nostr/ownsync/useOwnEventsSync.ts:121-125@d9ad12c4b`). Earlier writers: `shared/stores/profile/nostrSocialStore.ts:200,430@d23d07230`, `:346,594@4203ea8ec`; 0.1.2 matches 0.1.3.

Rejected V=2 state: `{contactsContent:'x'.repeat(65537),contactsUpdatedAt:1,deletedNoteIds:{['a'.repeat(64)]:1}}`. A second independent example is `{contactsTags:[['p','a'.repeat(64),'x'.repeat(2049)]]}`. Zod checked the content case. E19 ordinary social state at lines 292/313 uses empty contactsContent; neither oversized content nor tag dimensions are covered. Suggested fix: keep the released contacts document readable and contain unrelated map failures; do not silently truncate a signed contacts document and then republish it.

### 4. Medium — one long own note drops every locally retained own post

**CONFIRMED at store boundary and released sync call.** `P/ownContentStore.ts:101-121@HEAD` caps content at65536, tag component at8192, tag length200, tag count5000; ordinary byId record rejects the whole blob. Pending/local copies may be the only local representation while delivery is uncertain.

`P/ownContentStore.ts:70-76,129-137,157-165,185-195@d9ad12c4b` copies event fields unchanged; prune caps counts/age, not text or tag dimensions. The released sync feeds own notes directly (`app/shared/lib/nostr/ownsync/useOwnEventsSync.ts:116-118@d9ad12c4b`). `shared/stores/profile/ownContentStore.ts:126,182@4203ea8ec` is the earlier writer; absent in 0.1.0. 0.1.2 matches 0.1.3.

Rejected V=1 state: `{byId:{n:{event:{id:'n',pubkey:'a'.repeat(64),kind:1,created_at:1,content:'x'.repeat(65537),tags:[]},authorPubkey:'a'.repeat(64),status:'local',updatedAt:1}}}`. Boundary tests in the release corpus: none found. Suggested fix: preserve old payloads or isolate bad entries; a tolerant collection reduces blast radius but would still lose that long local note.

### 5. Medium — relay 65 empties the whole saved relay configuration

**CONFIRMED.** `L/nostr/outbox/relayListStore.ts:50-58@HEAD`: max64 entries with no catch. Released setFromRelay assigns the whole array, while addRelay/upsert appends distinct normalized URLs without a count cap (`:65-95,121-126@d9ad12c4b`). Thus 65 successive valid addRelay calls suffice without relying on an oversized remote response. 0.1.1 writer `shared/lib/nostr/outbox/relayListStore.ts:65-91,117@4203ea8ec`; absent in 0.1.0; 0.1.2 matches0.1.3.

Rejected V=1 state: `{entries:Array.from({length:65},(_,i)=>({url:'wss://r'+i+'.example',read:true,write:true})),updatedAt:1,hasPublished:true,source:'local'}`. Defaults lose the entire custom relay set plus provenance and published marker. E19 lines800 and868 exercise ordinary lists; no 64/65 case. Suggested fix: accept released longer lists; impose a user-visible limit only on new additions if wanted.

### 6. Low — one pasted search empties every context's history

**CONFIRMED.** `P/searchHistoryStore.ts:39-48@HEAD`: query max2048, context/key max64. Released addSearch only trims whitespace and rejects fewer than2 chars, then caps entry count, not query/context length (`:56-84,102@d9ad12c4b`). Earlier writer `shared/stores/profile/searchHistoryStore.ts:62,113@d23d07230` and `@4203ea8ec`; 0.1.2 same as0.1.3.

Rejected V=1 state: `{recentSearches:{default:[{query:'x'.repeat(2049),timestamp:1}]}}`. Writer can also accept a 65-character context, though real UI context names were not exhaustively traced. E19 line624 and fact1201 use ordinary values. Count bound is safe for the inspected writer: `.slice(0,MAX_RECENT_SEARCHES)`; text bounds are not. Suggested fix: accept existing long searches and cap new input separately if desired.

### 7. Low — one mint identity scalar invalidates the global mint metadata cache

**CONFIRMED by source trace, not runtime reproduction.** `G/mintMetadataStore.ts:126-129,162@HEAD`: displayName max256, iconUrl2048, description4096, supportedUnits64 with each unit16; plain byMintUrl record rejects all entries. Released identityFromInfo copies name/icon_url/description without caps (`:150-157@d9ad12c4b`), setIdentity→mergeCached persists the result (`:183-206,323-325@d9ad12c4b`). Earlier 0.1.1 `shared/stores/global/mintMetadataStore.ts:189,369@4203ea8ec`; absent0.1.0; 0.1.2 same0.1.3. This is a store API / projection proof; every upstream NUT-06 parser was not traced.

Rejected V=1 state: `{legacyMigrated:true,byMintUrl:{'https://mint.example':{displayName:'x'.repeat(257),identityAt:1}}}`. All metadata becomes defaults and the migration flag resets; recoverability of refetched metadata does not make a whole-cache rejection safe. E19 lines501 onward holds ordinary metadata. Suggested fix: contain optional identity scalar failures per field/entry.

### Additional source-confirmed mismatch with unproven product reachability

**Wallpaper catalog capacity:** `G/wallpaperStore.ts:117-120@HEAD` rejects >1000 albums or >10000 catalog entries; released setCatalog saves both arrays unchanged (`:137-148,298@d9ad12c4b`; earlier `shared/stores/global/wallpaperStore.ts:140,343@d23d07230` and `@4203ea8ec`). V=1 `{albums:Array.from({length:1001},(_,i)=>({slug:'a'+i,topic:'t'}))}` rejects (runtime Zod check performed). This also hides downloaded-file metadata, not just the refetchable catalog. Remote catalog parsers may enforce the same limit before setCatalog; that complete call chain was not verified, so this is an **API-level candidate**, not an eighth fully traced product finding. Fixtures contain small catalogs.

**Lifecycle API candidate, not a confirmed production path:** `G/walletLifecycleStore.ts:47@HEAD` rejects lastRestoreError501 chars. `:55-56,66-70@d9ad12c4b` accepts/persists any error string. V=1 `{seedCreatedAt:1,restoreStatus:'pending',lastRestoreError:'x'.repeat(501)}` rejects (runtime checked). Search found no released production caller supplying that long error; do not promote this to a released-phone finding without one. Would default seed/restore timestamps and status together. E19 line450 has null.

### Known findings and limits deliberately not counted again

- The redemption-queue oversized token/metadata family was already filed (repaired since on `surgery/pass-1-queue`). HEAD clips stored errors and adds new Nostr attribution fields; enqueue itself still copies the supplied entry without schema validation; see appendix for actual current parser. No claim of a newly discovered equivalent under a different name.
- Existing Routstr oversized-session and scan-history fixes are present. Scan raw and array count are no longer read caps (`P/scanHistoryStore.ts:116-145@HEAD`); session/message counts are trimmed before schema migration (`P/routstrStore.ts:870-898,1692-1697@HEAD`).
- Routstr still has top-level apiKey8192/selectedModel256 and session title512/id128/activeChildren key/value128 bounds. Released setApiKey accepts arbitrary strings (`P/routstrStore.ts:448@d9ad12c4b`), but a legitimate released mint/provider-issued key exceeding8192 was not proven. F88's assertion that no release is known to have written other rejected shapes should remain evidence-limited. Do not count an invented giant credential as observed money loss.

## Bounds checked and found safe, and containment limits

“Safe” here means the named bound cannot erase the entire blob via the inspected path. It does not certify every field in that store.

| Store / bound | Evidence and result |
|---|---|
| profile count | HEAD array has no max (`G/profileStore.ts:148-150`); old oversized account lists load. Optional source has catch(imported), wallet database/fingerprint fields catch(undefined). Cached label/picture remain unsafe as above. |
| scan raw/count | HEAD accepts released raw and count; new writes are bounded; existing `scanHistoryUpgrade.test.ts` pins oversized old data. Other optional optionKinds/inputType/transactionId limits still exist inside the contained row; a bad value now drops that scan rather than the whole history. Not every historic caller was proven. |
| search count | `.slice(0,MAX_RECENT_SEARCHES)` in writer matches schema count; released text does not share that protection. |
| recent people count | `.slice(0,MAX_RECENT_PEOPLE)` at `P/recentPeopleStore.ts:103-105@HEAD` and same lines@d9ad12c4b; schema max20 at135. Normalizer validates pubkey. |
| NIP46 activity | Writer slices headline64, summary/content preview120 and caps entries; `app/features/nostrSigner/data/nip46ActivityStore.ts:135-150@HEAD`. Row tolerance protects unknown method/verdict; tolerantArray count cap itself is not rescued by row tolerance. |
| NIP46 connections | Relay sanitizer truncates to8 and checks512/regex (`nip46ConnectionsStore.ts:317-321@HEAD`), name slice120 at328, URL/image sanitizer at352-353. App, peer-grant and prior-key caps enforced at403/455/466/550. Root refinements remain real rejection sites: max apps, key/client match, no critical blanket grant, peer grant count (179-213). Entry tolerance does not rescue those refinements. No released violating production write was established. |
| media server URL | HEAD setter normalizes then checks HTTPS URL before set (`L/nostr/media/mediaServerStore.ts:35-45,57-59@HEAD`). **Released setter was weaker:** `:30-40@d9ad12c4b` normalizes without validation. A string such as a whitespace-only hostname can be persisted and later rejected by z.url. This is an additional API-only candidate: released UI validation was not traced, so it is not certified safe for released data. |
| settings bounds | Enum/number/string fields generally catch; terms/legal/app-version nested values have catch; independentFields salvage is enabled. No whole-store long-text finding claimed. |
| mint selection | Active unit catches sat; new per-unit mappings catch; migrated selectedMint remains optional max2048. No legitimate >2048 mint URL was proven; this is not certified safe merely because URLs tend to be short. |
| distribution weights | z.int/min0/max10000 catches0; writer clamps/rounds (`P/mintDistributionStore.ts:186@HEAD`). Outer unit/URL key lengths still reject; not certified for arbitrary long keys. |
| per-row records | owned-media, transaction annotations/distributions/locations, send reachability, legacy-ecash rows, dm-last-message: tolerantRecord contains bad entry AND key. Cannot erase whole store via an invalid contained enum. Still drops the offending row; this is containment, not lossless compatibility. |
| social following map | tolerantRecord catches invalid true values/keys; no protection for contacts document or other plain record fields. |
| metadata caches | Nostr metadata string fields catch(undefined), but plain record key and fetchedAt bounds can still reject root; mint-testnut values catch but URL-key2048 does not. Relay metadata timestamps catch but URL-key2048 remains plain. No overlong real pubkey/URL writer was proven. |
| Routstr counts | Migration trims released oversized sessions before validation; partialize shares ceilings. Message entries are tolerant; attachments catch. Top-level/session bounds remain as noted. Secure vault/save gate changes severity, not schema acceptance. |
| new stores | vertex day/used/blockedUntilDay catch fail-closed values. AI directory per-field catches and tolerant rows; array count is still a root cap. CTA dismissed record catches {}; own-profile history catches {}. These were not written by the four named releases. |

No `.strict()` or persisted `.superRefine()` newly added rejection was found in manifest-owned store declarations. Required identity/message fields are not automatically safe: their primitive/schema declarations and defaults are recorded below. Shared package custom predicates and schemas cannot be certified from these local declarations alone.

## Unreleased stored-shape changes since 0.1.3

Compared pinned HEAD with `d9ad12c4b`, not a guessed remote main. Register/factory/import rewrites with unchanged saved projection are omitted.

| Store / key | HEAD change | Compatibility handling |
|---|---|---|
| profile-store v2 | walletDatabaseCreated, walletPhraseFingerprint on profiles | optional + catch(undefined), no new required field; profile count relaxed. |
| wallet-lifecycle v1 | recoveryPhraseVerifiedAt, recoveryPhraseVerifiedRevision | nullable defaults null with catches. |
| settings-store v4 | legalAcceptance record; lastKnownAppVersion; tier controls and disabled Primal hosts; vertex credits preference | added values have defaults/catches; inspect exact projection below. Older terms acceptance migration remains. |
| pricelist-store v1 | serverUpdatedAt; fiat registry-derived optional price entries | timestamp defaults/catches null; loose price object retains extras. |
| mint-store v2 | standingQuotes, receiveMintByMethod, creqExcludedMints; activeUnit expands to registry units; bip321ExcludedRails removed | maps default/catch {}; removed opt-outs are stripped (intentional behavior change, not additive); old rows still parse. |
| mint-metadata-store v1 | uptime24h, avgLatencyMs, auditSource, liveness/livenessAt/livenessSource | optional catches; auditData remains unknown/optional. |
| nostr-social-store v2 | no added or removed saved field found | createdAtSec is an action argument rename, not a disk rename; stored optimistic expectedSats calculation changes, not its type. |
| nut-drop-redeem-queue v1 | source and senderPubkey added; senderPeerID/paymentId already shipped | source optional/catch(undefined), senderPubkey regex optional/catch(undefined); error strings now clipped; nonterminal age eviction removed. The write/read-limit finding was already filed (repaired since). |
| owned-media-store v1 | purpose (avatar/post) | optional + catch(undefined), row-contained. |
| routstr-store v1→3 | authMode, serverLineupAt, archived credentials, providerClaims/providerSeenAt replacing knownProviders, user node, pendingPayments, confirmSpend, curatedModels; message model/cost/reasoning fields | versioned migration folds provider records and archives old default-node key; old counts trimmed. New root fields default/catch; nested optional message fields. Secure vault moves credentials off plaintext and has its own preservation path. |
| scan-history-store v1 | no new persisted classification field found; existing read limits relaxed | raw/count caps removed and invalid entries contained; inputType/container/optionKinds already existed on 0.1.3. |
| cta-store; legacy-ecash-store; mint-testnut-store | new global keys | no older row to migrate; defaults/catches/tolerant records below. |
| ai-provider-directory-store; dm-last-message-store; own-profile-metadata-store; vertex-budget-store | new account keys | no released row; defaulted containers, optional/caught history or fail-closed fields below. |
| mint-discover-cache | new global persisted query cache | shared cache envelope; version1 identity. |
| btcmap-store | AsyncStorage envelope moved to cache file | storage location change, not a new Zustand shape; tested by fileCacheStorage.test.ts in existing evidence, not rerun here. |

This table is accompanied by literal HEAD schema/projection evidence below to avoid treating prose field lists as an authoritative schema. Some additions may have existed on an earlier unreleased main commit; none is claimed shipped.

## Version markers

All 45 persisted manifest stores use persistConfig (directly or through the query-cache factory), so **none lacks an effective version marker**. Explicit custom versions are profile/theme/mint/NPC/social=2, settings=4, Routstr=3; the rest inherit1. Raw markers/secrets/query payload data can lack their own application version independently of the Zustand envelope. Examples already mapped: global-migrations-completed (array), profile-transition-in-progress (timestamp object), secure_key_index and individual key caches. They are outside this persisted-Zustand survey; absence of a marker there is not a new finding.

## What was and was not verified

Read the existing map, provenance, build table, ledger, fixture format/README and relevant tests; inspected all persisted manifest declarations and four named released source surfaces with git show. Inspected release-fixture state/facts for ordinary coverage; did not rerun fixtures or infer boundary coverage from a passing suite. The supplied raw surfaces are at the pinned HEAD and v0.1.3; used as discovery context, not as replacement for source reads. `jg` did not return promptly; plain source searches were used instead.

Executed only in-memory Zod probes, source/diff/search commands and the report writer. Zod checks used extracted real declarations, not imported native stores; for swap/social a minimal equivalent tolerantRecord binding was supplied to avoid native imports (it affects unrelated contained maps, not the failing paths). No Jest, typecheck, jevlint, Android/iOS upgrade, UI, database, network, full historical binary, or arbitrary-state property testing was run. No suite verdict is implied.

Not read exhaustively: every earlier pre-0.1.0 writer/build; all remote parser/caller chains; native storage and complete secure-vault implementation; upstream dependency version history; Coco/other wallets/NUT specs (no mint/payment behavior changed). This is not proof that every numeric integer/nonnegative field is safe: Date.now/generated indexes are ordinary compatible sources, but financial values and remote timestamps deserve caller-specific checks. The appendix records constraints without silently labeling untraced ones safe. No complete proof of every possible released value was achieved. The concrete findings above are suitable regression-test inputs; unresolved bounds are evidence limits, not a clean bill of health.

## Source appendix — one owner per persisted store

Each excerpt records source locations at pinned HEAD for schema declarations/validators, partialize, migrate, options and the relevant constants. Continuation lines are included to expose catch/default chains. These are source evidence, not independent passing tests. Shared types are resolved through their imported owner rather than redefined here.

### `bitchat-dm-messages-store` — `app/features/bitchat/stores/bitchatDmMessages.ts@HEAD`

```text
…
104:  */
105: const PersistedBleDmMessage = z.looseObject({
106:   id: z.string(),
107:   content: z.string(),
108:   sender: z.string(),
109:   senderId: z.string(),
110:   timestamp: z.number(),
111:   isPrivate: z.boolean(),
112:   isOwn: z.boolean(),
113:   isPending: z.boolean().optional(),
114:   // `.catch('failed')`: fail VISIBLE. Catching an unknown status to
115:   // undefined renders the message as unremarkably in-flight ('sending'
116:   // rank), silently hiding a possible transport failure; 'failed' surfaces
…
122:     .optional(),
123:   failureReason: z.string().optional(),
124: });
125: 
126: const PersistedBitchatDmStore = z.looseObject({
127:   byPeer: z.record(z.string(), z.array(PersistedBleDmMessage)).default({}),
128: });
129: 
130: type PersistedSlice = Pick<BitchatDmMessagesStore, 'byPeer'>;
131: 
132: /**
133:  * App-wide buffer for Bitchat BLE 1:1 messages. Lifted out of the DM screen so
…
271:       storage: createProfileScopedStorage(),
272:       schema: PersistedBitchatDmStore,
273:       partialize: (state) => ({ byPeer: state.byPeer }),
274:       afterHydrate: (state) => {
275:         // Demote any in-flight outbound messages to `failed`. We don't know
276:         // whether they actually made it to the peer between the last write
277:         // and the relaunch — better to flag the ambiguity than show a
278:         // permanent spinner. Inbound messages and already-delivered/read
279:         // outbound messages pass through untouched.
280:         if (!state) {
281:           bitchatLog.debug('bitchat.dm.hydrate.skipped_empty');
282:           return;
283:         }
284:         let mutated = false;
285:         let demotedCount = 0;
286:         const next: Record<string, BleDmMessage[]> = {};
287:         for (const [peer, thread] of Object.entries(state.byPeer)) {
288:           let changed = false;
289:           const updated = thread.map((m) => {
290:             if (m.isOwn && (m.deliveryStatus === 'sending' || m.deliveryStatus === 'sent')) {
291:               changed = true;
292:               demotedCount += 1;
293:               return {
294:                 ...m,
295:                 deliveryStatus: 'failed' as const,
296:                 isPending: false,
297:                 failureReason: 'app_restart',
298:               };
299:             }
300:             return m;
301:           });
302:           if (changed) {
303:             mutated = true;
304:             next[peer] = updated;
305:           } else {
306:             next[peer] = thread;
307:           }
308:         }
309:         if (mutated) {
310:           bitchatLog.info('bitchat.dm.hydrate.demoted_pending', {
311:             peerCount: Object.keys(state.byPeer).length,
312:             demotedCount,
313:           });
314:           useBitchatDmMessagesStore.setState({ byPeer: next });
315:         } else {
316:           bitchatLog.debug('bitchat.dm.hydrate.no_demotions', {
317:             peerCount: Object.keys(state.byPeer).length,
318:           });
319:         }
320:       },
321:     })
```

### `feed-ignore-store` — `app/features/feed/stores/ignoreStore.ts@HEAD`

```text
…
18: const HEX64_RE = /^[0-9a-f]{64}$/;
19: const MAX_IGNORED_PUBKEYS = 5_000;
20: const MAX_IGNORED_EVENT_IDS = 10_000;
21: 
22: type FeedIgnoreState = {
23:   ignoredPubkeys: string[];
…
83: 
84: export const PersistedFeedIgnoreStore = z.object({
85:   ignoredPubkeys: tolerantArray(SavedPubkey, MAX_IGNORED_PUBKEYS).default([]),
86:   ignoredEventIds: tolerantArray(SavedEventId, MAX_IGNORED_EVENT_IDS).default([]),
87:   // A copy of the published list. One that cannot be read is fetched again.
…
90:       id: SavedEventId,
91:       createdAt: z.number().int().nonnegative(),
92:       tags: z.array(z.array(z.string())),
93:       privateTags: z.array(z.array(z.string())),
94:     })
95:     .nullable()
96:     .default(null)
97:     .catch(null),
98:   blockOverrides: tolerantRecord(SavedPubkey, z.boolean()),
99:   dmFilterEnabled: z.boolean().default(false),
100:   dmFilterWords: z.array(z.string().max(100)).max(100).default([]),
101: });
102: 
103: export const useFeedIgnoreStore = create<FeedIgnoreStore>({
…
194:       storage: createProfileScopedStorage(),
195:       schema: PersistedFeedIgnoreStore,
196:       logKey: 'feed_ignore',
197:       partialize: (state) => ({
198:         ignoredPubkeys: state.ignoredPubkeys,
199:         ignoredEventIds: state.ignoredEventIds,
200:         muteList: state.muteList,
201:         blockOverrides: state.blockOverrides,
202:         dmFilterEnabled: state.dmFilterEnabled,
203:         dmFilterWords: state.dmFilterWords,
204:       }),
```

### `notification-policy-store` — `app/features/feed/stores/notificationPolicyStore.ts@HEAD`

```text
…
32: // anyway, so the catch strictly narrows the loss).
33: const PersistedNotificationPolicyStore = z.object({
34:   policy: z
35:     .enum(['RELAXED', 'MODERATE', 'STRICT', 'FOLLOWS'])
36:     .default(DEFAULT_NOTIFICATION_POLICY)
…
71:       storage: createProfileScopedStorage(),
72:       schema: PersistedNotificationPolicyStore,
73:       logKey: 'notification_policy',
74:       partialize: (state) => ({
75:         policy: state.policy,
76:         replyScope: state.replyScope,
77:       }),
```

### `mint-changes-cache` — `app/features/mint/data/mintChangesCache.ts@HEAD`

```text
…
11: import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
…
17: export const mintChangesCache = createQueryCacheStore<MintChangesResponse>({
18:   scope: 'global',
19:   name: 'mint-changes-cache',
…
25:   hostScoped: true,
```

### `mint-discover-cache` — `app/features/mint/data/mintDiscoverCache.ts@HEAD`

```text
…
1: import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
…
17: export const mintDiscoverCache = createQueryCacheStore<DiscoverMintsResponse>({
18:   scope: 'global',
19:   name: 'mint-discover-cache',
…
23:   hostScoped: true,
```

### `nip46-activity-store` — `app/features/nostrSigner/data/nip46ActivityStore.ts@HEAD`

```text
…
40: 
41: const MAX_SUMMARY_LENGTH = 120;
42: const ACTIVITY_MAX_AGE_MS = ACTIVITY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
43: 
44: /** Structured human-readable summary, computed by the engine at log time. */
…
71: 
72: const PersistedSummary = z.looseObject({
73:   headline: z.string().max(64).optional(),
74:   line: z.string().max(MAX_SUMMARY_LENGTH).optional(),
75:   refEventId: NostrEventIdSchema.optional(),
76:   refPubkey: NostrPubkeyHexSchema.optional(),
77: });
78: 
79: const PersistedActivityEntry = z.looseObject({
80:   id: z.string().max(128),
81:   clientPubkey: NostrPubkeyHexSchema,
82:   method: Nip46MethodSchema,
83:   kind: EventKindSchema.optional(),
…
85:   summary: PersistedSummary.optional(),
86:   contentPreview: z.string().max(MAX_SUMMARY_LENGTH).optional(),
87:   eventId: NostrEventIdSchema.optional(),
88:   at: z.int().min(0),
89: });
90: 
91: const PersistedActivityStore = z.object({
92:   // Tolerant: this is an audit log, and `method`/`verdict` are enums that grow
93:   // with the protocol. Bare, a single row carrying a value this build does not
94:   // know — a method added in a later version, a verdict retired in an earlier
…
157:       storage: profileStorage,
158:       schema: PersistedActivityStore,
159:       version: 1,
160:       partialize: (state) => ({ entries: state.entries }),
161:       afterHydrate: (state) => {
162:         if (!state) return;
163:         const pruned = pruneExpired(state.entries, Date.now());
164:         if (pruned.length !== state.entries.length) {
165:           useNip46ActivityStore.setState({ entries: pruned });
166:         }
167:       },
168:     })
```

### `nip46-connections-store` — `app/features/nostrSigner/data/nip46ConnectionsStore.ts@HEAD`

```text
…
42: 
43: const MAX_RELAYS = 8;
44: const MAX_RELAY_URL_LENGTH = 512;
45: const MAX_NAME_LENGTH = 120;
46: const MAX_URL_LENGTH = 512;
47: const MAX_IMAGE_URL_LENGTH = 1024;
48: 
49: const RELAY_URL_RE = /^wss:\/\/\S+$/;
50: 
…
115: 
116: const RelayUrlSchema = z.string().max(MAX_RELAY_URL_LENGTH).regex(RELAY_URL_RE);
117: 
118: // Signer trust store: enums here are security semantics (grant origin,
119: // decrypt methods, transport, encryption mode). Catching an unknown value to
…
121: // hard-rejects and the user re-pairs instead of the app guessing crypto state.
122: const PersistedGrant = z.looseObject({
123:   verdict: GrantVerdictSchema,
124:   // ast-grep-ignore: persisted-enum-needs-catch
125:   origin: z.enum(['pairing', 'prompt']),
126:   createdAt: z.int().min(0),
127:   lastUsedAt: z.int().min(0).optional(),
128:   useCount: z.int().min(0),
129: });
130: 
131: const PersistedPeerDecryptGrant = z.looseObject({
132:   // ast-grep-ignore: persisted-enum-needs-catch
133:   methods: z.array(z.enum(['nip04_decrypt', 'nip44_decrypt'])).min(1),
134:   createdAt: z.int().min(0),
135:   lastUsedAt: z.int().min(0).optional(),
136:   useCount: z.int().min(0),
137: });
138: 
139: const PersistedConnection = z.looseObject({
140:   clientPubkey: NostrPubkeyHexSchema,
141:   name: z.string().max(MAX_NAME_LENGTH).optional(),
142:   url: z.string().max(MAX_URL_LENGTH).optional(),
143:   image: z.string().max(MAX_IMAGE_URL_LENGTH).optional(),
144:   relays: z.array(RelayUrlSchema).min(1).max(MAX_RELAYS),
145:   // ast-grep-ignore: persisted-enum-needs-catch
146:   origin: z.enum(['bunker', 'nostrconnect']),
147:   status: ConnectionStatusSchema,
148:   mode: ConnectionModeSchema,
149:   // ast-grep-ignore: persisted-enum-needs-catch
150:   encryption: z.enum(['nip44', 'nip04']),
151:   pairedAt: z.int().min(0),
152:   lastUsedAt: z.int().min(0).optional(),
153:   requestCount: z.int().min(0),
154:   deniedCount: z.int().min(0),
155:   grants: z.record(GrantKeySchema, PersistedGrant),
156:   // `.default({})`/`.default([])` keep a blob missing these fields parseable —
157:   // a rejected blob falls back to in-memory defaults (createMergeWithSchema)
158:   // and would wipe every pairing, so default-fill rather than reject.
159:   peerDecryptGrants: z.record(NostrPubkeyHexSchema, PersistedPeerDecryptGrant).default({}),
160:   previousClientPubkeys: z.array(NostrPubkeyHexSchema).max(MAX_PREVIOUS_CLIENT_PUBKEYS).default([]),
161: });
162: 
163: // Tolerant at the app level, deliberately bare inside it. The enums below are
164: // security semantics and must never be guessed, so an unrecognized connection
165: // still hard-rejects and that app has to be re-paired — but bare, `z.record`
166: // rejected the whole map for it, and `createMergeWithSchema` then wiped EVERY
167: // pairing. The comment on `peerDecryptGrants` already names that outcome as the
168: // thing to avoid. Containing the rejection to the one app the blob could not be
…
178: // absent entirely, and every app that survives still satisfies all four.
179: const PersistedConnectionsStore = z
180:   .object({
181:     apps: tolerantRecord(NostrPubkeyHexSchema, PersistedConnection),
182:   })
…
683:       storage: profileStorage,
684:       schema: PersistedConnectionsStore,
685:       partialize: (state) => ({ apps: state.apps }),
686:     })
687:   )
688: );
```

### `nostr-media-server-store` — `app/shared/lib/nostr/media/mediaServerStore.ts@HEAD`

```text
…
24: 
25: const PersistedMediaServerStore = z.object({
26:   server: z.url().default(DEFAULT_BLOSSOM_SERVER),
27: });
28: 
29: export function normalizeMediaServer(server: string): string {
…
34: 
35: const ServerUrl = z.url();
36: 
37: /** Upload endpoints must be HTTPS origins, without credentials or URL suffixes. */
38: export function isValidHttpsUrl(server: string): boolean {
…
64:       storage: createProfileScopedStorage(),
65:       schema: PersistedMediaServerStore,
66:       logKey: 'nostr_media_server',
67:       partialize: (state) => ({ server: state.server }),
68:     })
69:   )
70: );
```

### `nostr-relay-list-store` — `app/shared/lib/nostr/outbox/relayListStore.ts@HEAD`

```text
…
43: 
44: const entrySchema = z.object({
45:   url: z.string(),
46:   read: z.boolean(),
47:   write: z.boolean(),
48: });
49: 
50: const PersistedRelayListStore = z.object({
51:   entries: z.array(entrySchema).max(64).default([]),
52:   updatedAt: z.number().default(0),
53:   hasPublished: z.boolean().default(false),
54:   // `.catch('default')`: unknown provenance degrades to "unpinned" — the
55:   // next ingested kind:10002 wins (last-writer guard only applies to
56:   // source==='relay'), converging with the relay copy. Without it one bad
57:   // value wipes the whole store, entries included.
58:   source: z.enum(['default', 'relay', 'local']).default('default').catch('default'),
59: });
60: 
61: function defaultEntries(): RelayListEntry[] {
…
121:       storage: createProfileScopedStorage(),
122:       schema: PersistedRelayListStore,
123:       logKey: 'nostr_relay_list',
124:       partialize: (state) => ({
125:         entries: state.entries,
126:         updatedAt: state.updatedAt,
127:         hasPublished: state.hasPublished,
128:         source: state.source,
129:       }),
```

### `own-profile-stats-cache` — `app/shared/lib/profile/ownProfileStatsStore.ts@HEAD`

```text
…
7: import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
…
14: export const ownProfileStatsCache = createQueryCacheStore<OwnProfileStats>({
15:   scope: 'global',
16:   name: 'own-profile-stats-cache',
…
20:   hostScoped: true,
```

### `btcmap-store` — `app/shared/stores/global/btcMapStore.ts@HEAD`

```text
…
71:  */
72: const MAX_PLACE_DETAILS_ENTRIES = 200;
73: 
74: const BTCMAP_BASE_URL = `${backendConfig.scoreApiBaseUrl}/app/btcmap`;
75: 
…
130: // writing to the store.
131: const PersistedPlacesCache = z
132:   .object({
133:     data: z.array(z.unknown()).max(200_000),
134:     timestamp: z.number().int().nonnegative(),
135:   })
136:   .nullable()
137:   .default(null);
138: 
139: const PersistedPlaceDetailEntry = z.looseObject({
140:   data: z.unknown(),
141:   timestamp: z.number().int().nonnegative(),
142: });
143: 
144: const PersistedBtcMapStore = z.object({
145:   placesCache: PersistedPlacesCache,
146:   placeDetailsCache: z.record(z.string().max(32), PersistedPlaceDetailEntry).default({}),
147: });
148: 
149: export const useBTCMapStore = create<BTCMapStore>({ name: 'btcmap-store', scope: 'global' })(
…
322:       // A cache of public map data: a bad blob is simply replaced.
323:       preserveUnreadable: false,
324:       schema: PersistedBtcMapStore,
325:       logKey: 'btc_map',
326:       partialize: (state) => ({
327:         placesCache: state.placesCache,
328:         placeDetailsCache: state.placeDetailsCache,
329:       }),
```

### `cta-store` — `app/shared/stores/global/ctaStore.ts@HEAD`

```text
…
57:       storage: AsyncStorage,
58:       schema: z.object({
59:         dismissed: z
60:           .record(
61:             z.string().max(64),
62:             z.object({
63:               at: z.number().int().nonnegative(),
64:               version: z.string().max(32).optional(),
65:               revision: z.number().int().optional().catch(undefined),
66:             })
67:           )
68:           .default({})
…
70:       }),
71:       partialize: (state) => ({ dismissed: state.dismissed }),
72:     })
73:   )
74: );
```

### `legacy-ecash-store` — `app/shared/stores/global/legacyEcashStore.ts@HEAD`

```text
…
29: const UnitTallies = tolerantRecord(
30:   z.string().max(32),
31:   z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
32: );
33: 
34: /** Left behind when the old row is removed, so support can tell that it happened. */
35: const RowRemoval = z.object({
36:   at: z.number().int().nonnegative(),
37:   groups: z.number().int().nonnegative(),
38:   /** Face value per unit. */
39:   claimed: UnitTallies,
40:   spent: UnitTallies,
…
42: });
43: type RowRemoval = z.infer<typeof RowRemoval>;
44: 
45: const PersistedLegacyEcash = z.object({
46:   groups: tolerantRecord(z.string().max(700), LegacyGroupRecordSchema),
47:   quotes: tolerantRecord(z.string().max(64), LegacyQuoteRecordSchema),
48:   rowRemoved: RowRemoval.nullable().default(null).catch(null),
49: });
50: 
…
91: 
92: const SavedBlob = z.object({ state: z.unknown() });
93: function parseJson(text: string | null): unknown {
94:   try {
95:     return text === null ? undefined : JSON.parse(text);
…
129:       storage,
130:       schema: PersistedLegacyEcash,
131:       logKey: 'legacy_ecash',
132:       partialize: (state) => ({
133:         groups: state.groups,
134:         quotes: state.quotes,
135:         rowRemoved: state.rowRemoved,
136:       }),
```

### `mempool-address-cache` — `app/shared/stores/global/mempoolAddressCache.ts@HEAD`

```text
…
18: const STALE_TTL_MS = 60_000;
19: const MAX_ENTRIES = 100;
20: 
21: interface MempoolAddressCacheEntry {
22:   stats: MempoolAddressStats;
…
31: 
32: const PersistedMempoolAddressCache = z.object({
33:   byAddress: z
34:     .record(
35:       z.string().max(256),
36:       z.looseObject({
37:         stats: z.unknown(),
38:         fetchedAt: z.number().int().nonnegative(),
39:       })
40:     )
41:     .default({}),
…
109:       storage: AsyncStorage,
110:       schema: PersistedMempoolAddressCache,
111:       logKey: 'mempool_address',
112:       partialize: (state) => ({ byAddress: state.byAddress }),
113:     })
114:   )
115: );
```

### `mint-metadata-store` — `app/shared/stores/global/mintMetadataStore.ts@HEAD`

```text
…
45: 
46: const MAX_ENTRIES = 200;
47: 
48: /** Freshness groups. Each stamps its own `*At` and revalidates independently. */
49: type MintMetaGroup = 'identity' | 'reviews' | 'audit' | 'social';
…
120: // rehydrate and let consumers re-fetch on a miss.
121: const PersistedMintMetadataEntry = z.looseObject({
122:   info: z.unknown().optional(),
123:   // Additive optional field (persist-safe): untrusted upstream wire shape,
124:   // envelope-only like `info`.
125:   nuts: z.record(z.string(), z.unknown()).optional(),
126:   displayName: z.string().max(256).optional(),
127:   iconUrl: z.string().max(2048).optional(),
128:   description: z.string().max(4096).optional(),
129:   supportedUnits: z.array(z.string().max(16)).max(64).optional(),
130:   identityAt: z.number().int().nonnegative().optional(),
131:   averageScore: z.number().nullable().optional(),
132:   reviewCount: z.number().int().nonnegative().optional(),
133:   favouriteCount: z.number().int().nonnegative().optional(),
134:   reviewsAt: z.number().int().nonnegative().optional(),
135:   auditData: z.unknown().optional(),
136:   auditScore: z.number().nullable().optional(),
137:   auditState: z.string().max(32).optional(),
138:   nMints: z.number().int().optional(),
139:   nMelts: z.number().int().optional(),
140:   nErrors: z.number().int().optional(),
141:   auditAt: z.number().int().nonnegative().optional(),
142:   uptime24h: z.number().optional().catch(undefined),
143:   avgLatencyMs: z.number().optional().catch(undefined),
144:   auditSource: z.enum(['ucash', '8333']).optional().catch(undefined),
145:   auditUpdatedAt: z
146:     .union([z.number(), z.string().max(128)])
147:     .optional()
148:     .catch(undefined),
149:   contactFollowers: z.number().int().nonnegative().optional(),
150:   contactReputation: z.number().nullable().optional(),
151:   operatorPubkey: z.string().max(128).optional(),
152:   operatorNpub: z.string().max(128).optional(),
153:   vertexRank: z.number().optional(),
154:   socialAt: z.number().int().nonnegative().optional(),
155:   // liveness — additive, tolerant: a shape drift here costs the field, never the store.
156:   liveness: z.enum(['online', 'offline']).optional().catch(undefined),
157:   livenessAt: z.number().int().nonnegative().optional().catch(undefined),
158:   livenessSource: z.enum(['probe', 'nagg']).optional().catch(undefined),
159: });
160: 
161: const PersistedMintMetadataStore = z.object({
162:   byMintUrl: z.record(z.string().max(2048), PersistedMintMetadataEntry).default({}),
163:   legacyMigrated: z.boolean().default(false),
164: });
165: 
166: /** True when the entry is missing, the group was never stamped, or its stamp is older than the window. */
…
395:         storage: AsyncStorage,
396:         schema: PersistedMintMetadataStore,
397:         logKey: 'mint_metadata',
398:         partialize: (state) => ({
399:           byMintUrl: state.byMintUrl,
400:           legacyMigrated: state.legacyMigrated,
401:         }),
…
558: // malformed; an entry that isn't an object at all is skipped.
559: const LegacyRecord = z.record(z.string(), z.unknown()).optional().catch(undefined);
560: 
561: const LegacyEnvelope = z.object({
562:   state: z.object({ byMintUrl: LegacyRecord, cache: LegacyRecord }).optional().catch(undefined),
563: });
564: 
565: const legacyTimestamp = z.number().optional().catch(undefined);
566: 
567: /**
568:  * The NUT-06 fields the import projects. The full `GetInfoResponse` shape is
…
571:  */
572: const LegacyMintInfo = z.looseObject({
573:   name: z.string().optional().catch(undefined),
574:   icon_url: z.string().optional().catch(undefined),
575:   description: z.string().optional().catch(undefined),
576: });
577: 
578: /** Auditor fields `auditScalarsFrom` / `selectMintAudit` read. */
579: const LegacyAuditData = z.looseObject({
580:   url: z.string(),
581:   name: z.string(),
582:   state: z.string(),
583:   n_mints: z.number(),
584:   n_melts: z.number(),
585:   n_errors: z.number(),
586:   swaps: z.array(z.looseObject({ state: z.string() })),
587: });
588: 
589: const LegacyInfoCacheEntry = z.object({
590:   info: LegacyMintInfo.optional().catch(undefined),
591:   fetchedAt: legacyTimestamp,
592: });
593: 
594: const LegacyAuditCacheEntry = z.object({
595:   auditData: LegacyAuditData.optional().catch(undefined),
596:   mintInfo: LegacyMintInfo.optional().catch(undefined),
597:   timestamp: legacyTimestamp,
…
599: 
600: const LegacyProfileCacheEntry = z.object({
601:   followers: z.number().optional().catch(undefined),
602:   reputation: z.number().nullable().optional().catch(undefined),
603:   timestamp: legacyTimestamp,
604: });
605: 
606: const LegacyKymCacheEntry = z.object({
607:   score: z.number().nullable().optional().catch(undefined),
608:   recommendations: z.array(z.unknown()).optional().catch(undefined),
609:   timestamp: legacyTimestamp,
610: });
611: 
…
626: /** Parse each legacy entry with `schema`, skipping entries that aren't objects. */
627: function legacyEntries<T>(source: Record<string, unknown>, schema: z.ZodType<T>): [string, T][] {
628:   return Object.entries(source).flatMap(([k, v]) => {
629:     const parsed = schema.safeParse(v);
630:     return parsed.success ? [[k, parsed.data] as [string, T]] : [];
…
634: // Spine-validated above; the full NUT-06 / auditor types are owned upstream.
635: const asMintInfo = (info: z.infer<typeof LegacyMintInfo>) => info as GetInfoResponse;
636: const asAuditData = (audit: z.infer<typeof LegacyAuditData>) => audit as LegacyMintAudit;
637: 
638: export async function migrateLegacyMintCaches(): Promise<void> {
639:   if (useMintMetadataStore.getState().legacyMigrated) return;
```

### `mint-testnut-store` — `app/shared/stores/global/mintTestnutStore.ts@HEAD`

```text
…
34: 
35: const MAX_ENTRIES = 500;
36: 
37: interface MintTestnutEntry {
38:   testnut: boolean;
…
44: 
45: const PersistedMintTestnutEntry = z.looseObject({
46:   testnut: z.boolean().default(false).catch(false),
47:   probedAt: z.number().int().nonnegative().optional().catch(undefined),
48:   checkedAt: z.number().int().nonnegative().default(0).catch(0),
49: });
50: 
51: const PersistedMintTestnutStore = z.object({
52:   byMintUrl: z.record(z.string().max(2048), PersistedMintTestnutEntry).default({}),
53: });
54: 
55: interface MintTestnutState {
…
117:       storage: AsyncStorage,
118:       schema: PersistedMintTestnutStore,
119:       logKey: 'mint_testnut',
120:       partialize: (state) => ({ byMintUrl: state.byMintUrl }),
121:     })
122:   )
123: );
```

### `nostr-metadata-cache` — `app/shared/stores/global/nostrMetadataCache.ts@HEAD`

```text
…
35: export const NOSTR_METADATA_STALE_TTL_MS = 24 * 60 * 60 * 1000;
36: const MAX_ENTRIES = 500;
37: 
38: /** `records` itself when under the cap; otherwise a copy without the oldest tenth. */
39: function capEntries(
…
69:  * The kind-0 profile fields, with the length caps that bound what a relay can
70:  * push into the persisted cache. Each field is `.catch(undefined)`: one
71:  * oversized or malformed value drops THAT field, never the entry and never the
72:  * whole persisted blob (the standard merge discards everything on a single
73:  * parse failure — one 3 KB picture URL used to wipe every cached name on boot).
…
79: const NOSTR_PROFILE_FIELDS = {
80:   displayName: z.string().max(512).optional().catch(undefined),
81:   name: z.string().max(512).optional().catch(undefined),
82:   picture: z.string().max(2048).optional().catch(undefined),
83:   banner: z.string().max(2048).optional().catch(undefined),
84:   nip05: z.string().max(512).optional().catch(undefined),
85:   lud16: z.string().max(512).optional().catch(undefined),
86:   website: z.string().max(2048).optional().catch(undefined),
87:   about: z.string().max(4096).optional().catch(undefined),
88: };
89: 
90: /**
…
100:  */
101: export const Kind0MetadataSchema = z.looseObject({
102:   display_name: z.string().max(512).optional(),
103:   ...NOSTR_PROFILE_FIELDS,
104: });
105: 
106: const PersistedNostrMetadataEntry = z.looseObject({
107:   ...NOSTR_PROFILE_FIELDS,
108:   fetchedAt: z.number().int().nonnegative(),
109: });
110: 
111: const PersistedNostrMetadataCache = z.object({
112:   byPubkey: z.record(z.string().max(128), PersistedNostrMetadataEntry).default({}),
113: });
114: 
115: export const useNostrMetadataCache = create<NostrMetadataCacheState>({
…
129:       storage: createProfileScopedStorage(),
130:       schema: PersistedNostrMetadataCache,
131:       logKey: 'nostr_metadata',
132:       partialize: (state) => ({ byPubkey: state.byPubkey }),
133:     })
134:   )
135: );
```

### `pricelist-store` — `app/shared/stores/global/pricelistStore.ts@HEAD`

```text
…
41: 
42: const PersistedPricelistStore = z.object({
43:   pricelist: z
44:     .looseObject(
45:       Object.fromEntries(
46:         FIAT_UNITS.map((unit) => [unit, z.looseObject({ btc: z.number() }).optional()])
47:       )
48:     )
49:     .nullable()
50:     .default(null),
51:   lastUpdated: z.number().int().nonnegative().nullable().default(null),
52:   serverUpdatedAt: z.number().int().nonnegative().nullable().default(null).catch(null),
53: });
54: 
55: export const usePricelistStore = create<PricelistStore>({
…
108:       storage: AsyncStorage,
109:       schema: PersistedPricelistStore,
110:       partialize: (state) => ({
111:         pricelist: state.pricelist,
112:         lastUpdated: state.lastUpdated,
113:         serverUpdatedAt: state.serverUpdatedAt,
114:       }),
```

### `profile-store` — `app/shared/stores/global/profileStore.ts@HEAD`

```text
…
111: 
112: const PersistedProfileEntry = z.looseObject({
113:   accountIndex: z.number().int(),
114:   pubkey: z.string().max(128),
115:   addedAt: z.number().int().nonnegative(),
116:   cachedBalanceSats: z.number().int().nonnegative().optional(),
117:   // `source` drives custody: 'imported' loads the nsec from SecureStore,
118:   // anything else silently derives keys from the seed (NostrKeysProvider).
119:   // A MISSING value historically means derived — `.optional()` preserves
…
124:   // global profile store, including coco migration completion flags.
125:   source: z.enum(['derived', 'imported']).catch('imported').optional(),
126:   externalChain: z.number().int().nonnegative().optional(),
127:   cachedDisplayName: z.string().max(512).optional(),
128:   cachedPicture: z.string().max(2048).optional(),
129:   // Absent means not recorded, which never asks for a restore. An unreadable
130:   // value is read the same way; rejecting it would discard the whole store.
131:   walletDatabaseCreated: z.boolean().optional().catch(undefined),
132:   // Absent means not recorded, which checks nothing. An unreadable value is
133:   // read the same way; rejecting it would discard the whole store.
134:   walletPhraseFingerprint: z.string().max(64).optional().catch(undefined),
135: });
136: 
137: /**
…
147: 
148: const PersistedProfileStore = z.object({
149:   activeAccountIndex: z.number().int().default(0),
150:   profiles: z.array(PersistedProfileEntry).default([]),
151: });
152: 
153: /**
…
158:  */
159: export const PROFILE_STORE_PERSIST_VERSION = 2;
160: 
161: type V2Persisted = {
162:   activeAccountIndex: number;
163:   profiles: ProfileEntry[];
164: };
…
172:  */
173: function migrateProfileStore(state: unknown, version: number): V2Persisted {
174:   if (version < 2 && state && typeof state === 'object') {
175:     const { cocoMigrationComplete: _dropped, ...rest } = state as Record<string, unknown>;
176:     return rest as V2Persisted;
…
345:       storage: AsyncStorage,
346:       schema: PersistedProfileStore,
347:       version: PROFILE_STORE_PERSIST_VERSION,
348:       migrate: migrateProfileStore,
349:       partialize: (state) => ({
350:         activeAccountIndex: state.activeAccountIndex,
351:         profiles: state.profiles,
352:       }),
```

### `relay-metadata-store` — `app/shared/stores/global/relayMetadataStore.ts@HEAD`

```text
…
30: 
31: const MAX_ENTRIES = 200;
32: /** NIP-11 identity cadence — matches mint identity (24h). */
33: const INFO_TTL_MS = 24 * 60 * 60 * 1000;
34: /** Negative cache: an unreachable relay is retried at most every 10 minutes. */
…
52: 
53: const PersistedRelayMetadataEntry = z.looseObject({
54:   info: RelayInformationSchema.optional().catch(undefined),
55:   fetchedAt: z.number().int().nonnegative().optional().catch(undefined),
56:   failedAt: z.number().int().nonnegative().optional().catch(undefined),
57: });
58: 
59: const PersistedRelayMetadataStore = z.object({
60:   byRelayUrl: z.record(z.string().max(2048), PersistedRelayMetadataEntry).default({}),
61: });
62: 
63: interface RelayMetadataState {
…
127:       storage: AsyncStorage,
128:       schema: PersistedRelayMetadataStore,
129:       logKey: 'relay_metadata',
130:       partialize: (state) => ({ byRelayUrl: state.byRelayUrl }),
131:     })
132:   )
133: );
```

### `settings-store` — `app/shared/stores/global/settingsStore.ts@HEAD`

```text
…
10: 
11: // Separate, non-persisted status: setting an error must never write default settings over unreadable data.
12: export const useSettingsHydration = create<{ status: 'loading' | 'ready' | 'error' }>({
13:   name: 'useSettingsHydration',
14:   scope: 'global',
…
47: interface SettingsState {
48:   lastKnownAppVersion: z.infer<typeof PersistedLastKnownAppVersion>;
49:   language: string;
50:   displayBtc: number;
51:   displayCurrency: DisplayCurrency;
…
129: // shows on every launch), `hasSeenOnboarding`, and every other setting. A
130: // renamed `z.enum` value on a device that persisted the old name is exactly
131: // this trap: the Balance-split rename `hero-minimal` → `list` wiped settings
132: // this way (symptom in logs: `store.settings.merge_rejected`).
133: //
…
140: // bump `version` + add a `migrate`. See skill `sovran-data` + AGENTS.md.
141: const PersistedTermsAccepted = z
142:   .object({
143:     termsAccepted: z.boolean(),
144:     date: z.string().max(64),
145:   })
146:   .nullable();
147: 
148: const PersistedMiddlemanRouting = z.looseObject({
149:   // `.catch` keeps a stale/out-of-range value from failing the whole-blob parse
150:   // (which would discard the entire settings store, incl. terms acceptance).
151:   maxHops: z.number().int().min(1).max(8).default(2).catch(2),
152:   maxFee: z.number().int().nonnegative().default(5).catch(5),
153:   minSuccessRate: z.number().min(0).max(1).default(0.9).catch(0.9),
154:   requireLastOk: z.boolean().default(true).catch(true),
155:   trustMode: z
156:     .enum(['trusted_only', 'allow_untrusted'])
157:     .default('trusted_only')
…
168: 
169: const PersistedLastKnownAppVersion = z
170:   .object({
171:     version: z.string().max(32),
172:     minVersion: z.string().max(32).optional(),
173:     message: z.string().max(280).optional(),
174:     fetchedAt: z.number().int().nonnegative(),
175:   })
176:   .nullable()
177:   .default(null)
…
179: 
180: const PersistedSettings = z.object({
181:   lastKnownAppVersion: PersistedLastKnownAppVersion,
182:   language: z.string().max(16).default('en').catch('en'),
183:   displayBtc: z.number().int().min(0).max(8).default(3).catch(3),
184:   displayCurrency: z.enum(FIAT_UNITS).default('usd').catch('usd'),
185:   experimental: z.boolean().default(false).catch(false),
186:   mockMode: z.boolean().default(false).catch(false),
187:   mockOffline: z.boolean().default(false).catch(false),
188:   mockFailSend: z.boolean().default(false).catch(false),
189:   mockFailMelt: z.boolean().default(false).catch(false),
190:   mockFailPaymentRequest: z.boolean().default(false).catch(false),
191:   whitenoiseEnabled: z.boolean().default(false).catch(false),
192:   inProcessProfileSwitch: z.boolean().default(false).catch(false),
193:   mockNoGlass: z.boolean().default(false).catch(false),
194:   layoutGuides: z.boolean().default(false).catch(false),
195:   showTouches: z.boolean().default(false).catch(false),
196:   // `.catch(null)` so a malformed terms record only resets terms (re-prompt),
197:   // never takes the rest of the store (real settings) down with it.
198:   termsAccepted: PersistedTermsAccepted.default(null).catch(null),
…
200:     .object({
201:       termsRevision: z.string().regex(/^[a-f0-9]{64}$/),
202:       privacyRevision: z.string().regex(/^[a-f0-9]{64}$/),
203:       acceptedAt: z.iso.datetime(),
204:     })
205:     .nullable()
206:     .default(null)
207:     .catch(null),
208:   hasSeenOnboarding: z.boolean().default(false).catch(false),
209:   quickAccessP2PK: z.boolean().default(false).catch(false),
210:   regenerateP2PKOnReceive: z.boolean().default(true).catch(true),
211:   sendLocationEnabled: z.boolean().default(false).catch(false),
212:   fileLoggingEnabled: z.boolean().default(false).catch(false),
213:   vertexCreditsEnabled: z.boolean().default(true).catch(true),
214:   naggTierEnabled: z.boolean().default(true).catch(true),
215:   primalTierEnabled: z.boolean().default(true).catch(true),
216:   relayTierEnabled: z.boolean().default(true).catch(true),
217:   /**
218:    * Primal cache hosts the user switched OFF, by url.
219:    *
…
224:    */
225:   primalHostsDisabled: tolerantArray(z.string().max(2048), 16)
226:     .default([])
227:     .catch(() => []),
228:   minTransferThreshold: z.number().int().nonnegative().default(5).catch(5),
229:   middlemanRouting: PersistedMiddlemanRouting.default(DEFAULT_MIDDLEMAN_ROUTING_PERSISTED).catch(
230:     DEFAULT_MIDDLEMAN_ROUTING_PERSISTED
231:   ),
…
267: interface SettingsActions {
268:   setLastKnownAppVersion: (version: NonNullable<SettingsState['lastKnownAppVersion']>) => void;
269:   // Display settings
270:   setDisplayBtc: (display: number) => void;
271:   getDisplayBtc: () => number;
…
474:         storage: AsyncStorage,
475:         schema: PersistedSettings,
476:         // Every setting stands on its own: one that cannot be read must not
477:         // cost terms acceptance, onboarding or the rest.
478:         independentFields: true,
479:         // v1 -> v2: force every mock flag off. Mock mode (and its fixture
480:         // identities Bob/Alice) must never persist into a shipped/updated
481:         // install — it was leaking through after the toggle was disabled. This
…
484:         // any fixture metadata that already leaked into the cache.
485:         version: 4,
486:         migrate: (state) => {
487:           const persisted = (state ?? {}) as z.infer<typeof PersistedSettings>;
488:           return {
489:             ...persisted,
490:             // v3 -> v4: one-time developer reset (mirrors the wallpaper/theme
…
512:             ...(!Object.keys(persisted).includes('hasSeenOnboarding') &&
513:             persisted.termsAccepted?.termsAccepted === true
514:               ? { hasSeenOnboarding: true }
515:               : {}),
516:             // `avatarFallbackVariant` (the removed avatar-style picker enum) is
517:             // deliberately absent here: old blobs of any version still carry
518:             // the key, the plain `z.object` in `merge` strips unknown keys, and
519:             // the first persist write drops it from disk (partialize no longer
520:             // emits it) — same pattern as the removed `balanceSplitVariant`;
521:             // see settingsStorePersistResilience.test.ts. Do NOT re-add a field
…
525:         },
526:         partialize: (state) => ({
527:           lastKnownAppVersion: state.lastKnownAppVersion,
528:           language: state.language,
529:           displayBtc: state.displayBtc,
530:           displayCurrency: state.displayCurrency,
531:           experimental: state.experimental,
532:           mockMode: state.mockMode,
533:           mockOffline: state.mockOffline,
534:           mockFailSend: state.mockFailSend,
535:           mockFailMelt: state.mockFailMelt,
536:           mockFailPaymentRequest: state.mockFailPaymentRequest,
537:           whitenoiseEnabled: state.whitenoiseEnabled,
538:           inProcessProfileSwitch: state.inProcessProfileSwitch,
539:           mockNoGlass: state.mockNoGlass,
540:           layoutGuides: state.layoutGuides,
541:           showTouches: state.showTouches,
542:           termsAccepted: state.termsAccepted,
543:           legalAcceptance: state.legalAcceptance,
544:           hasSeenOnboarding: state.hasSeenOnboarding,
545:           quickAccessP2PK: state.quickAccessP2PK,
546:           regenerateP2PKOnReceive: state.regenerateP2PKOnReceive,
547:           sendLocationEnabled: state.sendLocationEnabled,
548:           fileLoggingEnabled: state.fileLoggingEnabled,
549:           minTransferThreshold: state.minTransferThreshold,
550:           middlemanRouting: state.middlemanRouting,
551:           vertexCreditsEnabled: state.vertexCreditsEnabled,
552:           naggTierEnabled: state.naggTierEnabled,
553:           primalTierEnabled: state.primalTierEnabled,
554:           relayTierEnabled: state.relayTierEnabled,
555:           primalHostsDisabled: state.primalHostsDisabled,
556:         }),
```

### `wallet-lifecycle` — `app/shared/stores/global/walletLifecycleStore.ts@HEAD`

```text
…
33: 
34: const PersistedWalletLifecycleStore = z.object({
35:   seedCreatedAt: z.number().int().nonnegative().nullable().default(null),
36:   recoveryPhraseVerifiedAt: z.number().int().nonnegative().nullable().default(null).catch(null),
37:   recoveryPhraseVerifiedRevision: z.number().int().nullable().default(null).catch(null),
38:   // `.catch('unknown')`: 'unknown' is the genuine neutral member — AppGate
39:   // re-resolves it. Without the catch, an unrecognized status fails the
40:   // whole-blob parse and wipes `seedCreatedAt` too, which is exactly the
…
45:     .catch('unknown'),
46:   lastRestoreAt: z.number().int().nonnegative().nullable().default(null),
47:   lastRestoreError: z.string().max(500).nullable().default(null),
48: });
49: 
50: export const useWalletLifecycleStore = create<WalletLifecycleState>({
…
79:       storage: AsyncStorage,
80:       schema: PersistedWalletLifecycleStore,
81:       logKey: 'wallet_lifecycle',
82:       partialize: (s) => ({
83:         seedCreatedAt: s.seedCreatedAt,
84:         recoveryPhraseVerifiedAt: s.recoveryPhraseVerifiedAt,
85:         recoveryPhraseVerifiedRevision: s.recoveryPhraseVerifiedRevision,
86:         restoreStatus: s.restoreStatus,
87:         lastRestoreAt: s.lastRestoreAt,
88:         lastRestoreError: s.lastRestoreError,
89:       }),
```

### `wallpaper-store` — `app/shared/stores/global/wallpaperStore.ts@HEAD`

```text
…
96: // malformed entry doesn't drop the whole catalog on rehydrate.
97: const PersistedCatalogEntry = z.looseObject({
98:   themeName: z.string().max(64),
99:   blossomUrl: z.string().max(2048),
100:   albumSlug: z.string().max(64),
101: });
102: 
103: const PersistedDownloadedWallpaper = z.looseObject({
104:   themeName: z.string().max(64),
105:   blossomUrl: z.string().max(2048),
106:   albumSlug: z.string().max(64),
107:   localUri: z.string().max(4096),
108:   downloadedAt: z.number().int().nonnegative(),
109: });
110: 
111: const PersistedAlbumMeta = z.looseObject({
112:   slug: z.string().max(64),
113:   topic: z.string().max(64),
114: });
115: 
116: const PersistedWallpaperStore = z.object({
117:   catalog: z.array(PersistedCatalogEntry).max(10_000).default([]),
118:   albums: z.array(PersistedAlbumMeta).max(1_000).default([]),
119:   catalogLastFetched: z.number().int().nonnegative().default(0),
120:   downloaded: z.record(z.string().max(64), PersistedDownloadedWallpaper).default({}),
121: });
122: 
123: // ---------------------------------------------------------------------------
…
299:       storage: AsyncStorage,
300:       schema: PersistedWallpaperStore,
301:       partialize: (state) => ({
302:         catalog: state.catalog,
303:         albums: state.albums,
304:         catalogLastFetched: state.catalogLastFetched,
305:         downloaded: state.downloaded,
306:         // _hasHydrated and activeDownloads are excluded (transient)
307:       }),
```

### `ai-provider-directory-store` — `app/shared/stores/profile/aiProviderDirectoryStore.ts@HEAD`

```text
…
34: /** nagg caps its own payload at 256 rows; match it rather than guess. */
35: const MAX_PROVIDERS = 256;
36: 
37: /**
38:  * How long a persisted directory is worth painting.
…
50:  * the blob, and not the neighbouring stores. There is no rename here to
51:  * migrate: this is a new key, and a future one has to bump `version`.
52:  */
53: const PersistedServerProvider = z.looseObject({
54:   baseUrl: z.string().min(1).max(512),
55:   name: z.string().max(200).optional().catch(undefined),
56:   pubkey: z.string().max(128).optional().catch(undefined),
57:   /** Absent when nagg could not resolve the operator's reach. A measured zero
58:    *  is a different fact and survives as `0`. */
59:   followers: z.number().int().nonnegative().optional().catch(undefined),
60:   followersSource: z.enum(['graph', 'vertex', 'relays']).optional().catch(undefined),
61:   modelCount: z.number().int().nonnegative().optional().catch(undefined),
62:   encryptedModelCount: z.number().int().nonnegative().optional().catch(undefined),
63:   minMessageSats: z.number().int().positive().optional().catch(undefined),
64:   mints: z
65:     .array(z.string().max(512))
66:     .max(64)
67:     .default([])
68:     .catch(() => []),
69:   status: z.enum(['online', 'offline', 'unknown']).default('unknown').catch('unknown'),
70:   latencyMs: z.number().nonnegative().optional().catch(undefined),
71: });
72: 
73: const PersistedAiProviderDirectory = z.object({
74:   providers: tolerantArray(PersistedServerProvider, MAX_PROVIDERS).default([]),
75:   /** Epoch ms of the read that produced `providers`, or `null` when nothing
76:    *  has ever been read. Never a `Date` — this blob is JSON. */
77:   fetchedAt: z.number().int().nonnegative().nullable().default(null).catch(null),
78: });
79: 
80: interface AiProviderDirectoryState {
…
111:       storage: createProfileScopedStorage(),
112:       schema: PersistedAiProviderDirectory,
113:       logKey: 'ai_provider_directory',
114:       partialize: (state) => ({
115:         providers: state.providers,
116:         fetchedAt: state.fetchedAt,
117:       }),
```

### `data-migration-store` — `app/shared/stores/profile/dataMigrationStore.ts@HEAD`

```text
…
28: 
29: const PersistedDataMigrationStore = z.object({
30:   level: z.number().int().nonnegative().default(0),
31: });
32: 
33: export const useDataMigrationStore = create<DataMigrationState>({
…
41:       storage: createProfileScopedStorage(),
42:       schema: PersistedDataMigrationStore,
43:       logKey: 'data_migration',
44:       partialize: (state) => ({ level: state.level }),
45:     })
46:   )
47: );
```

### `dm-last-message-store` — `app/shared/stores/profile/dmLastMessageStore.ts@HEAD`

```text
…
9: 
10: const MAX_PEERS = 500;
11: 
12: const LastMessageSchema = z.object({
13:   // Unknown protocols drop only this disposable metadata entry, never invent
14:   // evidence that the peer used a supported transport.
15:   // ast-grep-ignore: persisted-enum-needs-catch
16:   protocol: z.enum(['nip04', 'nip17', 'whitenoise', 'bitchat']),
17:   atSeconds: z.number().int().nonnegative(),
18:   isOwn: z.boolean(),
19: });
20: 
21: type LastMessageEntry = z.infer<typeof LastMessageSchema>;
22: 
23: function boundPeers(byPeer: Record<string, LastMessageEntry>): Record<string, LastMessageEntry> {
24:   if (Object.keys(byPeer).length <= MAX_PEERS) return byPeer;
…
31: 
32: const PersistedDmLastMessageStore = z.object({
33:   byPeer: tolerantRecord(NostrPubkeyHexSchema, LastMessageSchema)
34:     .catch(() => ({}))
35:     .transform(boundPeers),
…
64:       storage: createProfileScopedStorage(),
65:       schema: PersistedDmLastMessageStore,
66:       partialize: (state) => ({ byPeer: state.byPeer }),
67:     })
68:   )
69: );
```

### `mint-distribution-store` — `app/shared/stores/profile/mintDistributionStore.ts@HEAD`

```text
…
49: 
50: const PersistedMintDistributionStore = z.object({
51:   distributions: z
52:     .record(
53:       z.string().max(16),
54:       z.record(z.string().max(2048), z.number().int().min(0).max(TOTAL_BASIS_POINTS).catch(0))
55:     )
56:     .default({}),
57: });
…
471:         storage: createProfileScopedStorage(),
472:         schema: PersistedMintDistributionStore,
473:         logKey: 'mint_dist',
474:         partialize: (state) => ({ distributions: state.distributions }),
475:         afterHydrate: (state, error) => {
476:           if (!error && __DEV__) {
477:             storeLog.debug('store.mint_dist.rehydrated', { distributions: state?.distributions });
478:           }
479:         },
480:       })
```

### `mint-store` — `app/shared/stores/profile/mintStore.ts@HEAD`

```text
…
52: 
53: type V1Persisted = { selectedMints?: Record<string, string | undefined> };
54: type V2Persisted = { selectedMint?: string };
55: 
56: const PersistedMintStore = z.object({
57:   selectedMint: z.string().max(2048).optional(),
58:   // Additive tolerant field (no version bump needed): old blobs rehydrate to
59:   // 'sat'; an unknown persisted value degrades to 'sat' instead of wiping the
60:   // store (sovran-data persisted-schema invariant).
61:   // The wallet's account units (registry-derived); growing it is additive.
62:   activeUnit: z.enum(ACCOUNT_UNITS).default('sat').catch('sat'),
63:   // Additive tolerant field: a corrupt map degrades to {} (new standing
64:   // quotes get created and re-recorded) instead of wiping the store.
65:   standingQuotes: z
66:     .record(z.string(), z.string().max(256))
67:     .default({})
68:     .catch(() => ({})),
69:   receiveMintByMethod: z
70:     .record(z.string(), z.string().max(2048))
71:     .default({})
72:     .catch(() => ({})),
73:   // Additive tolerant field: corrupt value degrades to false (lock off).
74:   creqP2pkLock: z.boolean().default(false).catch(false),
75:   // Additive tolerant field: a corrupt map degrades to {} (all mints
76:   // advertised again) instead of wiping the store.
77:   creqExcludedMints: z
78:     .record(z.string().max(2048), z.boolean())
79:     .default({})
80:     .catch(() => ({})),
81:   // `bip321ExcludedRails` (Unified per-rail opt-outs) was removed with its
82:   // switches: the Unified request now always carries every available rail.
83:   // Old blobs still holding it parse fine — z.object strips the unknown key.
84: });
85: 
86: // v1 -> v2: the storage seam (createProfileScopedStorage) already partitions
…
102: // mismatch, so an "already current" branch would be unreachable.
103: function migrateMintStore(state: unknown, version: number): V2Persisted {
104:   let s: unknown = state;
105:   if (version < 2) s = v1ToV2(s);
106:   return s as V2Persisted;
…
166:       storage: profileStorage,
167:       schema: PersistedMintStore,
168:       version: 2,
169:       migrate: migrateMintStore,
170:       partialize: (state) => ({
171:         selectedMint: state.selectedMint,
172:         activeUnit: state.activeUnit,
173:         standingQuotes: state.standingQuotes,
174:         receiveMintByMethod: state.receiveMintByMethod,
175:         creqP2pkLock: state.creqP2pkLock,
176:         creqExcludedMints: state.creqExcludedMints,
177:       }),
```

### `nostr-social-store` — `app/shared/stores/profile/nostrSocialStore.ts@HEAD`

```text
…
38:  */
39: const MAX_ENGAGEMENT_ENTRIES = 5000;
40: 
41: type FollowOptimisticState = {
42:   value: boolean;
…
83: /** Recency cap for the durable zapped map (mirrors the engagement cap idea). */
84: const MAX_ZAPPED_ENTRIES = 2000;
85: 
86: interface NostrSocialState {
87:   contactsTags: string[][];
…
304: /** Per-store SHAPE migration (vs the cross-store dataMigrations registry). */
305: export function migrateNostrSocialStore(state: unknown, version: number): unknown {
306:   let s = state;
307:   if (version < 2) s = v1ToV2(s);
308:   return s;
…
350: // the merge falls back to defaults.
351: const PersistedEngagementAction = z.looseObject({
352:   ownEventId: z.string().max(128).optional(),
353: });
354: const PersistedEngagementRecord = z.looseObject({
355:   liked: PersistedEngagementAction.optional(),
356:   reposted: PersistedEngagementAction.optional(),
357:   replied: PersistedEngagementAction.optional(),
358:   updatedAt: z.number().int().nonnegative(),
359: });
360: const PersistedFollowOptimistic = z.looseObject({
361:   value: z.boolean(),
362:   pending: z.boolean(),
363:   updatedAt: z.number().int().nonnegative(),
364: });
365: const PersistedEngagementOptimistic = z.looseObject({
366:   value: z.boolean(),
367:   pending: z.boolean(),
368:   delta: z.number(),
369:   expectedCount: z.number().int().optional(),
370:   relatedEventId: z.string().max(128).optional(),
371:   updatedAt: z.number().int().nonnegative(),
372: });
373: 
374: const PersistedZapOptimistic = z.looseObject({
375:   deltaSats: z.number(),
376:   pending: z.boolean(),
377:   expectedSats: z.number().int().optional(),
378:   updatedAt: z.number().int().nonnegative(),
379: });
380: 
381: const PersistedZappedRecord = z.looseObject({
382:   totalSats: z.number(),
383:   updatedAt: z.number().int().nonnegative(),
384: });
385: 
386: const PersistedNostrSocialStore = z.object({
387:   contactsTags: z
388:     .array(z.array(z.string().max(2048)).max(16))
389:     .max(50_000)
390:     .default([]),
391:   contactsContent: z.string().max(65_536).default(''),
392:   contactsUpdatedAt: z.number().int().nonnegative().default(0),
393:   // Tolerant: the follow set is a set — the `true` carries no information, so
394:   // a corrupt value has nothing to fall back to. Bare, one bad entry would
395:   // reject the blob and take contactsTags, the engagement map and the deleted
396:   // -note ids with it; contained, it costs exactly the one follow.
397:   followingPubkeys: tolerantRecord(z.string().max(128), z.literal(true)),
398:   engagementByEventId: z.record(z.string().max(128), PersistedEngagementRecord).default({}),
399:   deletedRepostOriginalIds: z
400:     .record(z.string().max(128), z.number().int().nonnegative())
401:     .default({}),
402:   deletedNoteIds: z.record(z.string().max(128), z.number().int().nonnegative()).default({}),
403:   optimisticFollowsByPubkey: z.record(z.string().max(128), PersistedFollowOptimistic).default({}),
404:   optimisticLikesByEventId: z
405:     .record(z.string().max(128), PersistedEngagementOptimistic)
406:     .default({}),
407:   optimisticRepostsByEventId: z
408:     .record(z.string().max(128), PersistedEngagementOptimistic)
409:     .default({}),
410:   optimisticZapsByEventId: z.record(z.string().max(128), PersistedZapOptimistic).default({}),
411:   zappedByEventId: z.record(z.string().max(128), PersistedZappedRecord).default({}),
412: });
413: 
414: export const useNostrSocialStore = create<NostrSocialStore>({
…
711:       storage: createProfileScopedStorage(),
712:       schema: PersistedNostrSocialStore,
713:       logKey: 'nostr_social',
714:       version: 2,
715:       migrate: migrateNostrSocialStore,
716:       partialize: (state) => ({
717:         contactsTags: state.contactsTags,
718:         contactsContent: state.contactsContent,
719:         contactsUpdatedAt: state.contactsUpdatedAt,
720:         followingPubkeys: state.followingPubkeys,
721:         engagementByEventId: state.engagementByEventId,
722:         deletedRepostOriginalIds: state.deletedRepostOriginalIds,
723:         deletedNoteIds: state.deletedNoteIds,
724:         optimisticFollowsByPubkey: state.optimisticFollowsByPubkey,
725:         optimisticLikesByEventId: state.optimisticLikesByEventId,
726:         optimisticRepostsByEventId: state.optimisticRepostsByEventId,
727:         optimisticZapsByEventId: state.optimisticZapsByEventId,
728:         zappedByEventId: state.zappedByEventId,
729:       }),
```

### `npc-mint-store` — `app/shared/stores/profile/npcMintStore.ts@HEAD`

```text
…
32: 
33: type V1Persisted = { mintUrls?: Record<string, string | undefined> };
34: type V2Persisted = { mintUrl?: string };
35: 
36: function npcClientForKey(privateKey: Uint8Array) {
37:   return createNpcClient(async (eventTemplate: EventTemplate): Promise<VerifiedEvent> =>
…
41: 
42: const PersistedNpcMintStore = z.object({
43:   mintUrl: z.string().max(2048).optional(),
44: });
45: 
46: // v1 -> v2: legacy `mintUrls: Record<pubkey, url>` was double-scoped inside
…
60: // Append-only migration chain. Zustand only calls migrate on version mismatch.
61: function migrateNpcMintStore(state: unknown, version: number): V2Persisted {
62:   let s: unknown = state;
63:   if (version < 2) s = v1ToV2(s);
64:   return s as V2Persisted;
…
103:         storage: createProfileScopedStorage(),
104:         schema: PersistedNpcMintStore,
105:         logKey: 'npc_mint',
106:         version: 2,
107:         migrate: migrateNpcMintStore,
108:         partialize: (state) => ({ mintUrl: state.mintUrl }),
109:       })
110:     )
111:   )
```

### `nut-drop-redeem-queue` — `app/shared/stores/profile/nutDropRedeemQueueStore.ts@HEAD`

```text
…
97: const TERMINAL_TTL_MS = 24 * 60 * 60 * 1000;
98: const MAX_ATTEMPTS = 5;
99: const BASE_BACKOFF_MS = 30 * 1000;
100: const MAX_BACKOFF_MS = 30 * 60 * 1000;
101: 
102: const STATUS_VALUES = [
103:   'pending',
…
127: 
128: const PersistedNutDropRedeemQueueStore = z.object({
129:   byTokenHash: z
130:     .record(
131:       z.string().max(NUT_DROP_QUEUE_LIMITS.tokenHash),
132:       z.looseObject({
133:         token: z.string().min(1).max(NUT_DROP_QUEUE_LIMITS.token),
134:         mintUrl: z.string().min(1).max(NUT_DROP_QUEUE_LIMITS.mintUrl),
135:         amount: z.number().int().nonnegative(),
136:         unit: z.string().max(NUT_DROP_QUEUE_LIMITS.unit),
137:         // Forward-compatible persisted status: an older build that opens a
138:         // queue written by a newer build must keep the locked ecash and retry
139:         // it, not reject the whole profile-scoped blob. Mint redemption is
140:         // idempotent, so `pending` is the funds-safe fallback.
141:         status: z.enum(STATUS_VALUES).default('pending').catch('pending'),
142:         attempts: z.number().int().nonnegative(),
143:         nextAttemptAt: z.number().int().nonnegative(),
144:         receivedAt: z.number().int().nonnegative(),
145:         lastError: z.string().max(NUT_DROP_QUEUE_LIMITS.lastError).optional(),
146:         senderPeerID: z.string().max(128).optional(),
147:         paymentId: z.string().max(128).optional(),
148:         // Additive and tolerant: an unknown source from a newer build reads as
149:         // absent (the mesh default, the stricter path), never a rejected blob.
150:         source: z.enum(REDEEM_SOURCES).optional().catch(undefined),
151:         senderPubkey: z
152:           .string()
153:           .regex(/^[a-f0-9]{64}$/)
…
282:       storage: createProfileScopedStorage(),
283:       schema: PersistedNutDropRedeemQueueStore,
284:       logKey: 'nut_drop_queue',
285:       partialize: (state) => ({
286:         byTokenHash: state.byTokenHash,
287:       }),
288:     })
```

### `own-content-store` — `app/shared/stores/profile/ownContentStore.ts@HEAD`

```text
…
100: 
101: const PersistedFeedEvent = z.looseObject({
102:   id: z.string().max(128),
103:   kind: z.number().int(),
104:   pubkey: z.string().max(128),
105:   content: z.string().max(65_536),
106:   tags: z.array(z.array(z.string().max(8192)).max(200)).max(5000),
107:   created_at: z.number().int().nonnegative(),
108: });
109: 
110: const PersistedOwnEntry = z.looseObject({
111:   event: PersistedFeedEvent,
112:   authorPubkey: z.string().max(128),
113:   // `.catch('local')`: an unknown future status must not wipe the own-content
114:   // blob. 'local' is the neutral fallback — the entry ages out via the cutoff
115:   // instead of overclaiming 'confirmed' or re-entering publish flows.
116:   status: z.enum(['pending', 'local', 'confirmed']).catch('local'),
117:   updatedAt: z.number().int().nonnegative(),
118: });
119: 
120: const PersistedOwnContentStore = z.object({
121:   byId: z.record(z.string().max(128), PersistedOwnEntry).default({}),
122: });
123: 
124: export const useOwnContentStore = create<OwnContentStore>({
…
182:       storage: createProfileScopedStorage(),
183:       schema: PersistedOwnContentStore,
184:       logKey: 'own_content',
185:       // Persist `pending` as `local`: an app-kill mid-publish should rehydrate
186:       // as a recoverable local copy, never a stuck pending. A live pending that
187:       // fails is removed (removeOwn) and so leaves storage too.
188:       partialize: (state) => ({
189:         byId: Object.fromEntries(
190:           Object.entries(state.byId).map(([id, entry]) => [
191:             id,
192:             entry.status === 'pending' ? { ...entry, status: 'local' as const } : entry,
193:           ])
194:         ),
195:       }),
```

### `owned-media-store` — `app/shared/stores/profile/ownedMediaStore.ts@HEAD`

```text
…
66: 
67: const PersistedEntry = z.looseObject({
68:   sha256: z.string().max(64),
69:   url: z.string().max(2048),
70:   host: z.string().max(512),
71:   mimeType: z.string().max(256).optional(),
72:   purpose: z.enum(['avatar', 'post']).optional().catch(undefined),
73:   sourceNoteIds: z.array(z.string().max(128)).max(2000).default([]),
74:   firstSeen: z.number().int().nonnegative(),
75:   lastSeen: z.number().int().nonnegative(),
76:   // Deliberately bare: `deleteState` encodes deletion intent — catching an
77:   // unknown state to 'live' resurfaces media the user may have deleted. The
78:   // per-entry safeParse below drops just the bad row; a genuinely live blob
…
80:   // ast-grep-ignore: persisted-enum-needs-catch
81:   deleteState: z.enum(['live', 'delete-requested', 'deleted', 'delete-failed']),
82:   lastCheckedAt: z.number().int().nonnegative().optional(),
83: });
84: 
85: const PersistedOwnedMediaStore = z.object({
86:   // An entry with an unrecognized `deleteState` (written by a newer build) is
87:   // dropped alone instead of failing the whole-blob parse, which would
88:   // discard the entire ownership ledger.
89:   byBlob: tolerantRecord(z.string().max(600), PersistedEntry),
90: });
91: 
92: export const useOwnedMediaStore = create<OwnedMediaStore>({
…
173:       storage: createProfileScopedStorage(),
174:       schema: PersistedOwnedMediaStore,
175:       logKey: 'owned_media',
176:       partialize: (state) => ({ byBlob: state.byBlob }),
177:     })
178:   )
179: );
```

### `own-profile-metadata-store` — `app/shared/stores/profile/ownProfileMetadataStore.ts@HEAD`

```text
…
6: 
7: export const OwnProfileSnapshotSchema = z.object({
8:   content: z.record(z.string(), z.unknown()),
9:   /** unix seconds (kind-0 `created_at`); persisted under this name */
10:   createdAt: z.number().int().nonnegative(),
11:   eventId: z.string().length(64),
12: });
13: export type OwnProfileSnapshot = z.infer<typeof OwnProfileSnapshotSchema>;
14: /** `null` removes the key from the published kind-0; `undefined` leaves it. */
15: export interface OwnProfilePatch {
16:   name?: string;
…
28: export const PROFILE_HISTORY_PER_FIELD = 5;
29: const HistoryEntrySchema = z.object({
30:   value: z.string().max(4096),
31:   /** `created_at` of the kind-0 that last carried this value. */
32:   createdAt: z.number().int().nonnegative(),
33: });
34: type ProfileHistoryEntry = z.infer<typeof HistoryEntrySchema>;
35: type ProfileHistory = Partial<Record<ProfileHistoryField, ProfileHistoryEntry[]>>;
36: const ProfileHistorySchema = z
37:   .partialRecord(
38:     z.enum(PROFILE_HISTORY_FIELDS),
39:     z.array(HistoryEntrySchema).max(PROFILE_HISTORY_PER_FIELD)
40:   )
41:   .default({})
42:   .catch(() => ({}));
…
119:       storage: createProfileScopedStorage(),
120:       schema: z.object({
121:         latest: OwnProfileSnapshotSchema.nullable().default(null).catch(null),
122:         history: ProfileHistorySchema,
123:       }),
124:       partialize: (state) => ({ latest: state.latest, history: state.history }),
125:     })
126:   )
127: );
```

### `recent-people-store` — `app/shared/stores/profile/recentPeopleStore.ts@HEAD`

```text
…
123: // (a thrown element would make createMergeWithSchema discard the whole blob).
124: const RecentPersonReasonSchema = z.enum(['search', 'peer']).default('search').catch('search');
125: 
126: const PersistedRecentPersonEntry = z.looseObject({
127:   pubkey: NostrPubkeyHexSchema,
128:   firstOpenedAt: z.number().int().nonnegative(),
129:   lastOpenedAt: z.number().int().nonnegative(),
130:   reason: RecentPersonReasonSchema,
131:   displayName: z.string().optional(),
132: });
133: 
134: const PersistedRecentPeopleStore = z.object({
135:   entries: z.array(PersistedRecentPersonEntry).max(MAX_RECENT_PEOPLE).default([]),
136: });
137: 
138: export const useRecentPeopleStore = create<RecentPeopleState>({
…
161:       storage: createProfileScopedStorage(),
162:       schema: PersistedRecentPeopleStore,
163:       logKey: 'recent_people',
164:       partialize: (state) => ({ entries: state.entries }),
165:     })
166:   )
167: );
```

### `routstr-store` — `app/shared/stores/profile/routstrStore.ts@HEAD`

```text
…
383:    *
384:    * Derived from `providerClaims` below and never persisted: what is durable
385:    * is what each party SAID, and which of them wins is a rule in code that a
386:    * later build is allowed to change its mind about.
387:    *
…
694: // collapse to [] and drop only the attachments, never the message.
695: const PersistedChatAttachment = z.object({
696:   localUri: z.string().max(2048),
697:   mimeType: z.string().max(64),
698:   width: z.number().int().nonnegative().catch(0),
699:   height: z.number().int().nonnegative().catch(0),
700: });
701: 
702: const PersistedRoutstrMessage = z.looseObject({
703:   id: z.string().max(128),
704:   // Deliberately bare: `role` is attribution — catching a bad value to
705:   // 'assistant' would re-attribute the user's text as model output and
706:   // replay it to the model as its own words. The per-message safeParse in
…
708:   // ast-grep-ignore: persisted-enum-needs-catch
709:   role: z.enum(['user', 'assistant']),
710:   content: z.string().max(65_536),
711:   timestamp: z.number().int().nonnegative(),
712:   attachments: z
713:     .array(PersistedChatAttachment)
714:     .max(4)
…
716:     .catch(() => []),
717:   parentId: z.string().max(128).nullable().optional(),
718:   thinkingDurationSec: z.number().nonnegative().optional(),
719:   reasoningContent: z.string().max(65_536).optional(),
720:   costSats: z.number().int().nonnegative().optional(),
721:   modelSwitch: z.object({ from: z.string(), to: z.string() }).optional().catch(undefined),
722:   pending: z.boolean().optional(),
723: });
724: 
725: // A message whose role can't be trusted is dropped alone (a hole in the
…
744:  */
745: const MAX_PERSISTED_SESSIONS = 1024;
746: const MAX_PERSISTED_SESSION_MESSAGES = 10_000;
747: 
748: const PersistedRoutstrMessages = tolerantArray(
749:   PersistedRoutstrMessage,
750:   MAX_PERSISTED_SESSION_MESSAGES
751: );
…
956:     watching<S>(merge: Merge<S>, keep: (loaded: S, before: S) => S): Merge<S> {
957:       return (persisted, current) => {
958:         const merged = merge(persisted, current);
959:         // The schema merge hands back `current` itself when it turns a blob down.
960:         const turnedDown = isRecord(persisted) && merged === current;
961:         load = turnedDown ? 'rejected' : 'accepted';
962:         return !turnedDown && savedDuringLoad && merged !== current
963:           ? keep(merged, current)
…
1025: 
1026: const PersistedRoutstrSession = z.looseObject({
1027:   id: z.string().max(128),
1028:   title: z.string().max(512),
1029:   createdAt: z.number().int().nonnegative(),
1030:   messages: PersistedRoutstrMessages,
1031:   activeChildren: z.record(z.string().max(128), z.string().max(128)).optional(),
1032: });
1033: 
1034: /**
…
1044: // growth, not to be reached.
1045: const MAX_KNOWN_PROVIDERS = 256;
1046: 
1047: /** One party's statement. Every field optional and tolerant: a source that
1048:  *  starts sending a shape we did not expect costs that field, not the row. */
1049: const PersistedProviderClaim = z.looseObject({
1050:   name: z.string().max(200).optional().catch(undefined),
1051:   description: z.string().max(2000).optional().catch(undefined),
1052:   version: z.string().max(64).optional().catch(undefined),
1053:   pubkey: z.string().max(128).optional().catch(undefined),
1054:   /** Empty means it publishes no list, which reads as "any mint". */
1055:   mints: tolerantArray(z.string().max(512), 32).optional().catch(undefined),
1056:   /** True when its catalog carried at least one `tinfoil-` model. Absent until
1057:    *  a catalog has been read for it — absence of evidence. */
1058:   e2ee: z.boolean().optional().catch(undefined),
1059: });
1060: 
1061: /** A source this build no longer knows is dropped rather than kept as an
…
1063:  *  would have no standing to be shown by. */
1064: const PersistedProviderRecord = z.looseObject({
1065:   claims: z
1066:     .partialRecord(
1067:       z.enum(['self', 'announcement', 'aggregator', 'peer', 'catalog', 'legacy']),
1068:       PersistedProviderClaim
1069:     )
1070:     .default({})
…
1073: 
1074: const MAX_ARCHIVED_ACCOUNTS = 32;
1075: 
1076: const PersistedRoutstrAccount = z.looseObject({
1077:   apiKey: z.string().max(8192),
1078:   nodeBaseUrl: z.string().max(512).nullable().default(null).catch(null),
1079:   lastKnownBalanceMsats: z.number().nullable().default(null).catch(null),
1080:   archivedAt: z.number().int().nonnegative().default(0).catch(0),
1081:   reclaimedAt: z.number().int().nonnegative().nullable().default(null).catch(null),
1082: });
1083: 
1084: // `tolerantRecord` rather than a bare `z.record` on purpose: under `z.record`
1085: // one malformed row rejects the record, and through `createMergeWithSchema`
1086: // the whole blob — so a single bad entry would take every OTHER provider's key
1087: // with it. Here it loses one row.
1088: const PersistedLegacyAccounts = tolerantRecord(z.string().max(512), PersistedRoutstrAccount);
1089: 
1090: const PersistedPendingPayment = z.looseObject({
1091:   encoded: z.string().max(65_536),
1092:   nodeBaseUrl: z.string().max(512),
1093:   operationId: z.string().max(128),
1094:   startedAt: z.number().int().nonnegative().default(0).catch(0),
1095: });
1096: 
1097: const PersistedRoutstrStore = z.object({
1098:   authMode: z.enum(['bearer', 'x-cashu']).default('bearer').catch('bearer'),
1099:   serverLineupAt: z.number().int().nonnegative().nullable().default(null).catch(null),
1100:   apiKey: z.string().max(8192).nullable().default(null),
1101:   balance: z.number().nullable().default(null),
1102:   selectedModel: z.string().max(256).nullable().default(null),
1103:   sessions: z.array(PersistedRoutstrSession).max(MAX_PERSISTED_SESSIONS).default([]),
1104:   currentSessionId: z.string().max(128).nullable().default(null),
1105:   // Additive + tolerant (no version bump needed): a malformed snapshot
1106:   // parses to null and the menu just re-derives on next fetch.
1107:   lastKnownLineup: PersistedLineupSchema.nullable().default(null).catch(null),
…
1109:   // falls back to the built-in default node.
1110:   nodeBaseUrl: z.string().max(512).nullable().default(null).catch(null),
1111:   // Additive.
1112:   legacyAccounts: PersistedLegacyAccounts,
1113:   // Additive + tolerant: a malformed value parses to null, which simply means
1114:   // "follow nagg" — the default.
1115:   userNodeBaseUrl: z.string().max(512).nullable().default(null).catch(null),
1116:   // Additive + tolerant, same reasoning as `legacyAccounts`: one malformed
1117:   // provider row must cost that row, not the directory.
1118:   providerClaims: tolerantRecord(z.string().max(512), PersistedProviderRecord),
1119:   providerSeenAt: tolerantRecord(z.string().max(512), z.number().int().nonnegative()),
1120:   pendingPayments: tolerantRecord(z.string().max(128), PersistedPendingPayment),
1121:   // Additive, and defaulting to ON: spending is the kind of thing that should
1122:   // have to be turned off deliberately, never left off by a parse failure.
1123:   confirmSpend: z.boolean().default(true).catch(true),
1124:   // Additive + tolerant: a malformed list parses to null and the lineup derives
1125:   // against the whole catalog until the relays answer again.
1126:   curatedModels: z
1127:     .object({
1128:       ids: z.array(z.string().max(128)).max(512),
1129:       blacklistedNodes: z.array(z.string().max(512)).max(256).default([]),
1130:       whitelistedNodes: z.array(z.string().max(512)).max(256).default([]),
1131:       updatedAt: z.number().int().nonnegative().default(0),
1132:       fetchedAt: z.number().int().nonnegative().default(0),
1133:     })
1134:     .nullable()
1135:     .default(null)
…
1659:       // The adapter rebuilds the blob with its secrets; see `preserveUnreadable`.
1660:       preserveUnreadable: false,
1661:       schema: PersistedRoutstrStore,
1662:       // v2: bring back the spend prompt for everyone who had turned it off.
1663:       //
1664:       // `confirmSpend: false` could only ever be written by the "Always allow"
…
1690:       // and the row must not re-render because a probe said hello.
1691:       version: 3,
1692:       migrate: (state, version) => {
1693:         const blob: Record<string, unknown> = { ...(state as Record<string, unknown> | null) };
1694:         // Every released blob is older than this version, so every one of them
1695:         // passes through here on its first load.
…
1722:                     : {}),
1723:                   ...(typeof provider.version === 'string' ? { version: provider.version } : {}),
1724:                   ...(typeof provider.pubkey === 'string' ? { pubkey: provider.pubkey } : {}),
1725:                   ...(Array.isArray(provider.mints) ? { mints: provider.mints } : {}),
1726:                   ...(typeof provider.e2ee === 'boolean' ? { e2ee: provider.e2ee } : {}),
…
1737:       },
1738:       partialize: (state) => ({
1739:         apiKey: state.apiKey,
1740:         authMode: state.authMode,
1741:         serverLineupAt: state.serverLineupAt,
1742:         balance: state.balance,
1743:         selectedModel: state.selectedModel,
1744:         // The ceilings are applied HERE, not at each writer. Sessions grow in
1745:         // one place but a session's messages are mirrored from
1746:         // `conversationHistory` through several, and a cap repeated at every
1747:         // writer is a cap that drifts. `partialize` is the one point where
1748:         // store state becomes the persisted blob, so it is where the blob has
1749:         // to be made to fit. Live state is untouched: the running session
1750:         // keeps its full transcript for as long as the app is open.
1751:         sessions: boundedSessions(state.sessions, state.currentSessionId),
1752:         currentSessionId: state.currentSessionId,
1753:         lastKnownLineup: state.lastKnownLineup,
1754:         nodeBaseUrl: state.nodeBaseUrl,
1755:         legacyAccounts: boundedAccounts(state.legacyAccounts),
1756:         providerClaims: boundedClaims(state.providerClaims, state.providerSeenAt),
1757:         providerSeenAt: state.providerSeenAt,
1758:         userNodeBaseUrl: state.userNodeBaseUrl,
1759:         // Age is not evidence of settlement. Keep the only recovery token
1760:         // until the receive/refund path explicitly completes this payment.
1761:         pendingPayments: state.pendingPayments,
1762:         confirmSpend: state.confirmSpend,
1763:         curatedModels: state.curatedModels,
1764:       }),
```

### `scan-history-store` — `app/shared/stores/profile/scanHistoryStore.ts@HEAD`

```text
…
22: /** Cap matches `searchHistoryStore`'s MAX_RECENT_SEARCHES convention; tail-evicts oldest. */
23: const MAX_SCAN_HISTORY = 500;
24: 
25: /** Longest scanned string that is kept. A longer one is not recorded. */
26: const MAX_SCAN_RAW_LENGTH = 16_384;
27: 
28: /** The newest `MAX_SCAN_HISTORY` entries. The same array when it already fits. */
29: function newestScans<T extends { scannedAt: number }>(entries: T[]): T[] {
…
115: // `processed` validate via `looseObject` and the value ages out via the cap.
116: const PersistedScanEntry = z.looseObject({
117:   id: z.string().max(128),
118:   // No length limit on reading: earlier releases saved any length.
119:   raw: z.string(),
120:   // `.catch(...)`: display metadata — an unrecognized value must not fail the
121:   // parse and discard the whole scan-history blob. Unknown types render as
122:   // 'unknown'; an unknown source falls back to the plain qr icon.
…
125:     .catch('unknown'),
126:   source: z.enum(['qr', 'nfc', 'paste', 'deeplink']).catch('qr'),
127:   inputType: z.string().max(64).optional(),
128:   container: z.string().max(64).optional(),
129:   optionKinds: z.array(z.string().max(128)).max(64).optional(),
130:   scannedAt: z.number().int().nonnegative(),
131:   transactionId: z.string().max(256).optional(),
132: });
133: 
134: // Releases before 0.1.3 saved every scan, of any length, and a schema that
…
141: // records its shape.
142: const PersistedScanHistoryStore = z.object({
143:   entries: z
144:     .array(PersistedScanEntry.optional().catch(undefined))
145:     .transform((entries) => entries.filter((entry) => entry !== undefined))
…
221:         storage: profileStorage,
222:         schema: PersistedScanHistoryStore,
223:         partialize: (state) => ({ entries: state.entries }),
224:         afterHydrate: (state) => {
225:           if (state) {
226:             state.entriesByTransactionId = buildEntriesByTransactionId(state.entries);
227:           }
228:         },
229:       })
```

### `search-history-store` — `app/shared/stores/profile/searchHistoryStore.ts@HEAD`

```text
…
8: /** Maximum number of recent searches to store */
9: const MAX_RECENT_SEARCHES = 10;
10: 
11: /** A single search history entry */
12: interface SearchHistoryEntry {
…
38: 
39: const PersistedSearchEntry = z.looseObject({
40:   query: z.string().max(2048),
41:   timestamp: z.number().int().nonnegative(),
42:   context: z.string().max(64).optional(),
43: });
44: 
45: const PersistedSearchHistoryStore = z.object({
46:   recentSearches: z
47:     .record(z.string().max(64), z.array(PersistedSearchEntry).max(MAX_RECENT_SEARCHES))
48:     .default({}),
49: });
50: 
…
103:       storage: createProfileScopedStorage(),
104:       schema: PersistedSearchHistoryStore,
105:       partialize: (state) => ({ recentSearches: state.recentSearches }),
106:     })
107:   )
108: );
```

### `send-reachability-store` — `app/shared/stores/profile/sendReachabilityStore.ts@HEAD`

```text
…
40: 
41: const PersistedSendReachabilityEntry = z.looseObject({
42:   // Deliberately bare: `status` IS the entry's payload — an unknown future
43:   // value can't be mapped onto an existing reachability claim; the per-entry
44:   // safeParse below drops just the bad row instead of the blob.
45:   // ast-grep-ignore: persisted-enum-needs-catch
46:   status: z.enum(SEND_REACHABILITY_STATUSES),
47:   mintUrl: z.string().min(1).max(2048),
48:   updatedAt: z.number().int().nonnegative(),
49: });
50: 
51: const PersistedSendReachabilityStore = z.object({
52:   // An entry with an unrecognized `status` (written by a newer build) is
53:   // dropped alone — `useSendReachability` already returns null for a missing
54:   // key — instead of failing the whole-blob parse and wiping every entry.
55:   byTransactionId: tolerantRecord(z.string().max(256), PersistedSendReachabilityEntry),
56: });
57: 
58: function setStatus(
…
105:       storage: createProfileScopedStorage(),
106:       schema: PersistedSendReachabilityStore,
107:       logKey: 'send_reachability',
108:       partialize: (state) => ({
109:         byTransactionId: state.byTransactionId,
110:       }),
111:     })
```

### `swap-transactions-store` — `app/shared/stores/profile/swapTransactionsStore.ts@HEAD`

```text
…
153:   .catch('failed');
154: const SwapGroupStateSchema = z.enum(['running', 'finished', 'cancelled']).catch('cancelled');
155: 
156: const PersistedLeg = z.looseObject({
157:   id: z.string().max(128),
158:   fromMintUrl: z.string().max(2048),
159:   toMintUrl: z.string().max(2048),
160:   amount: z.number().int().nonnegative(),
161:   mintQuoteId: z.string().max(256).optional(),
162:   mintOperationId: z.string().max(256).optional(),
163:   meltQuoteId: z.string().max(256).optional(),
164:   meltOperationId: z.string().max(256).optional(),
165:   chainId: z.string().max(128).optional(),
166:   chainPath: z.array(z.string().max(2048)).max(16).optional(),
167:   chainHopIndex: z.number().int().nonnegative().optional(),
168:   localStatus: SwapLegLocalStatusSchema.optional(),
169:   errorMessage: z.string().max(2048).optional(),
170: });
171: 
172: const PersistedSwapGroup = z.looseObject({
173:   id: z.string().max(128),
174:   unit: z.string().max(16),
175:   createdAt: z.number().int().nonnegative(),
176:   title: z.string().max(512),
177:   state: SwapGroupStateSchema,
178:   legs: z.array(PersistedLeg).max(256),
179: });
180: 
181: const PersistedQuoteIndexEntry = z.looseObject({
182:   groupId: z.string().max(128),
183:   legId: z.string().max(128),
184:   // Deliberately bare: `kind` is funds-flow direction and must never be
185:   // guessed; the per-entry safeParse below already drops just the bad row
186:   // instead of the blob, so hard-reject is the safe failure.
187:   // ast-grep-ignore: persisted-enum-needs-catch
188:   kind: z.enum(['mint', 'melt']),
189: });
190: 
191: const PersistedQuoteIndex = tolerantRecord(z.string().max(256), PersistedQuoteIndexEntry);
192: 
193: const PersistedSwapStore = z.object({
194:   groups: z.record(z.string().max(128), PersistedSwapGroup).default({}),
195:   // A future/unknown index entry cannot safely be guessed as mint or melt.
196:   // Drop only that derived correlation; the swap groups themselves remain
197:   // available for recovery and the rest of the quote index stays intact.
…
335:       storage: createProfileScopedStorage(),
336:       schema: PersistedSwapStore,
337:       logKey: 'swap_tx',
338:       partialize: (state) => ({
339:         groups: state.groups,
340:         quoteIdToGroup: state.quoteIdToGroup,
341:       }),
```

### `theme-store` — `app/shared/stores/profile/themeStore.ts@HEAD`

```text
…
43:  */
44: const PersistedThemeStoreTolerant = PersistedThemeStore.extend({
45:   mode: ThemeMode.default(DEFAULT_MODE).catch(DEFAULT_MODE),
46: });
47: 
48: type PersistedTheme = {
49:   activeAlbumSlug: string | null;
50:   unitWallpapers: Record<UnitId, string>;
51:   mode: ThemeMode;
…
61: // storage seam partitions by profile pubkey).
62: export function migrateThemeStore(state: unknown, version: number): PersistedTheme {
63:   if (version < 2) {
64:     return { activeAlbumSlug: null, unitWallpapers: {}, mode: DEFAULT_MODE };
65:   }
…
100:       storage: profileStorage,
101:       schema: PersistedThemeStoreTolerant,
102:       version: 2,
103:       migrate: migrateThemeStore,
104:       partialize: (state) => ({
105:         activeAlbumSlug: state.activeAlbumSlug,
106:         unitWallpapers: state.unitWallpapers,
107:         mode: state.mode,
108:       }),
```

### `transaction-annotation-store` — `app/shared/stores/profile/transactionAnnotationStore.ts@HEAD`

```text
…
33: 
34: const AnnotationRecordSchema = z.record(z.string().max(64), z.string().max(16_384));
35: 
36: const PersistedTransactionAnnotationStore = z.object({
37:   // Contain malformed entries (including historical raw-token keys >256 chars)
38:   // without discarding valid annotations from the same profile.
39:   annotations: tolerantRecord(z.string().max(256), AnnotationRecordSchema),
40: });
41: 
42: // Exported only for the dev-gated e2e state mirror; app code goes through the
…
55:         storage: createProfileScopedStorage(),
56:         schema: PersistedTransactionAnnotationStore,
57:         logKey: 'tx_annotation',
58:         partialize: (state) => ({
59:           annotations: state.annotations,
60:         }),
61:       })
```

### `transaction-distribution-store` — `app/shared/stores/profile/transactionDistributionStore.ts@HEAD`

```text
…
83: 
84: const PersistedDistributionEntry = z.looseObject({
85:   // Deliberately bare: each value renders a distinct attribution icon, so an
86:   // unknown future value must never be guessed onto an existing meaning; the
87:   // per-entry safeParse below drops just the bad row instead of the blob.
88:   // ast-grep-ignore: persisted-enum-needs-catch
89:   source: z.enum(DISTRIBUTION_SOURCES),
90:   recordedAt: z.number().int().nonnegative(),
91: });
92: 
93: const PersistedTransactionDistributionStore = z.object({
94:   // An entry with an unrecognized `source` (written by a newer build) is
95:   // dropped alone — `getDistribution` already treats a missing key as "never
96:   // recorded" — instead of failing the whole-blob parse, which would wipe
97:   // every recorded distribution (persist merge discards the blob).
98:   distributions: tolerantRecord(z.string().max(256), PersistedDistributionEntry),
99: });
100: 
101: export const useTransactionDistributionStore = create<TransactionDistributionStore>({
…
142:         storage: createProfileScopedStorage(),
143:         schema: PersistedTransactionDistributionStore,
144:         logKey: 'tx_distribution',
145:         partialize: (state) => ({
146:           distributions: state.distributions,
147:         }),
148:       })
```

### `transaction-location-store` — `app/shared/stores/profile/transactionLocationStore.ts@HEAD`

```text
…
39: 
40: const PersistedTransactionLocationStore = z.object({
41:   locations: z
42:     .record(
43:       z.string().max(256),
44:       z.looseObject({
45:         latitude: z.number().min(-90).max(90),
46:         longitude: z.number().min(-180).max(180),
47:         createdAt: z.number().int().nonnegative(),
48:       })
49:     )
50:     .default({}),
…
81:       storage: createProfileScopedStorage(),
82:       schema: PersistedTransactionLocationStore,
83:       logKey: 'tx_location',
84:       partialize: (state) => ({
85:         locations: state.locations,
86:       }),
87:     })
```

### `vertex-budget-store` — `app/shared/stores/profile/vertexBudgetStore.ts@HEAD`

```text
…
10: const dayAt = (now: number) => new Date(now).toISOString().slice(0, 10);
11: const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
12: const schema = z.object({
13:   day: daySchema.or(z.literal('')).default('').catch('9999-12-31'),
14:   used: z.number().int().nonnegative().default(0).catch(VERTEX_DAILY_CAP),
15:   blockedUntilDay: daySchema.optional().catch('9999-12-31'),
16: });
17: type Budget = z.infer<typeof schema>;
18: type Store = Budget & {
19:   reserve: (now?: number) => boolean;
20:   block: (now?: number) => boolean;
…
68:         schema,
69:         partialize: (state) => ({
70:           day: state.day,
71:           used: state.used,
72:           blockedUntilDay: state.blockedUntilDay,
73:         }),
```
