# Payment flows — sweep 1

Surveyed checkout HEAD `4c80d9f5c64a2e6b5e31f2d02d9441f0fa3654fd`. Product code unchanged. Ten findings: Broken 6, Inconsistent 1, Inefficient 1, No longer needed 1, Regrown 1. Five **fix**, five **list**. All defect paths below are source-traced, not reproduced on a device or with a new regression test.

Read `AGENTS.md`, `.surgery/LEDGER.md`, and the follow-up index; searched the follow-up folder for each candidate. Excluded the already recorded payment/NFC/quote issues in F25, F57, F60, F126, F134, F136, F142, F152, F153, F173, F179–F181, F193, F197, F200–F202, F207, F213, F224, F228–F230, F234, F238 and F242. In particular, the findings below do not re-list missing live thread subscriptions (F153), upstream zero-expiry handling (F136), or cross-profile standing-quote writes (F180).

## Broken

1. **B1 — Single-rail editions never select their only receive tab. Verdict: fix.**
   - Evidence: `app/features/receive/screens/ReceiveScreen.tsx:230` initializes `selectedTab` to `Unified`; lines 444–448 set an invalid selection back to `Unified`. `app/features/receive/lib/receiveTabs.ts:18–26` omits Unified when only one rail ships. `app/shared/config/features.ts` explicitly defines `lightningOnly` and `onchainOnly`.
   - Path: open Receive → QR Display in either edition. There is one tab, so the tab strip is hidden (`ReceiveScreen.tsx:479` vicinity); the selected pane remains Unified, with no visible control to select the edition's actual rail. This is a deterministic selection error, even if Unified happens to produce a usable code.
   - Failing test idea: render QR Display with `computeReceiveTabs()` returning `['Onchain']`; assert Onchain is the active pane and the footer copies its payload.
   - Commit: initialize/fall back to the first actual tab, preserving a selection only while it remains in `tabs`.
   - Boundary: UI state only; no saved shape or protocol encoding change. Existing tab activation governs the already implemented quote work.

2. **B2 — Unified advertises quotes that their own rail refuses as expired. Verdict: list.**
   - Evidence: `app/features/receive/components/ReceiveUnifiedTab.tsx:85–101` directly composes `quote.request` into the bitcoin URI and copyable rail values. There is no expiry check. The same quotes in `ReceiveReusableQuoteTab.tsx:136–145` are checked with `isExpiryElapsed`, excluded from footer copying, and rendered as expired rather than payable.
   - Path: a BOLT 12 quote with `expiry: 0` (explicitly handled by the dedicated tab), or an expired cached standing quote awaiting replacement → open Unified → it displays and copies that request. The underlying reusable resolver intentionally accepts zero expiry (`wallet/src/quotes/reusable.ts:53–61`), so this is reachable, not just an impossible hook mock.
   - Failing test idea: give both tabs the same expired quote; assert neither QR/footer/rail copy action exposes it.
   - Boundary: no saved-data repair required, but the repair changes the request/address advertised to another wallet. Owner must choose the Unified behavior when one rail is expired: omit it with an explanation, or block until replaced. This is the app's inconsistent protection, distinct from F136's upstream expiry interpretation.

3. **B3 — Changing a receive mint leaves the former mint's payable quote under the new mint. Verdict: list.**
   - Evidence: `ReceiveReusableQuoteTab.tsx:126–145` reads `quote.request` without checking it belongs to `methodMint`; the mint row uses the current `methodMint`. `ReceiveUnifiedTab.tsx:76–87` has the same unkeyed consumption. `wallet/src/react/useReusableMintQuote.ts:138–161` sets loading on an input change but retains the previous quote; on failure it only sets error, leaving the previous quote indefinitely.
   - Path: standing onchain address for mint A is visible → choose capable mint B → delay or reject B's lookup. A's address remains visible/copyable while the mint row/selection names B. A BOLT 12 offer behaves likewise. This is within one profile; F180 does not cover it.
   - Failing test idea: resolve A, rerender with B, leave B pending and then fail it; assert A's address is never offered as B's request.
   - Boundary: no saved-data migration, but this changes what payment destination is handed to a payer. Owner must choose whether the old quote is hidden immediately or explicitly retained as an A quote; never label it B. A keyed result from the existing hook would let both app consumers enforce that choice.

