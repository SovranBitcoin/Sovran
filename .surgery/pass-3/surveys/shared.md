# Pass 3 — shared code

Checkout: `/Users/kelbie/Documents/GitHub/Sovran/sovran-surgery`; inspected HEAD `999c5583ffc6b9baa2db3dadaa17dc31de9cebac`. Survey only. All paths below are checkout-relative; `hooks/`, `lib/`, `ui/`, `blocks/` abbreviate `app/shared/`; test basenames mean `app/__tests__/`.

Read the survey brief, codebase-design skill and DEEPENING, AGENTS, the pass-0 shared survey, pass-2 shared-settings survey, and pass-2 ledger. Used local reads/searches, including the TypeScript discipline guidance. No network, jg, helpers, product edits, git mutations, tests, device runs or native bundles. `bun run knip` completed successfully with no findings. Knip does not detect unused object properties or redundant arguments; none of the proposals below relies on claiming an exported module is unreachable. Initial status contained the shared untracked `.surgery/pass-3/` directory; this survey is the sole file written.

Ranked by caller obligations removed and estimated net deletion over risk. Counts are direct production invocation files, including design-system consumers, excluding tests and re-export barrels. Line estimates include callers, exclude future tests, and are estimates rather than measured patches. Tests listed were located and selectively inspected, not executed. A dependency on platform UI needs native verification even when the source transformation is mechanical. No proposal changes serialized data, keys, stored fields, wire payloads or payment policy.

## 1. Details modal: remove the open/reset handshake — L, about 35–60 net lines

**Module:** `ui/composed/DetailsSection.tsx:18–39,47–91`. **All callers (9 files):** `app/features/send/screens/{LightningSendScreen.tsx:316,SendTokenScreen.tsx:358,PaymentRequestScreen.tsx:177,OnchainSendScreen.tsx:320}`; `app/features/receive/screens/{OnchainReceiveScreen.tsx:280,LightningReceiveScreen.tsx:181,ReceiveTokenScreen.tsx:153}`; `app/features/mint/screens/MintInfoScreen.tsx:529`; `app/features/settings/design-system/walletControls.tsx:232`.

Eight screens carry a boolean which is not whether the modal is open. They set it true to request navigation, then the child immediately calls their setter with false. Quotes: `OnchainSendScreen.tsx:86` declares `[detailsOpen, setDetailsOpen]`, :241 calls `setDetailsOpen(true)`, :321–323 pass `trigger="none"`, `open={detailsOpen}`, `onOpenChange={setDetailsOpen}`. `PaymentRequestScreen.tsx:54,105,178–180` and `LightningReceiveScreen.tsx:62,110,182–184` repeat the protocol. The ninth caller needs a genuine inline preview.

**Shape/owner:** put `useDetailsSection({items,label}) -> {present}` in the existing DetailsSection module; it owns row filtering, owner identity and updates to the open modal. Keep the visible inline/preview component using that same implementation. Footer buttons call `present` directly. Delete the eight booleans, hidden JSX instances, open-change effect, and misleading open/trigger contract; retain owner-scoped live updates and the existing store/route. Do not put row data into navigation params.

**Deletion test:** simply deleting the module loses deduplication, row updates and routing; it earns its keep. Deleting its request-boolean adapter loses no user capability once `present` owns those duties. Estimated 65–90 removed, 25–35 added, net down. L because at least ten production files including the module/consumer set are involved; not a one-file cleanup.

**Risk/pins:** navigation and transient payment details, no money movement or saved change. Existing `detailsModal.test.tsx` pins live updates, owner isolation, deduplication, Copy all and route presentation; `detailsSheet.test.tsx` covers the table. Add repeat-open after dismissal and unmount while visible before the cut. Replace open/setter assertions (including source-shape checks in `mintInfoScreenSource.test.ts`) with presentation assertions. Mechanically preserving behavior is feasible; verify both native modal implementations.

## 2. One toast-host submission lifecycle — S, about 35–55 net lines

