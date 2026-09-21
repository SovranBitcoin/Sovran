# React Native and Expo runtime

Rules for lists, images, links, routes, sheets, accessibility mechanics, native modules and the Hermes engine (React Native 0.85, Expo 56, FlashList 2). Same format and standing as the [contributor conventions](contributor-conventions.md): human and agent guidance that Hunch compiles into review questions. Every rule here was reproduced against the installed package versions before it was accepted; when a dependency is upgraded, re-check the rules that name its behaviour.

## lists/row-local-state

Scope: `**/*.tsx`

FlashList recycles row component instances, so `useState` inside a row keeps the previous item's value when the row is reused for another item.

Does `hunk` add `useState` or `useRef` holding item-specific state (expanded, selected, failed, loaded, measured size, a pending action) inside a component that is rendered as a row of the shared `List`, `FlashList` or `AnimatedFlashList`, without resetting it when the item changes — that is, without `useRecyclingState(initial, [item.id])` from `@shopify/flash-list`, and without the state being keyed by the item's identity?

Allowed cases: `useRecyclingState` / `useLayoutState` with the item identity in its deps; state stored in a store or map keyed by the item id; state that is reset in an effect keyed on the item identity (the `Avatar` `imageStatus` pattern); state that is identical for every item (a measured constant width, theme values); rows of a `ScrollView` + `.map` or of a small `FlatList` whose rows are keyed and never recycled; components that are not list rows.

## lists/key-inside-row

Scope: `**/*.tsx`

A React `key` derived from the item, placed inside a recycled row, forces a remount on every recycle and throws away the reuse FlashList exists for.

Does `hunk` put `key={item.id}` (or another item-derived key) on the root element returned by a `renderItem` of `List`/`FlashList`, or key the children of a `.map()` inside a recycled row component by item-derived ids instead of `useMappingHelper().getMappingKey(id, index)`?

Allowed cases: `keyExtractor` on the list itself (the right place for item identity); `.map()` keys produced by `getMappingKey`; index keys for a fixed-length static `.map()` inside a row; keys inside `ScrollView` + `.map` content, `FlatList` rows, or any component not rendered by a recycling list; a deliberate remount key with a comment saying the subtree must reset per item.

## lists/unique-keys

Scope: `**/*.tsx`

FlashList v2 keeps scroll position by key (maintainVisibleContentPosition is on by default), so a missing or duplicated `keyExtractor` value breaks anchoring and can spin its render loop.

Does `hunk` add a `List`/`FlashList` without `keyExtractor`, or a `keyExtractor` whose value can repeat within one list — the array index, a non-unique field (a pubkey in a list that can show two events by the same author, a timestamp, a title), or an id shared by merged sources (the same Nostr event from two relays, a header row and a data row using the same id) — without de-duplicating the data first?

Allowed cases: keys built from a unique entity id, or a composite (`${kind}:${id}`) that is unique across every row type in the list; data de-duplicated by id before it reaches the list; static lists of module-level constants keyed by a unique constant field; section or header rows with their own namespaced key.

## lists/end-reached-guard

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

FlashList fires `onEndReached` on every entry into the end zone — including on mount when the content is shorter than the viewport — and knows nothing about an in-flight page load.

Does `hunk` pass an `onEndReached` (or `onStartReached`) handler that starts a page fetch without checking, in the handler or in the function it calls, that a load is not already in flight and that more pages exist?

Allowed cases: The handler or the paginator it calls returns early on `isLoadingMore`/`hasMore === false`/a cursor-in-flight ref; `onEndReached={hasMore ? loadMore : undefined}`; a query library's `fetchNextPage` guarded by `hasNextPage && !isFetchingNextPage`; handlers that only record analytics or advance a carousel.

## lists/nested-same-axis

Scope: `**/*.tsx`

A virtualized list inside a scroll container of the same axis has unbounded length, so it renders every row at once and the virtualization is lost.

Does `hunk` render a virtualized list — a component that takes `data` and `renderItem`, such as `FlashList`, `FlatList`, `SectionList` or the shared `List` wrapper around them — inside a `ScrollView`, `ScreenScrollView`, `BottomSheetScrollView` or another list's header/row that scrolls along the same axis, or give a vertical virtualized list a parent with no bounded height so that it sizes to its content?