4. **B4 — Removing the last mint leaves stale contacts, and can leave their spinner latched. Verdict: fix.**
   - Evidence: `app/features/payments/hooks/useMintContacts.ts:63–65` returns immediately for an empty mint list. It neither clears `mintsWithInfo` nor ends loading. The old run's cleanup marks it cancelled (lines 124–126), and its finally then refuses to clear loading (line 119). `ContactsScreen.tsx:161` consumes the result directly.
   - Path A: load one mint contact → mints becomes `[]` → that removed mint remains in `displayMints`/`mintPubkeys`. Path B: begin a delayed mint-info read → mints becomes `[]` → old result is discarded but `mintInfoLoading` stays true.
   - Failing test idea: rerender the hook with `[]`, both after success and during a deferred read; require empty rows and `mintInfoLoading === false`.
   - Commit: make empty input explicitly clear the result and loading state; retain cancellation for the former run.
   - Boundary: transient contact state only; nothing saved or sent changes.

5. **B5 — Mint-contact admission and selection use different contacts. Verdict: fix.**
   - Evidence: `useMintContacts.ts:100–107` admits a mint if **any** Nostr contact starts with `npub1`; line 146 later selects the **first** Nostr contact without that condition and tries to decode only that one.
   - Path: mint info contains `[{method:'nostr', info:'https://…'}, {method:'nostr', info:<valid npub>}]` → mint passes admission → first value fails npub decoding → `mintPubkeys` excludes a mint with a usable contact and its DM preview cannot be attached.
   - Failing test idea: put a non-npub Nostr contact before a valid npub; assert the valid contact is returned and matched to its conversation.
   - Commit: select the same eligible contact used for admission, preferably resolve it once and carry the result.
   - Boundary: local contact resolution only; no saved fields or messages change.

6. **B6 — An older conversation snapshot erases a live message that already arrived. Verdict: fix.**
   - Evidence: `app/features/payments/hooks/useDmConversations.ts:84` starts its bucket empty even when rows were seeded; lines 94–96 replace the entire bucket on the first fetched page. The independent live listener (lines 153–159) writes into that same bucket immediately. Lines 125–127 then overwrite rows and the session snapshot from whichever bucket won.
   - Path: delay the first inbox read (or a refresh) → receive live envelope L → L appears → resolve the earlier inbox snapshot without L → first-page reset removes L. On a seeded mount, the live arrival also temporarily replaces all seeded peers with its single peer because the bucket was never seeded. This affects the conversation list's existing subscription, not F153's unsubscribed thread.
   - Failing test idea: hold the inbox promise, invoke the live callback with a newer message, then resolve a snapshot without it; require L and the snapshot's other peers to remain, with newest-wins per peer.
   - Commit: retain/replay live arrivals across snapshot replacement and initialize the accumulator from the displayed seed.
   - Boundary: repair is confined to in-memory bucketing and `persist:false` session cache (`data/dmSnapshotCaches.ts`); keep durable last-message recording and network reads unchanged.

## Inconsistent

1. **I1 — Route-shell comments claim JSON/security validation that those shells do not perform. Verdict: fix.** `app/features/send/screens/LightningSendRoute.tsx:11–16`, `SendTokenRoute.tsx:12–16`, and `app/features/receive/screens/ReceiveTokenRoute.tsx:10–14` describe JSON parsing/spoof protection at the route boundary. Their schemas only bound the string length; decoding belongs to `useScreenActions`, as the Lightning receive shell partly acknowledges. This is a documentation defect, not evidence of a currently exploitable spoof. Commit: describe the actual string-bound route check and name the downstream decoder without claiming the shell validates an entry. Nothing saved or sent changes.

## Inefficient

1. **E1 — Reopening a fully cached DM thread can automatically walk its entire inbox again. Verdict: list.** `app/features/payments/hooks/useDmThread.ts:58,83–94,111,134` seeds the seen-id set from the snapshot and returns the number of **new** relevant messages as the pager's visible count. `useDmEnvelopePages.ts:98–107` continues while that count is zero. With N full pages containing only cached thread messages/other peers, each re-open or refresh performs N sequential inbox requests and N decrypt/filter passes before the final short page. The cost scales with inbox pages even though the thread already displays messages; crypto-cache hits do not eliminate the requests or filtering. No latency measurement or speed-up claim. Owner must decide how far refresh should search for new/backdated messages before yielding to explicit paging. Do not merely stop on a duplicate: NIP-59 backdating makes that unsafe. No saved shape change is needed; read scheduling changes.

## No longer needed