**Module:** `lib/popup/popups/bridge.ts:96–212`. **All direct callers (4 files, 5 calls):** `lib/popup/popups/engine.tsx:113` calls `showToast`; `payment.ts:43,97`, `deleteStatus.ts:27`, `notePublished.ts:17` call `showCustomToast`. The identically named local `showToast` in the mint rebalance hook is unrelated.

`showToast` and `showCustomToast` each allocate an ID, check registration, call `manager.show`, translate duration, and wrap show/hide callbacks. Compare bridge :111–117 / :175–181, and :133–155 / :191–210. Their callers supply different rendering, not different host lifetimes: `engine.tsx:103–113` builds a standard config; `notePublished.ts:17–35` supplies a renderer and 3000 ms duration; `payment.ts:97` supplies the persistent renderer.

**Shape/owner:** keep the two meaningful public interfaces, but make bridge own one private submission implementation. `showToast` supplies the CompactToast/probe renderer; `showCustomToast` supplies its renderer. Preserve the existing distinct telemetry event names, fields, callback timing and missing-host behavior. Delete the repeated manager/lifecycle block. This is not a new port: the existing ToastManager seam already has production and test adapters.

**Deletion test:** removing bridge loses manager registration, instrumentation and rendering integration; removing the second copy of submission loses nothing. Roughly 60–80 deleted, 25 added; net down. S, mechanical with snapshot assertions on instrumentation. Do not silently repair F187 during the refactor.

**Risk/pins:** transient UI, including payment notifications; no stored or wire changes. `toastRenderProbeBridge.test.tsx`, `staticPopupRenderedProbe.test.ts`, `serviceErrorPopup.test.ts`, `swapStatusPopupLifecycle.test.ts`. The latter mocks the bridge, so does not prove its host behavior. Pin both actual bridge entrypoints against a fake manager: refusal, callback order/count, IDs, custom props and static probe timing. Keep those interface tests; delete no meaningful tests.

## 3. GlassSearchBar: shared text input contract, platform-only chrome — M, about 25–40 net lines

**Module:** `ui/composed/GlassSearchBar/useDebouncedSearchText.ts:3–50`. **All callers (2):** `GlassSearchBar.android.tsx:29` and `GlassSearchBar.ios.tsx:30` in the same directory.

Each platform must both pass `clearKey` to the debounce hook and separately use it as the native input key, forward `seedText`, disable correction/capitalization and expose search accessibility. Android :29,48–67: `useDebouncedSearchText({ onChangeText, debounceMs, clearKey })` and `key={clearKey}`. iOS :30,35–55 repeats them. Clear cancels a pending event only if the hook and input lifetimes remain aligned.

**Shape/owner:** deepen the existing GlassSearchBar module with an internal search-input component that owns the debounce hook and all nonvisual TextInput props. Platforms pass appearance/layout and wrap that input in their existing materials. Keep `clearKey`, seed-on-remount semantics and native font/layout differences unchanged. Delete duplicate input wiring and the Android inputRef (no reader other than the ref assignment).

**Deletion test:** the debounce helper itself earns its keep; delete it only by moving its implementation into the shared input, not by dropping cancellation. Platform wrappers still earn their keep. Remove roughly 60 lines, add 25–35; net down. M, mechanical only after keyboard/refocus/clear behavior is pinned.

**Risk/pins:** input and accessibility, no stored/network change. No dedicated GlassSearchBar behavior test found. `androidPortalFlags.test.ts` references the platform surface, not the full debounce contract. Add fake-timer tests for typing, clear, callback replacement, unmount and seed reset, plus native search/header checks on both platforms. No existing debounce test suite to delete.

## 4. Copy operation and success acknowledgement have separate owners — L, about 10–20 net lines

**Module:** `lib/popup/popups/copy.ts:5–81`, with representative UI callers `ui/composed/CopyableValue.tsx:40–42` and `blocks/PaymentInfo.tsx:110–111`.

