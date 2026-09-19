# Contributor conventions

These instructions were preserved from the previous Hunch policy during the semantic-review redesign. They remain human/agent guidance; Hunch does not claim to enforce all of them. Existing repository instructions, ADRs and explicit user decisions take precedence. Use lint/type checks for deterministic requirements.

[Automated policy](../../hunch.config.ts) · [Review contracts](contracts.md)

## errors/structured

Scope: `repository-wide`

Keep errors structured until they reach the UI: don't turn a caught error into a string, boolean, null or generic Error, and keep its cause, status, code and service.

Does `hunk` catch or receive an error and pass it on in a lossy form — a string (`String(err)`, `err.message`, a template string), a boolean, `null`/`undefined`, or a new generic `Error` without `{ cause }` — to a caller, store or return value that non-UI code relies on to understand or react to the failure?

Allowed cases: The error is rethrown, wrapped with `cause`, returned as a typed error, Result or discriminated union, or logged with the error object; the string is produced at the UI edge only for display (a screen's error text, a toast, a status label); the catch belongs to a documented best-effort path (optional enrichment, cache read, feature detection, cleanup, telemetry) whose failure is deliberately ignored and whose result decides nothing.

## errors/not-for-decisions

Scope: `repository-wide`

Never decide retry, balance, refund, proof state or payment recovery from display text or error messages.

Does `hunk` decide retry, refund, balance, proof state, spent status or payment recovery by matching an error message or other human-readable text (`msg.includes('…')`, a regex over `err.message`, comparing display copy) outside a single named error-classifier function?

Allowed cases: Branching on typed data (`instanceof`, `err.code`, HTTP `status`, NUT error codes, a discriminated `kind`); a single named classifier function (for example `classifyRedeemError` or `classifyMeltError`) that checks codes first and falls back to message patterns only for libraries that expose no code, and whose callers branch on its typed result; message matching used only to pick display text or log detail.

## payments/uncertain-outcomes

Scope: `repository-wide`

Treat timeouts, cancellations and relay acceptance as unknown outcomes, never as proof that a payment failed, succeeded or was delivered.

Does `hunk` treat a timeout, abort, cancellation, lost connection, or relay/mint acceptance as proof that a payment or message definitely failed, succeeded or was delivered — for example by marking it failed, refunded, paid or delivered, or by releasing its proofs?

Allowed cases: Unknown outcomes stay pending or unknown and are reconciled later by checking quote or proof state; a definitive mint or protocol answer (a paid quote, a spent-proof check, an explicit error code) decides the state; relay acceptance is recorded as sent or accepted, not delivered.

## async/owner-scope

Scope: `repository-wide`

Async work may only write to the profile, request or generation that started it; results that arrive after cancellation, a newer request or a profile switch are dropped.

Does `hunk` start async work (a fetch, an await chain, a subscription or a timer) and then write its result into shared, profile or component state without any check that the profile, request, generation or mounted component that started it is still current, in a place where those inputs can visibly change while the work is in flight?

Allowed cases: The write is guarded by an AbortSignal, a request or generation id comparison, a `cancelled` flag set in effect cleanup, or a profile-id check; the write is keyed by the input that started it (`cache[pubkey] = result`) so a stale result cannot land on another key; the state is identity-independent and last-writer-wins is harmless; the work runs once for the app lifetime.

## async/cleanup

Scope: `repository-wide`

Every subscription, timer, listener or background promise has an owner that handles its failure and tears it down; `void promise` and empty catch blocks must not hide errors.

Does `hunk` start a subscription, listener, interval, timeout or background promise that is never torn down, or silently swallow a failure that matters — a `void` promise that visibly performs network, storage or wallet work with no `.catch`, or an empty `catch {}` with no comment saying why ignoring the failure is safe?

Allowed cases: Effects return cleanup that unsubscribes or clears; the promise has `.catch(...)` or a try/catch inside the async body; `void` on calls that cannot reject or that handle their own errors (haptics, loggers, navigation, `preventAutoHideAsync`, functions the hunk shows catching internally); an empty catch with a comment explaining why the failure is expected and harmless; module-level singletons meant to live for the app lifetime.

## net/transport

Scope: `repository-wide`

Make requests through the domain transport (apiClient, wallet/safeFetch, the Nostr facade) with caller cancellation and a bounded deadline, not a screen-local fetch.

Does `hunk` call `fetch(`, `axios`, `XMLHttpRequest` or `new WebSocket(` from a screen, component, hook or feature module instead of through a transport module, or make a network request that has neither caller cancellation (an AbortSignal) nor a bounded timeout?

Allowed cases: The file is itself the transport or client module for one service (apiClient, safeFetch, a `*Client.ts` or `api.ts` that owns one external API) and threads a signal or timeout through; the request goes through such a module; e2e or test-harness code; `fetch` of a local `file://` or bundled asset.

## net/retries

Scope: `repository-wide`

Retry only idempotent reads, with bounded backoff; payments and other side effects are reconciled against persisted state, never simply repeated.

Does `hunk` retry — with a loop, a backoff helper or a re-invocation after failure — an operation that has side effects (a payment, melt, mint, swap, send, publish or other write that may already have happened), or retry anything without a bound on the number of attempts?

Allowed cases: Bounded retries of idempotent reads (GET requests, quote or proof-state checks, metadata fetches) with backoff; bounded re-preparation of an operation that has not executed yet and so has no side effect; reconciling a failed side effect by checking persisted or mint state; resending the same already-signed Nostr event.

## input/parse-at-boundary

Scope: `repository-wide`

Parse untrusted input (network, relays, route params, storage, QR codes, clipboard, native callbacks) with a Zod schema at the boundary, and infer the type from that schema instead of redeclaring it.

Does `hunk` take untrusted input — a network or relay response, `JSON.parse` output, storage reads, QR, clipboard or NFC data, or native callback payloads — and use it through a TypeScript cast (`as T`, `as unknown as T`) or unchecked property access instead of validating it with a Zod schema or a dedicated protocol decoder at that boundary?

Allowed cases: The input is validated by a Zod schema (`.parse`/`.safeParse`) or by a protocol library decoder with typed output (cashu-ts `getDecodedToken`, nostr-tools `nip19.decode`, a bolt11 decoder); the value comes from an SDK that already validated it; casts of trusted in-process values or of this app's own typed stores; route params used as plain string identifiers or narrowed before use; `unknown` values narrowed with explicit `typeof` checks on every field that is read.

## input/structure-not-trust

Scope: `repository-wide`

A successful schema parse proves shape only; never treat it as a verified signature, an authorization or a spendable proof.

Does `hunk` treat a successful schema parse or shape check as proof that a Nostr event signature is valid, that an action is authorized, or that Cashu proofs are spendable — skipping signature verification, permission checks or mint state checks because the data parsed?

Allowed cases: Signatures, permissions or proof states are checked separately; parsed data is displayed or stored as unverified.

## money/exact

Scope: `repository-wide`

Amounts that decide a payment use exact integer or SDK values with their unit and mint: no floating-point BTC math, toFixed, rounding, or coercion of invalid, negative or fractional input.

Does `hunk` compute an amount that decides what is paid, sent, minted or received (sats, msats, proof amounts, fees, invoice amounts) with floating-point BTC math, `toFixed`, `Math.round`/`floor`/`ceil` of fractional values or `parseFloat`, or by silently coercing invalid, negative, NaN or fractional input into a valid amount?

Allowed cases: Integer arithmetic on sat or msat integers; conversions for display only (fiat labels, formatted strings, charts); rounding inside a fiat estimate that never decides what is paid; input validation that rejects invalid values; `Math.ceil` of an integer division used for fee reserves in integer sats.

## time/units

Scope: `repository-wide`

Name time values with their unit (createdAtMs, timeoutSeconds), convert Nostr seconds once at the boundary, and store raw timestamps rather than formatted labels.

Does `hunk` declare a variable, constant, field or parameter holding a numeric duration or timestamp whose name does not state its unit (`timeout`, `createdAt`, `expiry`, `delay`, `ttl`, `staleTime`), mix Nostr seconds with JavaScript milliseconds without an explicit conversion, or persist a formatted time label instead of the raw timestamp?

Allowed cases: Names carry the unit (`timeoutMs`, `createdAtSec`, `ttlSeconds`, `STALE_MS`); Nostr fields named by the protocol (`created_at`, `since`, `until`) used at the boundary; `Date` objects; option names fixed by a library or wire format the code doesn't control (`setTimeout(fn, delayMs)`, `{ timeout }` passed to an external API, `staleTime` in React Query options).

## secrets/storage

Scope: `repository-wide`

Mnemonics, private keys, nsec and signing secrets stay in secure storage and never appear in stores, AsyncStorage, route params, URLs, test IDs, fixtures or logs.

Does `hunk` put a mnemonic, seed, private key, nsec or other signing secret anywhere other than secure storage (expo-secure-store or the key vault module) — a Zustand store, AsyncStorage or MMKV, route params, URLs, testIDs, fixtures or logs?

Allowed cases: Only public keys, npubs, key ids, pairing-intent metadata without secrets, or opaque references are stored; secrets pass in memory to signing or into SecureStore.

## secrets/logs

Scope: `repository-wide`

Logs never include seed words, private keys, Cashu proofs or tokens, invoices, DM contents, PINs, raw NFC bytes or credential-bearing URLs.

Does `hunk` log (with `log.*`, `console.*`, a logger, analytics or an error report) a value that is or contains seed words, a private key, Cashu proofs or an encoded token, a Lightning invoice, DM plaintext, a PIN, raw NFC bytes, or a URL carrying credentials?

Allowed cases: Logs record only counts, amounts, ids, hashes, short fingerprints, mint URLs, states or error codes.

## secrets/randomness

Scope: `repository-wide`

Security-relevant randomness comes from the native crypto source; never Math.random or hand-rolled cryptography.

Does `hunk` use `Math.random`, a time-based value or hand-rolled cryptography to produce a security-relevant value (keys, secrets, nonces, blinding factors, proof secrets, auth tokens, pairing codes)?

Allowed cases: `Math.random` for jitter, animation, UI keys, sampling or placeholders; randomness from expo-crypto, `crypto.getRandomValues` or @noble/@scure libraries.

## mock/isolation

Scope: `repository-wide`

Mock Mode data never enters Coco, transaction stores, Nostr or query caches, or persistence, and never publishes, zaps or pays.

Does `hunk` let Mock Mode, demo or fake data flow into Coco, transaction stores, Nostr or query caches, or persisted storage, or let it trigger a real publish, zap or payment?

Allowed cases: Mock data stays in presentation-only memory gated by the mock flag; test fixtures and e2e harness code.

## arch/owner

Scope: `repository-wide`

Put code with the owner of its meaning (payment sequencing in wallet/, Nostr transport in nostr/, screens and device I/O in app/); no generic utils or helpers modules, and no shared helper switched by caller-specific flags.

Does `hunk` put code with the wrong owner: (a) payment sequencing, proof selection, mint/melt/swap orchestration or payment retries in `app/`; (b) Nostr relay transport or a Nagg → Primal → relay fallback chain outside `nostr/`; (c) code under `wallet/` or `nostr/` importing app modules, Expo navigation or app stores; (d) a grab-bag module whose file name is `utils`, `helpers`, `misc` or `common` and that mixes unrelated concerns; or (e) one shared function whose behaviour is switched by caller-specific flags or caller names?

Allowed cases: A focused single-purpose module in `app/shared/lib` or `app/shared/hooks` (a formatter, the logger, a cache factory, a color helper, a generic hook such as `useDebouncedValue`) — a shared module is correct when it has one clear purpose and no domain owner; device I/O, native bridges and screen glue in `app/`; the domain packages themselves (`wallet/`, `nostr/`) implementing their own concerns; UI that calls a wallet or Nostr API and renders the result.

## naming/verbs

Scope: `repository-wide`

Function names follow their verb: get is synchronous and local, fetch reads the network, load reads local persistence, build and compute are pure, format returns display text, parse decodes text.

Does `hunk` define a function whose leading verb contradicts what its body visibly does: `get*` that is async or performs network or storage I/O; `fetch*` that performs no network read; `load*` that reads the network rather than local persistence; `build*` or `compute*` with side effects; `format*` returning something other than display text; `parse*` that does not decode text or unknown input?

Allowed cases: The body matches the verb; `get*` returning a cached or in-memory value synchronously; React hooks (`use*`); names imposed by an interface, library or protocol that the code implements; a function whose body isn't visible in the hunk.

## naming/protocol

Scope: `repository-wide`

Name protocol values by exact meaning (cashuTokenEncoded, proofSecret, mintQuoteId, nostrPubkeyHex, nostrEventId, lnInvoiceBolt11) rather than a bare token, secret, pubkey or quote, and reuse protocolIds instead of new ID regexes.

Does `hunk` declare a new variable, field, parameter or prop holding a protocol value under a bare generic name — `token`, `secret`, `pubkey`, `quote`, `invoice` — where nothing nearby (the enclosing type, function or module name) makes its kind and encoding clear, or add a new regex for Nostr, Cashu or Lightning identifiers instead of reusing `protocolIds`?

Allowed cases: Names that state meaning (`cashuTokenEncoded`, `nostrPubkeyHex`, `mintQuoteId`, `lnInvoiceBolt11`); names scoped by their container (`quote.id` on a `MintQuote`, `event.pubkey` on a Nostr event, `pubkey` inside a type named `NostrProfile`); field names fixed by a protocol, SDK or wire format; destructured SDK fields.

## skill/expo-router/native-tabs-static-triggers

Scope: `repository-wide`

Adding or removing tab triggers at runtime remounts the navigator and loses state.

Does `hunk` render `NativeTabs.Trigger` elements whose set can change at runtime — conditional rendering (`cond && <NativeTabs.Trigger>`, a ternary) or mapping over an array derived from state, props or runtime data?

Allowed cases: A literal list of triggers, triggers using the `hidden` prop, or mapping over a module-level constant array of tab definitions, whose set cannot change at runtime.

## skill/expo-router/native-tab-icon-md-prop

Scope: `repository-wide`

A NativeTabs icon with only an SF Symbol may not show up on Android.

Does `hunk` add a NativeTabs trigger icon that has an `sf` prop but no `md`, `src`, `drawable` or `xcasset` alternative, in a NativeTabs tree that can render on Android?

Allowed cases: The icon has an Android alternative, or the NativeTabs branch renders only on iOS (it sits behind an iOS-only capability check and another tab bar serves Android).

## skill/expo-router/prefer-native-modal-presentation

Scope: `repository-wide`

A custom modal component may be used where a native Stack modal route would work better.

Does `hunk` add a React Native `<Modal>` (from 'react-native') to present screen-like content — a page the user navigates to, with its own data, deep link or back-stack entry — instead of a route with `presentation: "modal"` or `"formSheet"`?

Allowed cases: A route with `presentation: "modal"` or `"formSheet"`; a transient dialog or prompt (one short field with Cancel/Save, a confirmation) over the current screen that edits unsaved in-memory draft state and needs no deep link or back-stack entry; no Modal added.

## skill/expo-router/stacks-defined-in-layout-files

Scope: `repository-wide`

A Stack navigator defined outside a `_layout.tsx` file won't be wired into file-based routing correctly.

Does `hunk` render a `<Stack>` navigator (with children, `screenOptions`, or bare) in a file that is not a `_layout` file, where nothing in the hunk shows the component is a layout used by `_layout` files?

Allowed cases: A `<Stack>` in a `_layout` file; a shared layout component documented as rendered by `_layout` files as their default export (for example a search layout reused by several tab layouts); screen files that only use `Stack.Screen`, `Stack.Toolbar`, `Stack.SearchBar` or similar sub-components to configure themselves.

## skill/expo-router/prefer-native-tabs

Scope: `repository-wide`

JS Tabs from expo-router may be used instead of NativeTabs, which gives a native tab bar.

Does `hunk` add a JS tab navigator (`Tabs` from `expo-router` or `@react-navigation/bottom-tabs`) as the only tab bar, where NativeTabs could be used instead?

Allowed cases: The layout renders NativeTabs where they are supported and uses JS `Tabs` only as the fallback for platforms or OS versions without them; headless tabs from `expo-router/ui` in a `.web.tsx` file.

## ui/read-states

Scope: `**/*.tsx`

Async screens show distinct loading, empty, failed and stale-with-data states: a failed or unavailable read is never shown as empty, and existing rows stay visible while refreshing or after a refresh fails.

Does `hunk` render an async-loaded list or value so that a failed or unavailable read shows the same UI as a genuinely empty result, or so that rows already on screen are replaced by a spinner, skeleton or empty state while refreshing or after a refresh fails?

Allowed cases: Separate error, empty and loading branches; cached rows kept during refetch; static or synchronous data.

## ui/unknown-values

Scope: `**/*.tsx`

Unknown counts stay undefined and render as a placeholder, never 0; image fallbacks appear only once the source is known to be missing or failed (avatarStateFor).

Does `hunk` display an unknown or not-yet-loaded count, total or amount as `0` (`count ?? 0` or `|| 0` feeding rendered text), or show an image fallback (initials, a placeholder avatar) before the image source is known to be missing or has failed to load?

Allowed cases: Unknown values stay `undefined` and render a placeholder, skeleton or dash; `?? 0` used in arithmetic that is not displayed, or for values that are zero by definition when absent (the length of a local list); avatars driven by `avatarStateFor` or an equivalent load-state check.

## ui/honest-loading

Scope: `**/*.tsx`

No minimum skeleton durations, second list mounted just to crossfade, or loading animation that keeps running after a failure.

Does `hunk` keep loading UI up for a minimum time after data is ready, mount a second list only to crossfade from a placeholder list, or keep a loading animation running after the operation has failed?

Allowed cases: Loading UI tied directly to the real pending state; design-system catalogue or stress screens under `features/settings` that exist to showcase loading components.

## ui/insets

Scope: `**/*.tsx`

Screen and useScreenInsets own safe-area, tab, footer and keyboard space; don't hard-code tab or footer heights or add safe-area padding twice.

Does `hunk` hard-code a tab-bar, footer, header or home-indicator height (a numeric padding, margin or offset such as `paddingBottom: 83` or `+ 49` standing in for that chrome), or add `useSafeAreaInsets()` padding inside a screen that `Screen` or `useScreenInsets` already pads?

Allowed cases: Insets come from `useScreenInsets` or `Screen`; the component itself owns that chrome (the tab bar, a root overlay, a sheet host) and applies the inset once; ordinary layout spacing unrelated to system chrome.

## ui/shared-parts

Scope: `**/*.tsx`

Use the shared Icon registry, Spinner, SelectableCheck, Button, Text and semantic theme tokens instead of custom icons, spinners, checkmarks, fonts or screen-local colors.

Does `hunk` introduce a local replacement for a shared UI part: an icon from a third-party icon package or inline SVG instead of the `Icon` registry, `ActivityIndicator` or a hand-rolled spinner instead of `Spinner`, a custom checkmark instead of `SelectableCheck`, a hard-coded `fontFamily` string instead of the `Text` primitive's weight props, or a hard-coded hex/rgb UI color where a semantic theme token exists?

Allowed cases: Uses `Icon`, `Spinner`, `SelectableCheck`, `Button`, `Text` and `useThemeColor` or semantic tokens; colors that are data or artwork (wallpapers, brand marks, colors extracted from images, chart palettes, the QR code); black or white scrims, shadows and overlays over media; `transparent`; the shared primitive implementations themselves; design-system catalogue and stress screens under `features/settings`.

## ui/block-margins

Scope: `**/*.tsx`

A stackable block sets its own top or bottom margin, so its distance from neighbours changes with every parent. Leave vertical spacing to the parent stack's gap or to the call site.

Does `hunk` define a component that renders one self-contained block for screens to stack (a card, notice, banner, QR block, selector or copy row), whose outermost element sets its own top or bottom margin (`mt-*`, `mb-*`, `my-*`, `marginTop`, `marginBottom`, `marginVertical`)?

Allowed cases: The root sets only horizontal insets (`mx-4`) or takes its outer spacing from a `className` or `style` prop; margins on inner elements of the block; a screen or page component laying out its own sections; design-system catalogue screens under `features/settings`.

## ui/platform

Scope: `**/*.tsx`

Choose glass or blur variants with the capability hook or defineVariants rather than Platform.OS or iOS version checks, and keep iOS-only native imports out of Android-reachable modules.

Does `hunk` choose a glass, blur or liquid-glass variant with `Platform.OS`, `Platform.select` or an iOS version check instead of the capability hook or `defineVariants`, or statically import an iOS-only native module (liquid glass, `@expo/ui/swift-ui`, SwiftUI views) at the top of a module that Android also loads?

Allowed cases: A capability hook or `defineVariants` chooses the variant; `.ios.tsx`/`.android.tsx` splits; guarded lazy requires; `Platform` checks for genuine behaviour differences that are not glass or blur styling (keyboard behaviour, haptics, permissions, maps providers, native APIs, font metrics, shadow versus elevation, status bar).

## ui/single-submit

Scope: `**/*.tsx`

Prevent double submission of payments and other actions with the owner's busy state, not only a debounce.

Does `hunk` add a pay, send, confirm, submit or publish action whose handler can run twice when tapped twice quickly — nothing prevents re-entry (no single-flight guard, no busy state from the owner, no state-machine phase check), or it relies only on a debounce or timer?

Allowed cases: The shared `Pressable` or `Button` with an async handler (their single-flight guard drops re-entry); `disabled={busy}` driven by the owning state; a state-machine guard; `useSingleFlight`; actions without side effects (navigation, toggles, opening sheets, copying).

## ui/permissions

Scope: `**/*.tsx`

Request camera, NFC, location, clipboard and other permissions when the user starts the related action, with denied and unavailable states, never at startup.

Does `hunk` request a camera, NFC, location, contacts, notifications, Bluetooth or clipboard permission on mount or at startup rather than when the user starts the related action, or ignore the denied or unavailable result?

Allowed cases: The request runs in the handler for the user action, or on a screen whose whole purpose the user just chose (a scanner, a map, a nearby-payments screen) with denied and unavailable UI; checking permission status without requesting it.

## copy/sentences

Scope: `**/*.tsx`

Write UI text as complete sentences with parameters; never concatenate fragments or append English plural endings.

Does `hunk` build user-visible text by appending an English plural ending (`"reply" + (n === 1 ? "" : "s")`, `` `${n} item${n === 1 ? "" : "s"}` ``) or by concatenating separately written fragments of one sentence with `+` or across adjacent text nodes, instead of one complete sentence with parameters per case?

Allowed cases: One template or string per sentence with interpolated values (`` `Sent ${amount} to ${name}` ``); choosing between whole words or whole sentences by count (`n === 1 ? "1 reply" : `${n} replies``); a value and its caption laid out as separate UI elements; non-user-visible strings (logs, testIDs, keys).

## copy/truncation

Scope: `**/*.tsx`

Shorten text only for display (numberOfLines or an authored short label): never slice strings or disable font scaling to fit, never cut amounts, fees, recipients, hosts or recovery steps, and always copy, sign, submit and compare the full value.

Does `hunk` shorten an amount, fee, recipient, npub or pubkey, mint URL or host, invoice, token or recovery step with string slicing (`slice`, `substring`, a truncate helper that cuts characters), disable font scaling or use `adjustsFontSizeToFit` to make such a value fit, or copy, sign, submit or compare a shortened value instead of the full one?

Allowed cases: Display shortening with `numberOfLines` and `ellipsizeMode` (including `"middle"`) on the full value; an authored short label; slicing text that is not one of those values (post previews, display names, search snippets, event-id fingerprints used as keys or logs); copy, sign and compare actions that use the full value.

## copy/honest

Scope: `**/*.tsx`

UI text never claims more security, privacy, delivery or settlement than the code establishes, and never shows raw error messages, stack traces, Zod issues or server responses.

Does `hunk` show UI text that claims more security, privacy, delivery or settlement than the visible state establishes ("Delivered", "Private", "Encrypted", "Paid" for a pending or unknown state), or put a raw `error.message`, stack trace, Zod issue or server response body on screen?

Allowed cases: Copy matches the state; errors go through a user-message formatter or error catalog before display; developer and debug screens.

## a11y/controls

Scope: `**/*.tsx`

Interactive controls have an accessible name, expose busy, disabled, selected and expanded state, and carry a stable semantic testID based on entity identity, never an index or display text.

Does `hunk` render an interactive control (an element with `onPress`, `onLongPress`, `onValueChange` or `onChangeText`) that lacks an accessible name (`accessibilityLabel`, or visible text inside a text button), lacks `accessibilityRole`, lacks `accessibilityState` for its selected, checked, disabled, busy or expanded state when it has one, or lacks a stable semantic `testID` — or builds its testID from a list index or display text?

Allowed cases: Controls with a name, a role, their relevant state and a testID derived from entity identity (`testID={`mint-row-${mintUrl}`}`); shared components (`Button`, `ListItem`, `SelectableCheck`, `CircleActionButton`) whose props carry label, state and testID and which the caller fills in; wrappers that forward accessibility props and testID from their own props to the pressable; non-interactive views; gesture-only surfaces with an accessible alternative; a positional slot testID (`backup-choice-${index}`) when the only other identity is secret material such as recovery-phrase words, which must never appear in a testID.

## a11y/nested-controls

Scope: `**/*.tsx`

Never nest an interactive control inside another accessible control; iOS exposes only the outer element, so the inner one becomes unreachable for VoiceOver and the harness.

Does `hunk` place an interactive element (an element with `onPress` or `onLongPress`, or a nested `Pressable`, `PressableFeedback`, `Button` or `Switch`) inside another accessible `Pressable`, `PressableFeedback` or touchable, or inside a container `View` marked `accessible` (which merges its children into one element that cannot be activated)?

Allowed cases: The controls are siblings; the outer element sets `accessible={false}`; the inner element is purely visual (no press handler); the outer element is a plain `View` without `accessible` or a gesture detector; an `accessible` container wrapping only static text; a container that is itself the single control and forwards `onAccessibilityAction` to its inner surface.

## perf/offscreen

Scope: `**/*.tsx`

Timers, animations and polling stop when their screen or row is not visible.

Does `hunk` start a repeating timer, polling loop or infinite animation (`withRepeat(…, -1)`, `Animated.loop`, `setInterval`, a `requestAnimationFrame` loop) in a screen or list row without stopping it when the screen loses focus, the app is backgrounded or the row leaves view?

Allowed cases: Uses `useIsFocused`, `useFocusEffect`, `useVisualActivityEffect`, AppState or a visibility prop to pause; animations with a finite repeat count; loops that run only while an operation is pending and stop on completion or failure; design-system catalogue screens that exist to run animations.

## state/selectors

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Subscribe to Zustand with the smallest selector, never the whole store or a selector returning a new object, array or function fallback; use getState() only in handlers, never during render.

Does `hunk` subscribe to a Zustand store with no selector (`useStore()`), with a selector that builds a new object, array or function on every call without `useShallow` (`s => ({ a: s.a })`, `s => s.items.filter(…)`, `s => s.list ?? []`), or read `useStore.getState()` in a component or hook body during render rather than inside a handler, effect or callback?

Allowed cases: Selectors returning a primitive or an existing reference (`s => s.items`); `useShallow` for multi-field picks; fallbacks to a module-level constant (`s => s.list ?? EMPTY`); `getState()` inside event handlers, effects, callbacks, async functions or non-React modules; non-Zustand hooks.

## perf/render

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Don't fetch, decrypt, parse, sort or serialize data during render or once per list row; batch through the data owners and render long lists with the shared virtualized List.

Does `hunk` fetch, decrypt, `JSON.parse`, sort or serialize data directly in a component render body or once per list row (inside `renderItem` or a row component) instead of in a data owner, hook or memoized derivation, or render an unbounded list with `ScrollView` and `.map` instead of the shared virtualized `List`?

Allowed cases: The work lives in a hook, store, selector or memoized derivation; small bounded lists (a few fixed items, a settings section, tabs, a handful of mints); cheap derivations.

## perf/memo

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

New components rely on React Compiler instead of adding useMemo, useCallback or memo without a measured need, and existing memoization is not removed without evidence.

Does `hunk` use `useMemo`, `useCallback` or `memo` purely as a speculative render optimisation — memoizing cheap values or plain event handlers that React Compiler already handles — with no comment giving a measured need and no non-performance reason for a stable identity?

Allowed cases: A comment states the measured need or the reason; stable identity is required for correctness (an effect or subscription dependency, a context value, a Reanimated worklet or gesture, a native or third-party prop compared by identity, a FlashList `renderItem` or `keyExtractor`); expensive derivations over collections; files that opt out of React Compiler.

## routes/thin

Scope: `app/app/**`, `**/_layout.tsx`

Route files parse params, choose the screen and configure navigation only; route params are small serializable identifiers, never secrets, objects or large data.

Does this route file contain work beyond reading and validating params, choosing a feature screen, redirecting or guarding, and configuring navigation — for example data fetching, business logic, state machines or a sizeable JSX layout — or pass or expect route params that are objects, JSON blobs, secrets or large data rather than small serializable identifiers?

Allowed cases: `_layout` files configuring navigators, providers and screen options; a route that reads params, validates them and renders one feature screen with those identifiers; params that are ids, enums or short strings.

## persist/migrations

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

Changing persisted state needs a version bump and migration for existing users' data.

Does `hunk` rename, remove, or change the type or allowed values of a field in persisted state (for example a zustand `persist` store) without also bumping its `version` and handling the old shape in `migrate`?

## persist/data-only

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

Persisted state holds plain data only: no functions, managers, promises, loading flags or decrypted private messages.

Does `hunk` persist — through a `persist` store's state or `partialize`, or a direct storage write — class instances, managers, promises, transient loading, pending or error flags, or decrypted private messages?

Allowed cases: Persisted state is plain JSON-serializable data and `partialize` leaves out transient fields; store actions (zustand persist never serializes functions); runtime-only stores without `persist`.

## persist/fallbacks

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

Schema defaults and .catch never turn invalid money, credentials, consent or trust into valid-looking state; unknown enum values fall back to a neutral member, never a privileged one.

Does `hunk` use a schema `.default()` or `.catch()`, a migration fallback, or a `??`/`||` default that turns missing or invalid money amounts, credentials, consent or terms acceptance, backup-verified status, or trust (trusted mints, allowed signers, granted permissions) into a valid-looking or privileged value, or make an unknown enum value fall back to a privileged member?

Allowed cases: Fallbacks to neutral or least-privileged values (`false`, `"ask"`, empty lists, `undefined`, not-accepted); fallbacks for presentational preferences (theme, sort order, UI toggles, display units).

## persist/scope

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

Identity-dependent data is profile-scoped, only identity-independent data is global, and cache keys include every input that changes the result (viewer, tier, filters, cursor).

Does `hunk` keep identity-dependent data (anything derived from the active profile's keys, wallet, contacts, DMs, follows or viewer-specific feeds) in a global, unscoped store or cache, or build a cache key that leaves out an input that changes the result (viewer pubkey, tier, filters, cursor, mint, unit)?

Allowed cases: Profile-scoped stores (under `stores/profile`, or created per profile or pubkey); global stores holding identity-independent data (mint metadata, relay info, public profiles, theme, app settings); cache keys that include every varying input.

## state/one-authority

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

Keep one authority per piece of data: no effect copying one store or cache into another, and no screen-level copy of balances, proofs or Nostr entities.

Does `hunk` copy data from one store, cache or query into another store via an effect or a mirroring subscription, or keep a separate copy of balances, proofs or Nostr entities that can drift from their owner?

Allowed cases: Values derived on read (selectors, memoized derivations); a store that is the single owner; caches filled by their own fetcher; drafts intentionally initialised once from a store value; e2e state mirrors that only expose state to the test harness.

## state/shape

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

Store actions update immutably, fields that change together live in one object, and meaningful 0, false and empty values survive truthy checks and || defaults.

Does `hunk` mutate store state in place (`state.items.push(x)`, `s.byId[k] = v` outside Immer), update fields that must stay consistent through separate `set` calls that can interleave, or drop a meaningful `0`, `false` or `""` through a truthy check or `||` default?

Allowed cases: Immutable updates or Immer; `??` and explicit `=== undefined` checks; truthy checks on values where 0, false or "" are genuinely invalid (ids, URLs, keys).

## state/clock

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

Freshness and expiry logic takes nowMs or an injected clock and reads it once per update; cache freshness never proves that a quote is valid or proofs are unspent.

Does `hunk` decide freshness, expiry or TTL by reading `Date.now()` (or `new Date()`) inside a pure freshness helper instead of taking `nowMs`, or read the clock more than once within one update so the checks can disagree, or treat cache freshness as proof that a quote is valid or proofs are unspent?

Allowed cases: Freshness helpers take `nowMs`; the clock is read once at the top of an action or effect and passed down; timestamps recorded for bookkeeping (`updatedAtMs: Date.now()`); quote and proof validity checked against the mint.

## nostr/facade

Scope: `nostr/**/*.{ts,tsx}`, `**/{nostr,relay,relays,feed,threads,contacts,composer,profile,profiles,notifications,dm,dms,zap,zaps}/**/*.{ts,tsx}`, `**/*{Nostr,Relay,Nip,Npub,Nagg,Primal,Zap,GiftWrap,Giftwrap}*.{ts,tsx}`

Read Nostr through the facade; screens don't build their own Nagg, Primal or relay fallback chains.

Does `hunk`, in a screen, hook or feature module outside `nostr/`, build its own chain of Nostr read sources (Nagg, then Primal, then relays), open relay connections or pools directly, or call Nagg, Primal or relay clients directly for reads the Nostr facade provides?

Allowed cases: Reads go through the facade; the file is part of `nostr/` or its tier implementations; publishing through the app publish module.

## nostr/signed-events

Scope: `nostr/**/*.{ts,tsx}`, `**/{nostr,relay,relays,feed,threads,contacts,composer,profile,profiles,notifications,dm,dms,zap,zaps}/**/*.{ts,tsx}`, `**/*{Nostr,Relay,Nip,Npub,Nagg,Primal,Zap,GiftWrap,Giftwrap}*.{ts,tsx}`

Never alter a signed event and still treat it as verified; keep the raw event, derive display data separately, and retry a publish by resending the same signed event.

Does `hunk` modify a signed Nostr event (its content, tags, `created_at`, `pubkey` or `id`) and still treat or store it as the verified signed event, or retry a publish by rebuilding or re-signing the event instead of resending the same signed event?

Allowed cases: Raw signed events stay unchanged and display data is derived into separate objects; retries resend the stored signed event; signing a brand-new event.

## nostr/delivery

Scope: `nostr/**/*.{ts,tsx}`, `**/{nostr,relay,relays,feed,threads,contacts,composer,profile,profiles,notifications,dm,dms,zap,zaps}/**/*.{ts,tsx}`, `**/*{Nostr,Relay,Nip,Npub,Nagg,Primal,Zap,GiftWrap,Giftwrap}*.{ts,tsx}`

Keep optimistic, signed, relay-accepted, delivered and failed as separate states; relay acceptance is not delivery.

Does `hunk` collapse optimistic, signed, relay-accepted, delivered and failed into fewer states — for example marking a message `delivered` or `sent: true` because a relay answered OK, or marking it failed because some relays timed out?

Allowed cases: Separate states are kept and relay OK is recorded as accepted.

## nostr/live

Scope: `nostr/**/*.{ts,tsx}`, `**/{nostr,relay,relays,feed,threads,contacts,composer,profile,profiles,notifications,dm,dms,zap,zaps}/**/*.{ts,tsx}`, `**/*{Nostr,Relay,Nip,Npub,Nagg,Primal,Zap,GiftWrap,Giftwrap}*.{ts,tsx}`

Live subscriptions don't auto-reconnect: pair them with cursor catch-up and dedupe by event ID.

Does `hunk` open a live Nostr subscription and rely on it alone — with no `since`/cursor catch-up after a reconnect or resume, or no dedupe of incoming events by event id?

Allowed cases: The live subscription is paired with a since/cursor catch-up and dedupes by id; one-shot queries.

## nostr/private-dms

Scope: `nostr/**/*.{ts,tsx}`, `**/{nostr,relay,relays,feed,threads,contacts,composer,profile,profiles,notifications,dm,dms,zap,zaps}/**/*.{ts,tsx}`, `**/*{Nostr,Relay,Nip,Npub,Nagg,Primal,Zap,GiftWrap,Giftwrap}*.{ts,tsx}`

Decrypt DMs on the device only; never send private keys or plaintext to Nagg, or persist decrypted messages unencrypted.

Does `hunk` send a private key or decrypted DM plaintext to Nagg or any server, decrypt DMs anywhere but on the device, or persist decrypted DM content without encryption?

Allowed cases: Only encrypted payloads and metadata leave the device; decrypted content stays in memory or encrypted storage.

## wallet/engine-owns

Scope: `app/**`

Screens trigger wallet actions or machine events; proof selection, mint, melt, swap, payment retries and history reconciliation stay in wallet/.

Does `hunk`, in a file under `app/`, implement wallet engine logic itself — selecting proofs, sequencing mint, melt or swap steps, retrying payments, or reconciling history — rather than triggering a `wallet/` action or machine event and rendering its state?

Allowed cases: App code calls one wallet or Coco API or machine event per user action and renders the result; the file is under `wallet/`; app code that only displays wallet state.

## wallet/cancel

Scope: `wallet/**/*.{ts,tsx}`, `**/{cashu,wallet,payment,payments,mint,mints,send,receive,transactions,nfc,nearPay,melt,swap,balance,proofs}/**/*.{ts,tsx}`, `**/*{Wallet,Payment,Mint,Melt,Send,Receive,Proof,Token,Invoice,Amount,Balance,Cashu,Lightning,Onchain}*.{ts,tsx}`

Leaving or cancelling a payment screen stops UI updates only; it never assumes the operation stopped or was refunded.

Does `hunk` treat leaving or cancelling a payment screen (unmount, back, a cancel button, an AbortSignal) as having stopped or refunded the underlying payment — marking it cancelled or refunded, releasing its proofs or clearing its pending record — without a wallet API confirming the rollback?

Allowed cases: Cancelling stops UI updates or unsubscribes; the operation is rolled back through a wallet API that confirms it (rolling back a prepared, unexecuted operation).

## wallet/locks

Scope: `wallet/**/*.{ts,tsx}`, `**/{cashu,wallet,payment,payments,mint,mints,send,receive,transactions,nfc,nearPay,melt,swap,balance,proofs}/**/*.{ts,tsx}`, `**/*{Wallet,Payment,Mint,Melt,Send,Receive,Proof,Token,Invoice,Amount,Balance,Cashu,Lightning,Onchain}*.{ts,tsx}`

A recipient-locked (P2PK/NUT-10) transfer never falls back to an unlocked bearer token, and a payment request's lock, mint list and unit constraints are never dropped.

Does `hunk` send an unlocked bearer token when a P2PK or NUT-10 lock was requested or failed, or drop a payment request's lock, allowed-mint list or unit when building the payment?

Allowed cases: Lock failures abort the send and constraints are honoured.

## wallet/mint-trust

Scope: `wallet/**/*.{ts,tsx}`, `**/{cashu,wallet,payment,payments,mint,mints,send,receive,transactions,nfc,nearPay,melt,swap,balance,proofs}/**/*.{ts,tsx}`, `**/*{Wallet,Payment,Mint,Melt,Send,Receive,Proof,Token,Invoice,Amount,Balance,Cashu,Lightning,Onchain}*.{ts,tsx}`

Never bypass TLS checks or add a fake trusted mint record to hide a network failure.

Does `hunk` bypass TLS or certificate checks, or add a fake or placeholder trusted-mint record (or mark a mint trusted or added) to hide a network or mint-info failure?

Allowed cases: Mint-info failures surface as errors or unknown state.

## wallet/fresh-flow

Scope: `wallet/**/*.{ts,tsx}`, `**/{cashu,wallet,payment,payments,mint,mints,send,receive,transactions,nfc,nearPay,melt,swap,balance,proofs}/**/*.{ts,tsx}`, `**/*{Wallet,Payment,Mint,Melt,Send,Receive,Proof,Token,Invoice,Amount,Balance,Cashu,Lightning,Onchain}*.{ts,tsx}`

A new Send, Receive, scan or NFC flow starts from cleared payment context without a previous recipient, amount, unit or mint, and offline sends never wait on network fetches.

Does `hunk` start a new Send, Receive, scan or NFC flow that reuses a previous flow's recipient, amount, unit or mint from shared or persisted state instead of clearing the payment context, or make an offline send wait on a network fetch?

Allowed cases: Flows reset payment context at entry; prefill from explicit new input (a scanned request, a deep link, the user picking a contact).

## cta/pure-eligibility

Scope: `app/shared/lib/cta/**`, `app/shared/blocks/Cta*`, `app/features/backup/**`, `app/app/\(prompt-flow\)/**`

A CTA's shouldShow is pure and synchronous over its injected context and clock; it never waits on the network.

Does a CTA's `shouldShow` or eligibility function in `hunk` await, read the network, read `Date.now()` instead of the injected clock, or cause side effects?

Allowed cases: Pure synchronous checks over the injected context and clock.

## cta/security-nags

Scope: `app/shared/lib/cta/**`, `app/shared/blocks/Cta*`, `app/features/backup/**`, `app/app/\(prompt-flow\)/**`

A security or backup prompt's primary action never dismisses it, blocking CTAs have no dismissal or back escape, and revealing the recovery phrase never marks the backup verified.

Does `hunk` make a security or backup prompt's primary action dismiss or snooze it, give a blocking CTA a dismiss, close or back escape, or mark the backup verified just because the recovery phrase was revealed or viewed?

Allowed cases: The primary action performs the backup or verification; verification requires the user to confirm words; a finished-backup screen whose button closes the completed flow; non-blocking CTAs dismissible through a secondary action.