1. **N1 — Cursor reset has only a test caller. Verdict: list.** `app/features/payments/data/dmPagination.ts:29–45` exposes/implements `reset()`. Repository searches for `createDmEnvelopeCursor`, `DmEnvelopeCursor`, `cursor.reset(` and `cursorRef.current.reset(` found two production consumers: `useDmEnvelopePages` creates a new cursor per run; `useDmEcashAutoRedeem` creates a new cursor per walk. Only `app/__tests__/dmEnvelopeCursor.test.ts:71` calls reset. Searched all workspace trees, e2e scenarios and docs; no named/dynamic reset registration found. No knip verdict was obtained, and the test still pins behavior the method implements, so this is not an automatic deletion. Owner must decide whether reset is a supported seam; otherwise remove that method and its dedicated reset test together, retaining fresh-cursor coverage. No persistence/wire involvement.

## Regrown

1. **R1 — The shared pager has two separate notions of busy and can run two walks on one cursor. Verdict: list.** `app/features/payments/hooks/useDmEnvelopePages.ts` now owns the inbox request (latest area commit `238e79979`, following pass 3's pager consolidation), but retains `loading`, `refreshing`, `painted`, `hasLoadedOnce`, `hasMore`, `error`, and an independent `loadingMoreRef` (lines 123–141), deriving a second status at lines 319–328. `loadMore` gates on `loading`, not `refreshing` (277–315). Exact path: a previously pageable thread starts refresh; its first full page has no fresh relevant messages, so the refresh continues to a delayed second page. `loading` is false, old `hasMore` remains true, and the new cursor has an `until`; call `loadMore` now and it starts the same page on the same controller/cursor. One duplicate read can consume the fresh-id count, making the other walk falsely report end-of-history. This is a concrete regrowth consequence, not a request to convert every boolean to a type. Test idea: interleave refresh's deferred second page with loadMore and require one request/one authoritative cursor advance. Owner must choose serialization or cancellation priority, then represent one active read owner. No saved shape change; requests and paging behavior change.

## Verification and limits

- Ran individually in `app/`: `bun run test -- useMintContacts.test.ts --runInBand` (4 passed), then `bun run test -- dmThreadHistory.test.tsx --runInBand --silent` (23 passed). Read these tests: they cover normal loading, concurrency, seeding and live arrivals after initial completion; they do not exercise the interleavings above. These passing tests do not reproduce or disprove these findings.
- Used read-only git status/head/history and repository searches. The initial status was clean. No full suite, build, knip, saved checks, native harness, simulator, live mint, funded transaction or network research. One `jg` invocation was started before reading the brief's prohibition; no further `jg` use. No helper agents.
- Whole-file focus: camera scan orchestration/permission and route wrappers; send lock hooks and delivery rules; the send screen-action bridge and token/payment-request detail screens; receive hub/standing rail screens and their selection helpers; DM pager, conversation/thread/contact hooks and ecash intake/recovery; nearby discovery/send/redeem coordination; NFC acquire/read/write/APDU primitives; selected Cashu quote/account/storage adapters. Some combined read outputs were truncated; their unseen sections are not counted as reviewed.

## Not read

- This is not a whole-area certification: the seven requested roots total roughly 35,000 lines, including tests. `NearPayScreen.tsx` (2,340 lines), `peerLayout.ts`, `sovranPaymentConfig.ts` (1,779), `Colada.tsx`, `SendScreen.tsx`, `AmountSelector.tsx`, `AmountFlowScreen.tsx`, Lightning/onchain send detail bodies, `NotePickerScreen.tsx`, and their rendering/gesture paths were not read in full.
- Remaining receive fixed-amount/token/onchain detail bodies, rail-list body, `CreqCustomizationCard`, `UnifiedRailsCard`, and minor receive presentation components were not read in full. The complete camera layout/button variants and NFC decoder/CC parser tail were not read.
- Cashu manager's 2,008-line lifecycle and 630-line Nostr payment-request transport were not read in full; neither were repositories, database/drain helpers, manager internals, legacy claim/import, NPC identity, log/feedback adapters, proof-reconciliation helpers, swap reconciliation, or all onchain-mint helpers. Findings about their already recorded defects were excluded rather than independently re-audited.
- Nearby durable journal/transport, capability cryptography, celebration/strike reducers and drawing components were not read end to end. Other tests, native modules, dependency implementations and sibling wallet projects were not audited. No claims here establish protocol or money safety for these unread paths.