**All callers (13 files, 16 calls):** those two; `lib/popup/popups/emojiPicker.tsx:31`; `app/features/send/lib/sovranPaymentConfig.ts:493,1679,1729`; `app/features/receive/screens/{ReceiveScreen.tsx:338,ReceiveRailListScreen.tsx:283}`; `app/features/receive/components/{CreqCustomizationCard.tsx:95,ReceiveUnifiedTab.tsx:170,177,ReceiveReusableQuoteTab.tsx:240}`; `app/features/user/screens/{ShareScreen.tsx:143,UserProfileScreen.tsx:1239}`; `app/features/settings/screens/SettingsKeyringScreen.tsx:510`; `app/features/settings/components/ProfileDetailsScreen.tsx:86`.

Most callers must remember “await clipboard, then announce success”: `PaymentInfo.tsx:110–111` uses `await Clipboard.setStringAsync(selectedValue); copyPopup(copyTarget)`; `ReceiveReusableQuoteTab.tsx:239–240` repeats it; `ShareScreen.tsx:142–143` repeats it. Rail-list :282 instead uses `void setStringAsync`, exposing D1 below. The payment bridge at sovranPaymentConfig :493 is a success-notification callback for a write owned elsewhere: do not copy twice there.

**Shape/owner:** add `copyText(value, target, overrides?)` in the existing copy module, awaiting the native clipboard then invoking its private copy presentation. Retain an explicitly named notification-only entry for the wallet screen-action callback that already owns writing. Preserve copy strings, haptics at callers, icon overrides and rejection propagation. No generic clipboard service or new injection interface is needed; mock the existing external clipboard dependency in tests.

**Deletion test:** catalogue wrappers own useful copy, so deleting them would scatter wording. The repeated await/notify protocol can disappear. Remove roughly 25–35 repeated lines/imports, add 15; net down, modest deletion but a meaningful ordering obligation removed. L. Convert awaited callers mechanically; fix rail-list ordering separately because that changes behavior.

**Risk/pins:** keys/payment strings reach the clipboard already; never log value or add retention. Preserve the exact bytes copied. `copyTokenAsEmoji.test.ts`, `sendTokenCopyMenu.test.tsx`, `profileDetailsScreen.test.tsx`, `receiveRailPresentation.test.tsx` cover portions of the calling flows. Add clipboard rejection/pending tests proving no success toast before resolution, plus unchanged overrides. Keep catalogue/flow tests.

## 5. QRButton: make anchor lifetime part of its existing shared controller — M, about 20–35 net lines

**Module:** `ui/composed/QRButton/QRButton.shared.ts:33–95`. **All controller callers (2):** `QRButton.android.tsx:19–36`, `QRButton.ios.tsx:20–59`. External QRButton caller is `app/features/wallet/home/HomeLayouts.tsx:99–103` (1 file).

Android :35–36 builds `usePublishAnchorInWindow(animatedRef, borderRadius)` and separately calls `useQRButtonAnchorRegistration(publishAnchor)`; iOS :35,37–59 repeats the protocol with a UI-thread measurement plus the window fallback. Both must attach the returned callback to the matching view (:41–44 / :64–67) and keep the same outer visibility/inner press animation nesting.

**Shape/owner:** the QRButton shared module owns a layout shell with its ref, measurement registration, cleanup, visibility and press-feedback wrapper; keep native measurement implementations as private platform hooks (two real adapters, not an invented single-adapter seam). Platforms supply their genuine press surface/face rendering. Remove the exposed sequence of three hook calls and duplicated animated wrappers. Also remove ignored `accentColor`/`color` fields at shared :15–16: neither platform reads them and the one external caller supplies neither.

**Deletion test:** measurement/reveal behavior must remain; deleting the orchestration contract only removes the opportunity to omit registration/cleanup. About 50–65 removed, 30 added; net down. M; do not standardize Android onto iOS measurement or vice versa.

**Risk/pins:** splash geometry and scan navigation entry, no payload/storage change. `qrButtonReveal.test.ts`, `splashOverlayFastForward.test.ts` cover parts, not platform anchor ownership. Pin registration/unregistration and fallback measurement at the shared shell, and validate native coordinate spaces on both platforms. Keep animation tests; no shallow test must be retained just to test the removed hook sequence.