Allowed cases: A horizontal list inside a vertical scroller (or the reverse); the outer content moved into the list's `ListHeaderComponent`/`ListFooterComponent`; a list with `scrollEnabled={false}` over a small bounded data set where the hunk shows the bound; the sheet-scroll injection used by `SectionAnchorList`; a component with `List` in its name that lays out static JSX children (a grouped-row container and its rows) rather than taking `data` and `renderItem`, which is not a virtualized list.

## lists/mvcp-top-anchored

Scope: `**/*.tsx`

FlashList v2 enables `maintainVisibleContentPosition` by default; a top-anchored list whose header grows after mount or whose data arrives in waves drifts away from the top on first paint.

Does `hunk` add a `List`/`FlashList` that is a plain top-anchored list and has a `ListHeaderComponent` whose height changes after mount (a measured header/sticky-tab spacer, a header that loads content) or data that is merged in from several sources after first render, without `maintainVisibleContentPosition={{ disabled: true }}`?

Allowed cases: Chat, thread and feed lists that want anchoring (new items prepended above the viewport, `startRenderingFromBottom`, `autoscrollToBottomThreshold`); lists with no header or a fixed-height header and data delivered in one piece; lists that already pass a module-level `{ disabled: true }` constant.

## lists/inline-slot-components

Scope: `**/*.tsx`

FlashList calls `React.createElement` on a function passed to a component slot, so a new function identity is a new component type and the whole slot remounts.

Does `hunk` pass an inline function — `() => <…/>` or a function declared in the component body — to `ListHeaderComponent`, `ListFooterComponent`, `ListEmptyComponent`, `ItemSeparatorComponent`, `CellRendererComponent` or `renderScrollComponent` of a list, where that function closes over props or state that change (so its identity changes and the slot remounts, dropping `TextInput` focus, scroll offset and animation state)?

Allowed cases: A React element (`ListHeaderComponent={header}` / `={<Header … />}`); a component defined at module scope; an inline function that closes over nothing that changes (a static separator); non-list props.

## images/recycling-key

Scope: `**/*.tsx`

An `expo-image` view reused by a recycled row keeps showing the previous item's bitmap until the new source finishes loading, unless `recyclingKey` changes with the item.

Does `hunk` render `Image` from `expo-image` (or the shared `Image` primitive) with a per-item remote `source` inside a row of `List`/`FlashList`, without `recyclingKey` set to the item's url or id?

Allowed cases: `recyclingKey={url}`; the shared `Avatar` and `MintIcon`, which handle the swap themselves with an underlay of the previous picture; images with a bundled/static source that is the same for every row; images outside recycled rows (screens, headers, `ScrollView` content, sheets).

## images/untrusted-uri

Scope: `**/*.tsx`

`expo-image` decodes whatever scheme it is given — `file:`, `data:`, SVG — so a relay- or mint-supplied string must be scheme-checked before it becomes an image source.

Does `hunk` pass a string that comes from untrusted metadata (a Nostr kind-0 `picture`/`banner`, NIP-11 `icon`, mint `icon_url`, a URL parsed out of note content, link-preview or BTCMap fields) to `source={{ uri }}` of an image component, or to `Image.prefetch`, without first restricting it to `http(s):` (and, where intended, `data:image/` raster) as `RelayCard` and `prefetchImage` do?