## 6. Cached reads: remove the unselected cold-start option and redundant strategy argument — M, about 15–25 net lines

**Module:** `lib/read/useCachedRead.ts:79–96,159–167,371–378`. **All callers (7 files, 8 invocations):** `app/features/payments/hooks/useContactSearch.ts:60`; `app/features/mint/hooks/{useMintSearch.ts:54,useMintChanges.ts:65}`; `app/features/mint/screens/MintReviewsScreen.tsx:186`; `app/features/contacts/components/SearchPostsList.tsx:51`; `app/features/feed/components/UserFeed.tsx:531`; `app/features/feed/hooks/useNotificationsPage.ts:212,455`.

Every caller leaves coldStart at `paint-stale`; no production or test invocation selects `skeleton`. This is an unused branch of a live module, not an unused export. Two callers repeat facts the module already owns: contact search :62,65 passes `surface: 'searchProfiles', strategy: 'aggregate'`; notifications :214,217 passes `surface: 'notifications', strategy: 'session'`. These match readPolicy exactly. All others omit strategy.

**Shape/owner:** useCachedRead always paints retained entries and always derives logging strategy from surface. Delete coldStart/strategy options, their destructuring and hideStaleOnCold branch; simplify the data/source conditions. Keep the cache's independent isColdStart capability and actual focusRevalidate/abortOnBlur/seed options, which have real consumers. Do not redesign the request state machine from pass 2 as part of this cut.

**Deletion test:** nothing observable at current callers is lost; the unsupported skeleton configuration disappears. About 15–25 removed, no new layer. M (hook, two callers, tests); mechanical.

**Risk/pins:** read presentation only; no cache saved-shape, viewer scoping or transport change. `useCachedRead.test.tsx` pins fresh/stale reads, key changes, seeds, supersession and partial results; `useCachedReadCompiledHooks.test.ts` covers compilation. Add equality of emitted strategy for the two explicit callers before removing their arguments. No test currently pins coldStart=skeleton; no broad test deletion.

## 7. Read policy: delete a second, nonfunctional configuration model — S, about 15–20 net lines

**Module:** `lib/read/readPolicy.ts:19–54`; **sole caller:** `lib/read/useCachedRead.ts:167`.

The caller asks only for `ReadStrategy`. The table pretends to describe execution gates: :28 `{ kind: 'session', capMs: 400 }`, :34 `{ kind: 'aggregate', minItems: 'requested', capMs: 800 }`, :36 a 300 ms cap. The sole implementation read is :53 `READ_GATES[surface].kind`. No code reads capMs, minItems or requireAll here. The file itself says actual caps belong to nostr. Thus there are no second or third call sites to quote.

**Shape/owner:** keep readPolicy as a small surface-to-log-strategy map, directly `Record<ReadSurface, ReadStrategy>`. Delete FirstPaintGate and all unused scheduling fields and the `each`→`http` translation by recording `http` for noteStats. Nostr remains execution-policy owner; do not edit it or copy its thresholds into another constant.

**Deletion test:** deleting the unused gate shape loses documentary numbers, not scheduling. Retain concise ownership documentation rather than executable-looking duplicate configuration. About 15–20 net lines down, S, mechanical.

**Risk/pins:** telemetry classification only, no wire/timing change. No direct readPolicy test found; `useCachedRead.test.tsx` observes read events. Before cutting, compare all existing surface→strategy results, including noteStats. Retain that behavior test rather than tests asserting dead cap values. Separate from candidate 6: either can land independently.

## 8. BalancePill dimensions: shrink the helper to what variants actually consume — M, about 15–25 net lines

**Module:** `ui/composed/BalancePill/useBalancePillDimensions.ts:10–44`. **All callers (2):** `BalancePill.flat.tsx:25–34,65–69`, `BalancePill.liquid.tsx:40–45,92–95`.

Both pass `contentWidth: contentWidthOverride` into the hook; neither reads `dimensions.contentWidth`. Flat re-derives width at :33–34, `contentWidthOverride ?? Math.max(0, dimensions.buttonWidth - HORIZONTAL_PADDING * 2)`; liquid does its own derivation at :94 and ignores the override for the final display. Both also independently default outer height (:31 / :45). The hook's claimed single ownership does not match usage.

**Shape/owner:** first make useBalancePillDimensions own the outer button width/height and default content height only. Delete its unused contentWidth input/output/calculation, memo dependency, and both caller pass-backs. Keep current variant content-width expressions until the difference is deliberately settled; moving both to the currently unused resolvedContentWidth would change layout. The existing dimension hook remains owner of responsive outer geometry; it needs no new abstraction.

**Deletion test:** deleting this computed-but-unread result loses no rendered value; deleting all dimension handling would scatter window-width defaults. About 20–30 removed, 5 added; net down. M, mechanically safe for the first cut. Unifying the differing content widths is explicitly not part of it.

**Risk/pins:** balance presentation, no balance arithmetic, money state or storage change. `mintSelectorTestID.test.tsx` and `aiHeaderFunding.test.tsx` reference the pill via callers; no dedicated dimension behavior test found. Pin default/explicit width and height for flat and liquid, including explicit contentWidth, before cutting. Native visual validation remains missing on both platforms.

## 9. Popup factory: eliminate the second popup specification type — S, about 10–15 net lines

**Module:** `lib/popup/popups/factory.ts:1–36`; underlying owner `engine.tsx:11–47`. **Sole factory invocation file:** `lib/popup/popups/payment.ts:116,123,130,136` (3 static, 1 parameterized declarations).

Factory redeclares severity, variant, message/text/icon/buttons, then only spreads its inputs into `popup`. Examples: payment :116 `makeStaticPopup(...)`, :130 another static declaration, :136 `makeParamPopup<...>(...)`. Its separate button type at factory :16 lacks the testID supported by engine :28. This is duplicated ownership of accepted shape, not evidence that today’s callers need more options.

**Shape/owner:** retain the useful named-copy factories; derive their deliberately limited spec with `Pick<Parameters<typeof popup>[0], ...>` rather than parallel field definitions. Derive override subsets the same way only if it reduces code without widening callers. Engine owns the configuration types. Do not replace named payment wording with generic popup objects at every call site.

**Deletion test:** removing factories wholesale reintroduces spread boilerplate; removing their parallel type declaration loses nothing and prevents drift. Roughly 15–20 removed, 3–5 added; net down. S, mechanical, low priority compared with the lifetime cuts.

**Risk/pins:** compile-time surface only, no copy or behavior change. `serviceErrorPopup.test.ts`, `staticPopupRenderedProbe.test.ts`, `paymentToastGating.test.ts`; `swapStatusPopupLifecycle.test.ts` mocks these factories rather than testing them. Type-check all existing declarations; preserve override precedence. No standalone factory test found or needed solely to mirror a spread.

## 10. Upload cancellation map leaks its protocol — M, conditional/defer (standalone net deletion approximately zero)

**Module:** `hooks/useUploadAbortMap.ts:10–19`. **All callers (2):** `app/features/composer/ui/PostComposer.tsx:323,334,362–363`; `app/features/feed/components/ThreadReplyBar.tsx:151,208,259–260`.

Both callers know the ref contains controllers indexed by block ID. They pass `.current` to upload orchestration, then perform `get(id)?.abort(); delete(id)` before dropping a block. PostComposer :362–363 and ThreadReplyBar :259–260 quote the same sequence; unmount cancellation is already correctly centralized in the hook. Both also supply orphan-recording callbacks to uploadMediaBlocks (PostComposer :138; ThreadReplyBar :211).

**Shape/owner:** candidate is a deepened existing hook returning an upload operation and `cancelBlock(id)`, owning the map and repeated orchestration plumbing. It must reuse the existing uploadMediaBlocks behavior, not reimplement uploads. However uploadMediaBlocks lives in excluded `lib/nostr/media`, and PostComposer’s progress callback differs. Coordinate with its surveyor before advancing this candidate.