Allowed cases: URIs produced on the device (image picker, camera, `localUri`, file-system paths the app wrote, blob descriptors from the app's own upload); URLs already passed through a scheme allowlist (`prefetchImage`'s gate, `RelayCard`'s `safeUri`, a shared sanitizer); bundled `require()` assets; blurhash/thumbhash placeholders.

## text/secret-input

Scope: `**/*.tsx`, `app/shared/lib/popup/**/*.ts`, `app/shared/lib/profile/**/*.ts`

Text typed into an ordinary input is learned by the keyboard, offered to autofill and shown in clear; `secureTextEntry` does not apply to multiline inputs.

Does `hunk` add or configure an input that receives a recovery phrase, nsec, private key, bunker/pairing secret or PIN — a `TextInput`, `BottomSheetTextInput`, heroui `Input`, or an `actionMenu`/popup `inputs: [{…}]` descriptor — without `secureTextEntry`, or, where it must be multiline (so `secureTextEntry` cannot work), without all of `autoCorrect={false}`, `spellCheck={false}`, `autoCapitalize="none"` and `autoComplete="off"` (plus `importantForAutofill="no"` on Android)?

Allowed cases: Inputs for public values (npub, mint URL, Lightning address, amounts, invoices, search); single-line secret inputs with `secureTextEntry` and a reveal toggle; read-only `editable={false}` display fields; design-system catalogue screens under `features/settings`.

## layout/shadow-clip

Scope: `**/*.tsx`

On iOS a view with `overflow: 'hidden'` clips its own legacy shadow; only `boxShadow` is drawn outside the clip.

Does `hunk` put the legacy shadow props (`shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius`) on the same view that also sets `overflow: 'hidden'` / `overflow-hidden` (directly, or through a merged style or className), so the iOS shadow is cut off at the view's bounds?

Allowed cases: The shadow on an outer wrapper and the clip on an inner child; `boxShadow` (RN draws it on a separate container that the clip does not affect); Android-only `elevation`; views that clip but have no shadow.

## android/back-handler-scope

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

`BackHandler` listeners run last-registered-first and the first one returning `true` swallows the press, so a listener that outlives its purpose breaks the hardware back button for whatever is on top of it.

Does `hunk` add `BackHandler.addEventListener('hardwareBackPress', …)` whose handler returns `true` while the listener stays registered when its reason no longer applies — registered unconditionally in a `useEffect` of a screen that stays mounted under pushed routes, not gated on the overlay/step/blocking state it serves, or with no `subscription.remove()` in cleanup?

Allowed cases: Registration gated on the active state and removed in cleanup (`if (!open) return; const sub = …; return () => sub.remove()`), as `AnimatedImageOverlay`, `TermsAndConditionsScreen` and `CtaScreen` do; registration inside `useFocusEffect`; handlers that return `false`; a blocking CTA that must swallow back while it is shown.

## links/webview-scheme-escape

Scope: `**/*.tsx`

react-native-webview hands every navigation that fails `originWhitelist` to raw `Linking.openURL`, so a page can launch any app scheme — including this wallet's own `cashu:`, `lightning:`, `nostrconnect:` deep links — behind the house `openExternalUrl` allowlist.

Does `hunk` render a `WebView` that loads remote or untrusted content with an `originWhitelist` narrower than `['*']` (including the default `['http://*','https://*']`) and rely on it to block non-web schemes, instead of `originWhitelist={['*']}` plus an `onShouldStartLoadWithRequest` that returns `false` for every URL that is not `http(s):` (optionally routing it through `openExternalUrl`)?

Allowed cases: A `WebView` whose `source` is a bundled/static HTML string with no remote navigation; `onShouldStartLoadWithRequest` that rejects non-http(s) requests combined with `originWhitelist={['*']}` so the handler is actually consulted; a comment recording that opening external schemes from the page is intended.

## links/webview-bridge

Scope: `**/*.tsx`

A WebView showing untrusted pages must have no channel into app state.

Does `hunk` add `onMessage`, `injectedJavaScript`, `injectedJavaScriptBeforeContentLoaded`, `injectedJavaScriptObject`, a `ref.injectJavaScript(…)` call, `allowFileAccess`, `allowUniversalAccessFromFileURLs`, `allowFileAccessFromFileURLs`, `sharedCookiesEnabled` or `setSupportMultipleWindows={true}` to a `WebView` that can load remote or user/relay-supplied URLs, or act on an `onMessage` payload (navigate, pay, sign, read keys) without validating it as untrusted input?

Allowed cases: A WebView that only ever loads a bundled first-party document and whose `onMessage` payload is parsed with a schema; injected scripts that are constant strings with no interpolated app data, on first-party content; `LinkEmbedView`'s hardening props (`allowFileAccess={false}`, `setSupportMultipleWindows={false}`).

## routes/back-without-history

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

`router.back()` with an empty history is silently dropped in production, so a screen opened from a deep link, a notification or `replace` is left with a dead Close button.

Does `hunk` call `router.back()`, `router.dismiss()` or `navigation.goBack()` as the only way out of a screen that can be the first route in its stack — a deep-link target (`cashu:`, `lightning:`, `nostrconnect:`, payment-request and share routes), a screen reached through `router.replace`/`<Redirect>`, or a flow's completion handler — without a `router.canGoBack()` / `canDismiss()` check and a `replace` fallback?

Allowed cases: `if (router.canGoBack()) router.back(); else router.replace('/')` (the `CtaScreen` and `StandaloneCameraScreen` pattern); `router.dismissTo(href)`, which replaces when the target is not in history; screens only ever pushed from inside the app; header back buttons supplied by the navigator.

## routes/params-seam

Scope: `app/app/**`, `app/features/**/*.tsx`

A query param repeated in a URL arrives as an array and every param arrives as a string; the generic on `useLocalSearchParams<T>()` is a cast, not a check.

Does `hunk` read route params through `useLocalSearchParams<{…}>()` or `useGlobalSearchParams<{…}>()` and then let an unchecked value flow onward as a single string, number, boolean or enum — `Number(id)`, `parseInt`, a template string, a store key, a prop, `as SomeUnion` — instead of `useRouteParams(ParamsSchema, { where })` from `@/shared/lib/nav/useRouteParams`?

Allowed cases: `useRouteParams` with a module-level Zod schema; a param that is narrowed in the hunk (`typeof x === 'string'`, `Array.isArray`) before use; a strict `===` comparison against one literal whose false branch is the same default state as the param being absent (`flag === '1'`), since an array or any other string simply compares false; params only forwarded untouched to another route.

## sheets/dynamic-detent

Scope: `app/shared/blocks/popup/**`, `**/*Sheet*.tsx`

@gorhom/bottom-sheet 5 defaults `enableDynamicSizing` to `true` and then inserts a content-height detent into `snapPoints`, shifting every index.

Does `hunk` render `BottomSheet`/`BottomSheetModal` with `snapPoints` and index-based control (`index=`, `snapToIndex(n)`, `onChange` comparing an index) without setting `enableDynamicSizing` explicitly, so that the extra dynamic detent can change which position an index means?

Allowed cases: `enableDynamicSizing={false}` with fixed `snapPoints`; dynamic sizing on with no `snapPoints` and only `expand()`/`close()`/`snapToPosition`; the popup hosts' computed `enableDynamicSizing={…}` expressions.

## a11y/live-region-ios

Scope: `**/*.tsx`

`accessibilityLiveRegion` and `aria-live` are Android-only, so a status that matters is never spoken by VoiceOver unless it is announced explicitly.

Does `hunk` rely on `accessibilityLiveRegion`/`aria-live` alone to convey a result the user must not miss — payment sent/failed/pending, token claimed, backup verification result, a blocking error — with no iOS counterpart (`AccessibilityInfo.announceForAccessibility(…)` on the state change, or moving accessibility focus to the result)?

Allowed cases: A live region paired with an iOS announcement guarded by `Platform.OS === 'ios'` (so Android does not announce twice); ambient, non-critical updates (loading captions, list refresh notes, character counters); a result shown on a newly focused screen whose title already states the outcome.

## a11y/hide-both-platforms

Scope: `**/*.tsx`

Hiding a subtree from assistive technology takes a different prop on each platform.

Does `hunk` hide decorative, duplicated or inactive content from screen readers with only one of `accessibilityElementsHidden` (iOS only) or `importantForAccessibility="no-hide-descendants"` (Android only)?

Allowed cases: Both props together; `aria-hidden`, which React Native maps to both; `accessible={false}` on a single leaf that has no accessible descendants; platform-specific files (`.ios.tsx`, `.android.tsx`).

## a11y/overlay-modal

Scope: `**/*.tsx`

A hand-built overlay leaves the screen underneath reachable by VoiceOver and TalkBack unless it is marked modal.

Does `hunk` add a custom overlay that covers the screen — an absolutely-filled backdrop plus a card, a popup host, a full-screen viewer, content inside a `transparent` `Modal` — without `accessibilityViewIsModal` on the overlay's content (iOS) and without removing the covered content or backdrop from the Android accessibility tree (`importantForAccessibility="no-hide-descendants"` on what is covered, or `"no"` on the backdrop)?

Allowed cases: Routes presented with `presentation: 'modal' | 'formSheet'` (native presentation is modal already); the `PostComposer` alt-text dialog pattern; overlays that are purely decorative and non-interactive (`pointerEvents="none"`, hidden from accessibility); toasts and banners that do not block the screen.

## a11y/touch-target

Scope: `**/*.tsx`

`hitSlop` cannot extend a touch area past the parent's bounds, and a target under 44pt (iOS) / 48dp (Android) is hard to hit.

Does `hunk` add an icon-only or otherwise small pressable whose laid-out size is visibly under 44×44 (`size-6`, `w-8 h-8`, `width: 28`, an `Icon` with no padding) with no `hitSlop`, or add `hitSlop` to a control smaller than the 44pt target whose parent is the same size as the control or clips it (`overflow: 'hidden'`, a tight row), where the slop the control relies on has no effect?

Allowed cases: Controls at least 44pt in both dimensions through size, padding or `min-h`/`min-w`, where an inert `hitSlop` does no harm; `hitSlop` on a control whose parent has room around it; a control whose size the hunk does not show (it comes from a prop or an imported constant), which is insufficient evidence; shared components that own their target size (`Button`, `CircleActionButton`, `HeaderGlassCircle`, `ScreenHeaderAction`, `ListItem`); dense inline text links inside a paragraph.

## native/secure-store-key-charset

Scope: `repository-wide`

expo-secure-store throws on any key that is not `[A-Za-z0-9._-]+`, and Jest mocks do not reproduce that.

Does `hunk` build a SecureStore key from a value that can contain other characters — a mint or relay URL, an `npub`/`nprofile` with separators, an email or Lightning address, a path, a user-entered label, a key joined with `:` or `/` — without hex/base64url-encoding or hashing that part first?

Allowed cases: Keys made of constants plus validated hex pubkeys, integers (`accountIndex`) or other values the hunk shows are restricted to `[\w.-]`; keys produced by the existing helpers in `shared/lib/nostr/secureStorage.ts` and `features/nostrSigner/lib/bunkerSecrets.ts`.

## native/sync-module-function

Scope: `app/modules/**/*.{swift,kt}`

In the Expo Modules API `Function` runs synchronously on the JS thread; only `AsyncFunction` runs off it.

Does `hunk` define a module method with `Function("…")` whose body does I/O or unbounded work — a database or file read, keychain/keystore access, BLE/NFC calls, network, crypto over caller-sized input, waiting on a lock/semaphore/queue, or building a collection that grows with user data (message history, peer lists) — instead of `AsyncFunction`?

Allowed cases: Constant-time getters of in-memory state, feature/availability checks and version strings; `AsyncFunction`; `Property`/`Constants` definitions.

## native/nfc-session-release

Scope: `app/shared/lib/nfc/**`, `**/*{Nfc,NFC,nfc}*.{ts,tsx}`

A held NFC technology request keeps the iOS scan sheet up and blocks every later tap until it is cancelled.

Does `hunk` call `acquireSession()` or `NfcManager.requestTechnology(…)` on a path where a throw, an early return, an unmount or a user cancel can skip the matching `releaseSession()` / `cancelTechnologyRequest()` — that is, the release is not in a `finally`, not in the effect/focus cleanup, and the flow does not use `withSession(fn)`?

Allowed cases: `withSession(fn)`; `acquireSession()` with `releaseSession()` in `finally` or in every exit of a multi-step adapter (`shared/lib/nfc/adapter.ts`); cleanup in `useFocusEffect`/effect teardown (`useAmbientNfcArm`).

## hermes/missing-builtins

Scope: `repository-wide`

The Hermes build shipped with RN 0.85.3 lacks several built-ins that Node (and therefore Jest and TypeScript) accept, so the call only fails on a device.

Does `hunk` call `structuredClone`, `Array.prototype.toSorted`, `Object.groupBy`/`Map.groupBy`, `Promise.withResolvers`, `Array.fromAsync`, `new FinalizationRegistry`, or construct `Intl.RelativeTimeFormat`, `Intl.PluralRules`, `Intl.ListFormat`, `Intl.Segmenter`, `Intl.DisplayNames` or `Intl.Locale`, in code that runs in the app, without a feature check or `try/catch` fallback?

Allowed cases: A guarded use with a fallback (`shared/lib/date.ts` wraps `new Intl.RelativeTimeFormat` in `try/catch` and caches `null`); built-ins that are present (`Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.Collator`, `toReversed`, `toSpliced`, `with`, `findLast`, `at`, `Object.hasOwn`, `replaceAll`, `Promise.allSettled`, `WeakRef`, BigInt, RegExp lookbehind and named groups); Node-only code (`scripts/`, `codereview/`, `e2e/`, tests, config files); a polyfill installed in `shim.js`/`polyfills.js` before first use.

## routes/focus-not-foreground

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

`useFocusEffect` fires on navigation focus only; returning to the app from the background does not re-run it.

Does `hunk` use `useFocusEffect` (or `useIsFocused`) as the only trigger for refreshing or re-arming something that goes stale while the app is backgrounded on the same screen — quote or invoice status, balance, a pending payment poll, NFC/BLE arming, a relay subscription — with no `AppState` `'active'` handling?

Allowed cases: The effect also subscribes to `AppState` (or a shared foreground hook) and tears it down; the data owner already refreshes on foreground; work that only matters on navigation (scroll reset, header options, analytics, one-shot animation).