**Deletion test:** deleting the current hook loses unmount cleanup, so it is not a pass-through. Merely adding a cancel helper deletes four caller lines and adds about four, while preserving the raw map elsewhere: that fails the deletion test for a new layer. Do not build that cosmetic version. A full operation-owning cut could remove roughly 20–30 caller/plumbing lines, but net savings cannot be established without the excluded owner; no claimed net-down implementation here. Ranked last and deferred deliberately rather than filling the list with a fake win.

**Risk/pins:** external media uploads and orphan records; no changes to sent bytes, saved blob records or cleanup semantics permitted. Existing `uploadMediaBlocks.test.ts` pins failure/sibling/orphan and canceled-progress behavior; `composerPost.test.tsx`, `threadReplyPost.test.tsx` pin callers. Add removal and unmount during pending upload at the hook interface before moving ownership. Keep upload tests at their existing seam. Not approved as a mechanical cut from this survey alone.

## Defects (source traces, not reproduced runs)

Searched `docs/follow-ups/` before listing. New items below have no matching ID located; this survey does not write the ledger.

- **D1 — false clipboard success.** `app/features/receive/screens/ReceiveRailListScreen.tsx:279–285`: press a copyable request → `void setStringAsync(item.request)` at :282 → `copyPopup` and the copied log run synchronously even if the write later rejects. The shared catalogue at `lib/popup/popups/copy.ts:81` makes this a success claim. Failing test: defer/reject clipboard writing when pressing a copyable rail row; require no success toast/log until a successful resolution. No payment is sent, but the user can believe the clipboard contains a request it does not contain. This is a behavior fix, separate from the mechanical awaited-call migration in candidate 4.
- **D2 — previous mint metadata survives a URL change.** `hooks/useMintInfo.ts:30–58`: after a successful uncached fetch for A, change to uncached B. The B effect does not clear or key fetchedInfo; return :58 continues yielding A until B resolves (and on failure until the catch clears it). Caller path: `app/features/receive/screens/ReceiveScreen.tsx:347` passes the currently selected mintUrl; `ReceiveReusableQuoteTab.tsx:99` passes methodMint. Failing test: resolve A, rerender with B whose fetch remains pending, assert no A metadata is returned. Existing F207 concerns shared useMintManagement reads across accounts; this is the distinct per-hook unkeyed result. No direct useMintInfo behavior test found; caller tests often mock it. The repair need not alter mint policy, stored data or wire requests.
- **Existing F187, not a new finding:** bridge :175–177 refuses an unregistered host, while `lib/popup/popups/deleteStatus.ts:25–35` sets its mounted flag before submission just like the documented swap path. Production reachability before host registration remains unproven; do not claim a newly reproduced startup defect or repair it incidentally in candidate 2.

## Boundaries and retained modules

The pass-2 payment toast ownership, manager lifecycle, restore decoder, notification sync and other conversions are not reopening targets here. PopupHost presentation/custom-page state remains the earlier survey’s native-evidence deferral, not a mandate for a new framework. Named popup copy, platform chrome adapters, ScreenScrollView's inset ownership, and the already-explicit picker route all carry real behavior; small file size is not a reason to remove them. Location double-writing would change saved behavior and is outside this pass; no proposal to remove either stored representation is made.

Coverage limits: excluded `lib/cashu`, `lib/nfc`, `lib/persist`, `lib/nostr`, and `lib/profile` implementations were not audited. Imports and call sites crossing those areas were used only to identify ownership. Most account/backup/migration/routstr internals, HTTP/API parsing, logger/redaction internals, map/theme engines, e2e infrastructure and large block implementations were not read in full. Hook inventory was broader than the completed traces; no whole-area clean verdict. Presentational UI outside the named candidates was sampled, not exhaustively reviewed. No sibling wallet checkout was consulted because this survey proposes no mint/payment/protocol policy decision. Native library implementations, iOS/Android rendering, live services and complete test bodies remain unverified. Only knip was executed as a check; it is not evidence of runtime correctness.

Not read
