# Contributor conventions

These instructions were preserved from the previous Hunch policy during the semantic-review redesign. They remain human/agent guidance; Hunch does not claim to enforce all of them. Existing repository instructions, ADRs and explicit user decisions take precedence. Use lint/type checks for deterministic requirements.

[Automated policy](../../hunch.config.ts) · [Review contracts](contracts.md)

## errors/structured

Scope: `repository-wide`

Keep errors structured until they reach the UI: don't turn a caught error into a string, boolean, null or generic Error, and keep its cause, status, code and service.

Does `hunk` catch or receive an error that carries information a program could act on — a status or code, an error subclass or `name` such as `AbortError`, a typed `kind`, or an upstream cause — and pass it on only in a lossy form — a string (`String(err)`, `err.message`, a template string), a boolean, `null`/`undefined`, or a new generic `Error` without `{ cause }` — to a caller, store or return value that non-UI code relies on to branch, retry, classify or report on the failure?

Allowed cases: The error is rethrown, wrapped with `cause`, returned as a typed error, Result or discriminated union, or logged with the error object; an unknown thrown value is normalised while keeping the original when it already is an Error (`err instanceof Error ? err : new Error(String(err))`); there is no caught Error to preserve (a socket or DOM `error` event, a timer, a rejected payload, an invariant `throw new Error` outside any catch); a typed status, `kind` or Result derived from the live error travels alongside the string; the string is the program's final human-readable output (a screen's error text, a toast, a status label, CLI output, a test or run report); the original is withheld on purpose because it may contain secret material (tokens, invoices, seeds, keys) and a fixed or redacted message is thrown instead; the catch only detects that a pure parser or validator rejected its input (`new URL`, `JSON.parse`, a key decode); the error is being serialised onto a wire, IPC or file format, or into a failure shape a third party defines; the catch belongs to a documented best-effort path (optional enrichment, cache read, feature detection, cleanup, telemetry) whose failure is deliberately ignored and whose result decides nothing.

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

Does `hunk` attach a listener or subscription to something that outlives the attaching code (`window`, `document`, `AppState`, a store, an emitter, a native module, a socket), or start an interval, inside a component, hook, effect or other shorter-lived owner that never tears it down — or start a one-shot timeout whose callback sets state, navigates or performs I/O after the owner may be gone — or silently swallow a failure that matters: a `void` or un-awaited promise that visibly performs network, storage or wallet work and can reject, with no `.catch`, or an empty `catch {}` with no comment saying why ignoring the failure is safe?

Allowed cases: Effects return cleanup that unsubscribes or clears, or the handle is stored and disposed elsewhere in the visible code; a listener added to an element the same code just created and that is discarded with it, so their lifetimes are equal; a one-shot timer that only writes a ref, a local flag or a label; the promise has `.catch(...)`, `.then(onOk, onErr)` or a try/catch inside the async body; the callee returns a `Result`, `ResultAsync` or a tagged status object and so cannot reject, or is defined outside the hunk with nothing visible showing it can reject; `void` on calls that cannot reject or that handle their own errors (haptics, loggers, navigation, the share sheet, the clipboard, `preventAutoHideAsync`, functions the hunk shows catching internally); a catch that returns the function's documented failure value (`catch { return null }` in a parser); an empty catch with a comment explaining why the failure is expected and harmless; module-level singletons meant to live for the app lifetime.

## net/transport

Scope: `repository-wide`

Make requests through the domain transport (apiClient, wallet/safeFetch, the Nostr facade) with caller cancellation and a bounded deadline, not a screen-local fetch.

Does `hunk`, in code that has a domain transport module available to it (the app and its feature modules), call `fetch(`, `axios`, `XMLHttpRequest` or `new WebSocket(` from a screen, component, hook or feature module instead of through that transport, or — in code that ships to users or runs unattended (the app, its packages, release or CI automation) — start a request to a remote service that has neither caller cancellation (an AbortSignal) nor a bounded timeout?

Allowed cases: The file is itself the transport or client module for one service (apiClient, safeFetch, a `*Client.ts` or `api.ts` that owns one external API, or a small function that is the single client for one endpoint) and threads a signal or timeout through; the request goes through such a module, or through an interface that cannot take a signal and that the hunk does not implement; for the transport question, code outside the app runtime (a build or command-line script, a standalone website or developer tool page) where no such transport exists; for the deadline question, a loopback or same-origin server that the same test or developer tool started, so the runner's own timeout is the deadline, and code that only ever runs under a test runner or a developer-run tool (tests, the e2e harness, a local tooling page); e2e or test-harness code; a mocked `fetch`; `fetch` of a local `file://` or bundled asset.

## net/retries

Scope: `repository-wide`

Retry only idempotent reads, with bounded backoff; payments and other side effects are reconciled against persisted state, never simply repeated.

Does `hunk` retry — with a loop, a backoff helper or a re-invocation after failure — an operation whose repeat could duplicate an effect (a payment, melt, mint, swap, send, publish or other non-idempotent write that may already have happened), or retry anything without a bound on the number of attempts in either the loop header or its body?

Allowed cases: Bounded retries of idempotent reads (GET requests, quote or proof-state checks, metadata fetches) with backoff; bounded re-preparation of an operation that has not executed yet and so has no side effect; reconciling a failed side effect by checking persisted or mint state; a bounded new attempt (a new quote or a smaller amount) made only after persisted or mint state shows the previous attempt did not execute; resending the same already-signed Nostr event; a bounded retry of an idempotent write whose repeat cannot duplicate anything (a content-addressed upload, a PUT of the same resource); a `for (;;)` or `while (true)` whose body enforces a maximum attempt count.

## input/parse-at-boundary

Scope: `repository-wide`

Parse untrusted input (network, relays, route params, storage, QR codes, clipboard, native callbacks) with a Zod schema at the boundary, and infer the type from that schema instead of redeclaring it.

Does `hunk` contain the point where data an outside party controls — a network, relay or mint response, `JSON.parse` of such text, a storage read an older app version may have written, QR, clipboard, NFC or deep-link data, another app, or a native callback payload — first becomes a typed value, and give it a type that asserts unverified facts (`as T`, `as unknown as T`, a declared type with concrete required fields, a generic `JSON.parse(x) as T` helper) and then rely on a field whose runtime type was never checked, instead of validating it with a Zod schema, a dedicated protocol decoder or a per-field guard at that boundary?

Allowed cases: The input is validated by a Zod schema (`.parse`/`.safeParse`) or by a protocol library decoder with typed output (cashu-ts `getDecodedToken`, nostr-tools `nip19.decode`, a bolt11 decoder), in the hunk or in a helper or injected validator it calls; the value comes from an SDK that already validated it, and the cast only bridges two typings; casts of trusted in-process values or of this app's own typed stores; data this project itself produced in the same process or tool run (its own committed files, its own dev server, the output of a tool the code just invoked, a value it serialised a moment earlier); route params used as plain string identifiers or narrowed before use; a widening cast to `unknown`, `Record<string, unknown>` or an all-optional shape where every field that is read is then checked (by `typeof`, `Array.isArray`, strict equality with a literal, a regex, a numeric range check, a fail-closed assertion or coercion); a cast that follows a narrowing of the same value; `as` on something that is not data (`require(addon) as T`); a test parsing its subject's own output or a fixture in order to assert on it.

## input/structure-not-trust

Scope: `repository-wide`

A successful schema parse proves shape only; never treat it as a verified signature, an authorization or a spendable proof.

Does `hunk` treat a successful schema parse or shape check as proof that a Nostr event signature is valid, that an action is authorized, or that Cashu proofs are spendable — skipping signature verification, permission checks or mint state checks because the data parsed?

Allowed cases: Signatures, permissions or proof states are checked separately; parsed data is displayed or stored as unverified.

## money/exact

Scope: `repository-wide`

Amounts that decide a payment use exact integer or SDK values with their unit and mint: no floating-point BTC math, toFixed, rounding, or coercion of invalid, negative or fractional input.

Does `hunk` compute an amount that decides what is paid, sent, minted or received (sats, msats, proof amounts, fees, invoice amounts) with floating-point BTC math, a fractional fee or percentage factor applied to integer sats (`amount * 0.02`), `toFixed`, `Math.round`/`floor`/`ceil` of fractional values or `parseFloat`, or by silently coercing invalid, negative, NaN or fractional input into a valid amount?

Allowed cases: Integer arithmetic on sat or msat integers, including fees in basis points with integer division; conversions for display only (fiat labels, formatted strings, charts); rounding inside a fiat estimate that never decides what is paid; a single explicit rounding where an amount crosses currencies through an exchange rate (a fiat entry or fiat minor units converted to sats), provided a missing or invalid rate is rejected and the integer result is the amount then shown and confirmed; input validation that rejects invalid values; `Math.ceil` of an integer division used for fee reserves in integer sats.

## time/units

Scope: `repository-wide`

Name durations with their unit (timeoutMs, ttlSeconds). A timestamp named `…At` or `timestamp` is epoch milliseconds, as `Date.now()` returns, and needs no suffix; a timestamp in any other unit states it (createdAtSec). Convert Nostr seconds once at the boundary, and store raw timestamps rather than formatted labels.

Does `hunk` declare a variable, constant, field or parameter holding a numeric duration whose name does not state its unit (`timeout`, `delay`, `ttl`, `interval`), hold a timestamp counted in seconds under a name that does not say so (`createdAt = event.created_at`, `expiresAt = Math.floor(Date.now() / 1000) + ttl`, a field documented `/** unix seconds */` under an `…At` name), mix Nostr seconds with JavaScript milliseconds without an explicit conversion, or persist a formatted time label instead of the raw timestamp?

Allowed cases: Names carry the unit (`timeoutMs`, `createdAtSec`, `ttlSeconds`, `STALE_MS`); an epoch-millisecond timestamp named `…At` or `timestamp` (`createdAt: Date.now()`, `updatedAt`, `expiresAt`); Nostr fields named by the protocol (`created_at`, `since`, `until`) used at the boundary; a field that keeps the name its mint, Coco or wire-format owner gave it (`expiry` on a quote); a persisted field that holds seconds and says so in a comment on its declaration, because renaming stored data needs a migration; `Date` objects; option names fixed by a library or wire format the code doesn't control (the delay argument of `setTimeout`, `{ timeout }` passed to an external API, `staleTime` in React Query options); a timer handle or a function that is merely named `timeout`, `interval` or `delay` and holds no number; a fixture or call that only fills a field whose name is declared elsewhere (an imported type, a wire or library option).

## secrets/storage

Scope: `repository-wide`

Mnemonics, private keys, nsec and signing secrets stay in secure storage and never appear in stores, AsyncStorage, route params, URLs, test IDs, fixtures or logs.

Does `hunk` put a mnemonic, seed, private key, nsec or other signing secret that a real user or deployment could hold anywhere other than secure storage (expo-secure-store or the key vault module) — a Zustand store, AsyncStorage or MMKV, route params, URLs, testIDs, fixtures or logs?

Allowed cases: Only public keys, npubs, key ids, pairing-intent metadata without secrets, or opaque references are stored; secrets pass in memory to signing or into SecureStore; a deliberately public test vector (a published BIP-39 or NIP-06 mnemonic and the keys derived from it) or an obviously synthetic placeholder (`'fixture-nsec'`, a zeroed byte array) used as test, mock or known-answer input, which no wallet holds; a value held only in a local variable or constant, with no storage, route, URL or log involved.

## secrets/logs

Scope: `repository-wide`

Logs never include seed words, private keys, Cashu proofs or tokens, invoices, DM contents, PINs, raw NFC bytes or credential-bearing URLs.

Does application or library code in `hunk` emit a diagnostic log, analytics event or error report (with `log.*`, `console.*`, a logger, analytics or an error reporter) with a value that is or contains seed words, a private key, Cashu proofs or an encoded token, a Lightning invoice, DM plaintext, a PIN, raw NFC bytes, or a URL carrying credentials?

Allowed cases: Logs record only counts, amounts, ids, hashes, short fingerprints, mint URLs, states or error codes; a test passing a synthetic secret-shaped value to the logger under test in order to assert that it is redacted; a command-line tool writing the result its operator asked for (a generated key, derived test vectors) to its own stdout, which is the program's output rather than diagnostic logging or telemetry; published test vectors that are not secrets.

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

Does `hunk` put code with the wrong owner: (a) a file under `app/` that itself performs the computation of a payment — deciding the order of mint, melt, swap or receive operations, choosing proofs or amounts to spend, polling wallet history to reconcile an operation, expanding a route into executed legs, or looping or retrying a payment call automatically; (b) Nostr relay transport or a Nagg → Primal → relay fallback chain outside `nostr/`; (c) code under `wallet/` or `nostr/` importing app modules, Expo navigation or app stores; (d) a grab-bag module whose file name is `utils`, `helpers`, `misc` or `common` and that mixes unrelated concerns; or (e) one shared function whose behaviour is switched by caller-specific flags or caller names?

Allowed cases: A focused single-purpose module in `app/shared/lib` or `app/shared/hooks` (a formatter, the logger, a cache factory, a color helper, a generic hook such as `useDebouncedValue`) — a shared module is correct when it has one clear purpose and no domain owner; device I/O, native bridges and screen glue in `app/`; the domain packages themselves (`wallet/`, `nostr/`) implementing their own concerns; UI that calls a wallet or Nostr API and renders the result; app code that constructs a wallet-package engine or machine with injected ports or callbacks and mirrors its outcome into UI state; a user-tapped retry that calls the same wallet API again; busy or re-entrancy guards; a sheet or menu that displays wallet-computed options and forwards the choice; payment vocabulary that appears only in names (a proof selector sheet, an orchestrator hook) while the work is delegated.

## naming/verbs

Scope: `repository-wide`

Function names follow their verb: get is synchronous and local, fetch reads the network, load reads local persistence, build and compute are pure, format returns display text, parse decodes text.

Does `hunk` define a function whose leading verb contradicts what its body visibly does: `get*` that is async or performs network or storage I/O; `fetch*` that performs no network read; `load*` that reads the network rather than local persistence; `build*` or `compute*` with side effects its caller can observe (state or store mutation, persistence, network, navigation, mutating an argument); `format*` returning something other than display text; `parse*` that does not decode text or unknown input?

Allowed cases: The body matches the verb; `get*` returning a cached or in-memory value synchronously; a diagnostic log or metric call inside an otherwise pure `build*`/`compute*`; React hooks (`use*`); names imposed by an interface, library or protocol that the code implements; a function whose body isn't visible in the hunk.

## naming/protocol

Scope: `repository-wide`

Name protocol values by exact meaning (cashuTokenEncoded, proofSecret, mintQuoteId, nostrPubkeyHex, nostrEventId, lnInvoiceBolt11) rather than a bare token, secret, pubkey or quote, and reuse protocolIds instead of new ID regexes.

Does `hunk` declare a new variable, field, parameter or prop holding a protocol value under a bare generic name — `token`, `secret`, `pubkey`, `quote`, `invoice` — where nothing nearby (the enclosing type, function or module name, or the value's own initialiser) makes its kind and encoding clear, or introduce a regex that validates, classifies or redacts a Nostr, Cashu or Lightning identifier when an equivalent shared matcher already exists (`protocolIds` for 64-hex ids and Cashu P2PK keys, the logger's secret patterns for redaction) instead of reusing it?

Allowed cases: Names that state meaning (`cashuTokenEncoded`, `nostrPubkeyHex`, `mintQuoteId`, `lnInvoiceBolt11`); names scoped by their container (`quote.id` on a `MintQuote`, `event.pubkey` on a Nostr event, `pubkey` inside a type named `NostrProfile`); field names fixed by a protocol, SDK or wire format; destructured SDK fields; a short-lived local whose initialiser on the same line shows its kind and encoding (a `cashuB…` or `lnbc…` literal), or that is named to match the shorthand property of an existing API (`{ token, amount }`); a regex for a format that has no equivalent shared matcher, that classifies only a family (is this string lower-case bech32?) or that matches something unrelated to protocol identifiers; the `protocolIds` module itself and the module that owns the shared redaction patterns.

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

Does `hunk` show a route or screen component — one rendered as a page — mounting its own `<Stack>` navigator element (with children, `screenOptions`, or bare) in a file that is not a `_layout` file, where nothing in the hunk shows the component is a layout used by `_layout` files?

Allowed cases: A `<Stack>` in a `_layout` file; a shared layout component documented as rendered by `_layout` files (for example a search layout reused by several tab layouts); a reusable navigator wrapper that takes `children` (the `Stack.Screen` declarations its importers supply) and is not itself a route; screen files that only use `Stack.Screen`, `Stack.Toolbar`, `Stack.SearchBar` or similar sub-components to configure themselves — `<Stack.` followed by a sub-component name is never a navigator.

## skill/expo-router/prefer-native-tabs

Scope: `repository-wide`

JS Tabs from expo-router may be used instead of NativeTabs, which gives a native tab bar.

Does `hunk` add a JS tab navigator (`Tabs` from `expo-router` or `@react-navigation/bottom-tabs`) as the only tab bar, where NativeTabs could be used instead?

Allowed cases: The layout renders NativeTabs where they are supported and uses JS `Tabs` only as the fallback for platforms or OS versions without them; headless tabs from `expo-router/ui` in a `.web.tsx` file.

## ui/read-states

Scope: `**/*.tsx`

Async screens show distinct loading, empty, failed and stale-with-data states: a failed or unavailable read is never shown as empty, and existing rows stay visible while refreshing or after a refresh fails.

Does `hunk` render an async-loaded list or value so that a failed or unavailable read shows the user the same explicit empty state (`Nothing here yet`, `No results`, an empty list) as a genuinely empty result, or so that rows already on screen are replaced by a spinner, skeleton or empty state while the same query is refreshing or after that refresh fails?

Allowed cases: Separate error, empty and loading branches; cached rows kept during refetch; rows cleared because the query's inputs changed (a different account, unit, filter or profile), so the old rows would be wrong data; a failed background refresh that keeps showing last-known or derived data; optional enrichment (a name, avatar or metadata lookup) that falls back to the un-enriched value while the primary content and action still work; static or synchronous data.

## ui/unknown-values

Scope: `**/*.tsx`

Unknown counts stay undefined and render as a placeholder, never 0; image fallbacks appear only once the source is known to be missing or failed (avatarStateFor).

Does `hunk` display a count, total or amount whose source can be unknown or not yet loaded (a pending query, a remote count, a store still hydrating) as `0` (`count ?? 0` or `|| 0` feeding rendered text), or show an image fallback that asserts there is no image (initials, a silhouette, a generic or seeded avatar) before the image source is known to be missing or has failed to load?

Allowed cases: Unknown values stay `undefined` and render a placeholder, skeleton or dash; `?? 0` used in arithmetic that is not displayed, or for values that are zero by definition when absent (the length of a local list, a missing key in a locally computed tally, histogram or per-item balance map); a default that cannot be reached because the enclosing render branch is already guarded on the value being defined; avatars driven by `avatarStateFor` or an equivalent load-state check, such as a ternary that tests a loading flag before choosing the fallback (`isLoading ? 'loading' : url ? 'image' : 'fallback'`); progressive enhancement where the interim visual is the same content at lower fidelity (a static glyph before its animated version, a blurhash or thumbnail before the full image).

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

Does `hunk` define a component that renders one self-contained block for screens to stack (a card, notice, banner, QR block, selector or copy row), whose outermost element sets its own top or bottom margin (`mt-*`, `mb-*`, `my-*`, `marginTop`, `marginBottom`, `marginVertical`), including a margin computed from a prop that exists only to describe its neighbour (`hasText`, `isFirst`)?

Allowed cases: The root sets only horizontal insets (`mx-4`) or takes its outer spacing from a `className` or `style` prop; margins on inner elements of the block; a component that is the row of a virtualized list (rendered from `renderItem`), since the list cannot supply a gap between rows; a screen or page component laying out its own sections; design-system catalogue screens under `features/settings`.

## ui/platform

Scope: `**/*.tsx`

Choose glass or blur variants with the capability hook or defineVariants rather than Platform.OS or iOS version checks, and keep iOS-only native imports out of Android-reachable modules.

Does `hunk` decide whether to render a glass, blur, frosted or liquid-glass layer, style or component rather than a flat fallback with `Platform.OS`, `Platform.select` or an iOS version check instead of the capability hook or `defineVariants`, or add a top-level value import (not `import type`) of a package whose JavaScript entry unconditionally requires an iOS-only native module or SwiftUI view (liquid glass, `@expo/ui/swift-ui`, `expo-glass-effect`) in a cross-platform module that Android also loads?

Allowed cases: A capability hook or `defineVariants` chooses the variant; `.ios.tsx`/`.android.tsx` splits, and platform or capability variant files that only an `.ios` entry registers (`X.liquid.tsx` reached from `index.ios.ts`); code that itself defines or exports an availability or capability check, or guards the `require` of a platform-only native module (`isSupported` derived from the platform and OS version); guarded lazy requires; `import type`; an imported wrapper that guards its native require with a platform check and provides a fallback; a hunk that shows usage of such a component but no import statement; `Platform` checks for genuine behaviour differences that are not glass or blur styling (keyboard behaviour, haptics, permissions, maps providers, native APIs, font metrics, shadow versus elevation, status bar).

## ui/single-submit

Scope: `**/*.tsx`

Prevent double submission of payments and other actions with the owner's busy state, not only a debounce.

Does `hunk` add a pay, send, confirm, submit or publish action whose handler commits the side effect and can run twice when tapped twice quickly — nothing prevents re-entry (no single-flight guard, no busy state from the owner, no state-machine phase check), or it relies only on a debounce or timer?

Allowed cases: The shared `Pressable` or `Button` with an async handler (their single-flight guard drops re-entry); `disabled={busy}` driven by the owning state; a state-machine guard, including a dispatch into a machine that ignores or supersedes a repeated event; `useSingleFlight`; a handler that only opens or seeds a flow that still requires confirmation before anything is paid or sent, whatever its label says; actions without side effects (navigation, toggles, opening sheets, copying).

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

Does `hunk` render an interactive control (an element with `onPress`, `onLongPress`, `onValueChange` or `onChangeText`) that lacks an accessible name (`accessibilityLabel`, or visible text inside a text button), lacks `accessibilityRole`, lacks `accessibilityState` for its selected, checked, disabled, busy or expanded state when it has one, or lacks a stable semantic `testID` — or builds its testID from the index of a data-driven list whose items have their own id, or from free or remote display copy (a title, display name, translated label or slugified label) rather than entity identity?

Allowed cases: Controls with a name, a role, their relevant state and a testID derived from entity identity (`testID={`mint-row-${mintUrl}`}`); a testID that interpolates the item's own key — a member of a closed literal union, `as const` list or enum that the code compares against for selection, even if it is also rendered; the ordinal of a fixed-geometry part (segment, slot, step, page, keypad digit); shared components (`Button`, `ListItem`, `SelectableCheck`, `CircleActionButton`) whose props carry label, state and testID and which the caller fills in; wrappers that forward accessibility props and testID from their own props to the pressable; non-interactive views; gesture-only surfaces with an accessible alternative; a positional slot testID (`backup-choice-${index}`) when the only other identity is secret material such as recovery-phrase words, which must never appear in a testID; a React `key`; test code that looks a testID up rather than assigning one.

## a11y/nested-controls

Scope: `**/*.tsx`

Never nest an interactive control inside another accessible control; iOS exposes only the outer element, so the inner one becomes unreachable for VoiceOver and the harness.

Does `hunk` place an interactive element (an element with `onPress` or `onLongPress`, or a nested `Pressable`, `PressableFeedback`, `Button` or `Switch`) inside another accessible `Pressable`, `PressableFeedback` or touchable, or inside a container `View` marked `accessible` (which merges its children into one element that cannot be activated) — including an `accessible` wrapper with a button or image role around a native or hosted button when nothing forwards activation to its handler?

Allowed cases: The controls are siblings; the outer element sets `accessible={false}`; the inner element is purely visual (no press handler); the outer element is a plain `View` without `accessible` or a gesture detector; an `accessible` container wrapping only static text; a container that is itself the single control and forwards activation inward to the same handler (`onAccessibilityTap`, `onAccessibilityAction` or its own `onPress`).

## perf/offscreen

Scope: `**/*.tsx`

Timers, animations and polling stop when their screen or row is not visible.

Does `hunk` start a repeating timer, polling loop or infinite animation (`withRepeat(…, -1)`, `Animated.loop`, `setInterval`, a `requestAnimationFrame` loop) in a screen or list row that can keep firing indefinitely — it has no deadline, or its stop condition may never occur — because nothing stops it when the screen loses focus, the app is backgrounded or the row leaves view?

Allowed cases: Uses `useIsFocused`, `useFocusEffect`, `useVisualActivityEffect`, AppState or a visibility prop to pause; animations with a finite repeat count; loops that run only while an operation is pending and stop on completion or failure; a loop that clears itself at a known, finite deadline a short time ahead (a cooldown or rate-limit countdown); design-system catalogue or demo screens that exist to cycle or animate examples, whatever kind of loop they use (`setInterval` included).

## state/selectors

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Subscribe to Zustand with the smallest selector, never the whole store or a selector returning a new object, array or function fallback; use getState() only in handlers, never during render.

Does `hunk` subscribe to a Zustand store with no selector (`useStore()`), with a selector whose return value is a new object, array or function on every call without `useShallow` (`s => ({ a: s.a })`, `s => s.items.filter(…)`, `s => s.list ?? []`), or evaluate `useStore.getState()` every time a component or hook body runs — as a top-level statement of that body or an expression in its JSX or props — rather than inside a handler, effect, callback or other function that runs later?

Allowed cases: Selectors returning a primitive or an existing reference (`s => s.items`), including one that builds intermediate arrays but returns a primitive (`.filter(…).map(…).join(',')`, `.length`, `.some(…)`) or an existing element (`.find(…)`); `useShallow` for multi-field picks; fallbacks to a module-level constant (`s => s.list ?? EMPTY`); `getState()` inside event handlers, effects, callbacks, async functions or non-React modules, or inside any function declared in the body that runs later (a menu builder, a helper called from a handler) — lexical position inside the hook is not render time; a `useState(() => …)` or `useRef` initialiser that deliberately snapshots the store once at mount (seeding a form draft that must not reset); non-Zustand hooks.

## perf/render

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Don't fetch, decrypt, parse, sort or serialize data during render or once per list row; batch through the data owners and render long lists with the shared virtualized List.

Does `hunk` fetch, decrypt, `JSON.parse`, sort or serialize data directly in a component render body or once per list row (inside `renderItem` or a row component) instead of in a data owner, hook or memoized derivation, or render with `ScrollView` and `.map`, instead of the shared virtualized `List`, a list whose length can grow without a cap (a feed, a history, transaction or message log, a full contact or follow list, search results with no limit)?

Allowed cases: The work lives in a hook, store, selector or memoized derivation; small bounded lists (a few fixed items, a settings section, tabs, a handful of mints); a top-N or recents list capped by its source (a `limit`, `slice` or maximum); a user-curated configuration list (relays, mints, accounts); cheap derivations.

## perf/memo

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

New components rely on React Compiler instead of adding useMemo, useCallback or memo without a measured need, and existing memoization is not removed without evidence.

Does `hunk` use `useMemo`, `useCallback` or `memo` purely as a speculative render optimisation — memoizing cheap values or plain event handlers that React Compiler already handles — with no comment giving a measured need and no non-performance reason for a stable identity?

Allowed cases: A comment states the measured need or the reason; stable identity is required for correctness (an effect or subscription dependency, a context value, a Reanimated worklet or gesture, a native or third-party prop compared by identity, a FlashList `renderItem` or `keyExtractor`); expensive derivations over collections; files that opt out of React Compiler.

## routes/thin

Scope: `app/app/**`, `**/_layout.tsx`

Route files parse params, choose the screen and configure navigation only; route params are small serializable identifiers, never secrets, objects or large data.

Does this route file itself define work beyond reading and validating params, choosing a feature screen, redirecting or guarding, composing providers and gates, and configuring navigation — for example data fetching, a store subscription or effect with its logic written inline, business logic, state machines, or visual UI of its own such as rows, menus, custom drawer or tab content or a screen layout — or pass or expect route params that are objects, JSON blobs, secrets or large data rather than small serializable identifiers?

Allowed cases: `_layout` files configuring navigators, providers, gates and screen options, including a font or splash gate and theme, dimension or single `useState` reads that only feed `screenOptions`; mounting headless components or calling one feature hook whose body lives elsewhere, for instance to obtain a handler for navigation chrome; a route that reads params, validates them and renders one feature screen with those identifiers; params that are ids, enums or short strings.

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

Does `hunk` use a schema `.default()` or `.catch()`, a migration fallback, or a `??`/`||` default that turns missing or invalid money amounts, credentials, consent or terms acceptance, backup-verified status, or trust (trusted mints, allowed signers, granted permissions) into a value that grants something — funds, access, identity, consent or trust — or make an unknown enum value fall back to a privileged member?

Allowed cases: Fallbacks to neutral or least-privileged values (`false`, `"ask"`, empty lists, `undefined`, not-accepted), including the enum member that fails closed — the one that demands a credential or errors visibly rather than deriving or granting anything; fallbacks for presentational preferences (theme, sort order, UI toggles, display units).

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

Does `hunk` contain a reusable freshness predicate — a helper that returns whether something is stale, expired or still valid (`isStale`, `isExpired`, `peekX`) — that reads `Date.now()` (or `new Date()`) itself instead of taking `nowMs`, or read the clock more than once within one action for values that are then compared with each other, or treat cache freshness as proof that a quote is valid or proofs are unspent?

Allowed cases: Freshness helpers take `nowMs`; the clock is read once at the top of an entry-point action or effect (prune, fetch, set) into a local and reused or passed down; separate actions in the same file each reading the clock once; timestamps recorded for bookkeeping and not compared in the same action (`updatedAtMs: Date.now()`); quote and proof validity checked against the mint.

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

Does `hunk`, in a shipped app runtime file under `app/` (a screen, hook, store or feature lib bundled into the app), implement wallet engine logic itself — selecting proofs, sequencing mint, melt or swap steps, overriding or re-implementing a `wallet/` machine operation, retrying payments, or reconciling history — rather than triggering a `wallet/` action or machine event and rendering its state?

Allowed cases: App code calls one wallet or Coco API or machine event per user action and renders the result; the file is under `wallet/`; app code that only displays wallet state; a test harness, fixture or tool that drives or audits the wallet from outside the app runtime (an E2E custody, recovery or accounting script), even though it lives under `app/`; wallet vocabulary that appears only in names (a proof selector sheet, an orchestrator hook) while the work is delegated.

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

Does `hunk` bypass TLS or certificate checks, or, in a failure branch, write to the wallet's mint or trust state — add a fake or placeholder trusted-mint record, or mark a mint trusted or added — to hide a network or mint-info failure?

Allowed cases: Mint-info failures surface as errors or unknown state; a transient display row or view-model (the URL shown as the name, a zero balance) for a mint the wallet already holds; a trust lookup that fails closed (`.catch(() => false)`).

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

## ui/headers

Use the [header contract](header-contract.md): `Screen` gradient chrome, shared
`useIdentityHeader` handoff where a page identity can collapse into navigation, and
measured `stickyContent` for persistent section tabs. Preserve header actions,
scroll clearance and identity continuity on iOS and Android. Do not build screen-local
morph animations or place multi-row controls in a navigation title.

## units/registry

Scope: `app/features/**/*.{ts,tsx}`, `app/shared/**/*.{ts,tsx}`, `app/app/**/*.{ts,tsx}`, `wallet/src/**/*.ts`, `nostr/src/**/*.ts`

Which units the wallet offers, and each unit's label, name, symbol and decimals, are declared once in the unit registry (`wallet/src/units/registry.ts`, importable as `wallet/units`); everything else derives from it.

Does `hunk` hand-write a currency or unit vocabulary instead of importing or deriving it from the unit registry (`SWITCHABLE_UNITS`, `FIAT_UNITS`, `ACCOUNT_UNITS`, `SwitchableUnit`, `FiatUnit`, `AccountUnit`, `unitDefinition`, `unitSymbol`, `unitMinorDecimals`, `isFiatUnit`, `accountUnitLabel`)? A vocabulary is a `'sat' | 'usd' | …` union, a `['SAT', 'USD', …]` list, a `{ usd: '$', … }` symbol, label, name, flag or decimals map keyed by unit, a run of `unit === 'usd' || unit === 'eur' || …` comparisons, a cast to such a union, or an inline `unit === 'sat' ? 'BTC' : unit.toUpperCase()` label.

Allowed cases: The registry itself and `app/shared/lib/cashu/unitPresentation.ts`, whose icon tables are typed `Record<SwitchableUnit | FiatUnit, …>` so a new unit fails to compile without an entry; a comparison against ONE specific unit for behaviour that genuinely belongs to that unit (`unit === 'sat'` for the Lightning address, sat display modes); protocol unit strings passed through untouched; test fixtures and e2e scenarios; nagg's upper-case rate codes derived from `FIAT_UNITS`.

## types/derive

Scope: `repository-wide`

A type, list or lookup that restates values another declaration owns is derived from that owner, so the two cannot drift.

Does `hunk` declare a literal union, interface, array or lookup table that restates values already owned by an `as const` object or array, a zod schema, or a library type, instead of deriving it (`typeof X[number]`, `keyof typeof X`, `z.infer`, `Pick`, `Omit`, `Parameters`, `ReturnType`)? Or does it index a fixed literal lookup table (`TABLE[expr]`) with an expression whose static type is a declared literal union or enum while the table is typed `Record<string, …>` or with an index signature, or cast the key (`unit as 'usd' | 'eur'`) without handling a miss, so that a new union member compiles with no entry?

Allowed cases: The declaration is the owner; the table is typed `Record<Union, …>` or `satisfies Record<Union, …>`; an `as const satisfies Record<string, V>` object whose literal keys are themselves the owner of the union (`keyof typeof TABLE`); a deliberately partial table typed `Partial<Record<Union, …>>` with a handled miss; keys that are genuinely arbitrary strings (parsed input, a wire or third-party value, user text) with the miss handled; an object added to or deleted from at runtime, or a data map or accumulator rather than a fixed table; `Record<string, unknown>` used as the generic JSON-object type; `Object.keys(x) as (keyof typeof x)[]`; wire types generated from or validated by a schema; test fixtures and test-harness code.

## types/illegal-states

Scope: `repository-wide`

Mutually exclusive states are a discriminated union, not a boolean plus optional fields that admit contradictory combinations.

Does `hunk` add or extend a type that models mutually exclusive states as a boolean plus optional fields, or as several booleans that must stay in sync (`{ loading; data?; error? }`, `completed` plus `completedAt?`, `isPaid` and `isFailed`), where a discriminated union would make the contradictory combinations unrepresentable?

Allowed cases: Independent flags that can each be true or false in any combination; props of a presentational component; wire or persisted shapes owned by another system; a boolean derived from the single source rather than stored beside it.

## zod/callbacks-dont-throw

Scope: `repository-wide`

Zod 4 does not catch a throw inside a refinement or transform: it escapes `safeParse`, `parseWith` and the persist merge.

Does `hunk` contain a `throw` inside a `.refine`, `.superRefine`, `.check`, `.transform` or `z.preprocess` callback, or call something there that visibly throws on bad input (`JSON.parse`, `new URL`, `BigInt(…)`, a decoder) without catching it and reporting an issue instead This includes a callback that seems protected by an earlier check on the same schema (`z.url().refine((v) => new URL(v)…)`): Zod 4 still runs refinements after a failed non-aborting check, so the callback sees the invalid input?

Allowed cases: The callback returns `false`, adds an issue through `ctx`, or returns `z.NEVER`; the throwing call is wrapped in a try/catch that reports an issue.

## zod/v4-api

Scope: `repository-wide`

Zod 3 parameters and shapes that Zod 4 silently ignores or changes are bugs, not style.

Does `hunk` pass `required_error`, `invalid_type_error` or `errorMap` to a zod schema (Zod 4 silently ignores them; use `error`), spread a `z.looseObject` or `z.strictObject` shape into a new `z.object({ ...X.shape })` (the result silently strips unknown keys; use `.extend`), call `.pick`, `.omit` or `.partial` on a refined object (throws), intersect (`z.intersection`, `.and`) schemas whose overlapping keys are transformed (throws a plain `Error` out of `safeParse`), use `z.record(EnumSchema, …)` where some keys may be absent (exhaustive in Zod 4; use `z.partialRecord`), or add an async refinement or transform to a schema parsed with synchronous `safeParse` or `parse` (throws)?

Allowed cases: `message` (deprecated, still works); `.extend` on a loose or strict object; a spread whose strip-mode result is intended and commented; schemas parsed with `safeParseAsync`.

## zod/defaults-and-coercion

Scope: `repository-wide`

A default or a coercion never manufactures a valid-looking value from missing or malformed input.

Does `hunk` add `z.coerce.number()` or `z.coerce.boolean()` to input that can be a string (`''` becomes `0`, `'false'` becomes `true`), or add `.default(v)` to a schema with a `.transform`, `.pipe` or checks where `v` is an input-side value (`.default` short-circuits: it must be of the OUTPUT type and skips validation; `.prefault` runs the value through the schema)?

Allowed cases: `z.stringbool()` or an explicit string-to-boolean mapping; a coercion preceded by a non-empty check or applied to a value that is already numeric; `.default` whose value is of the output type; `.prefault` for input-side defaults.

## zod/boundary-parse

Scope: `repository-wide`

Schemas are built once at module scope and untrusted data is parsed with a non-throwing parser.

Does `hunk` construct a `z.*` schema inside the body of a React component, hook, store action, request handler or loop, so that it is rebuilt on every render, call or iteration, rather than at module scope, or call a throwing `.parse(` on network, storage, relay, deep-link or native-module data instead of `safeParse` or a hoisted `parseWith(Schema, where)`?

Allowed cases: A schema that genuinely depends on a runtime value and is memoized or built once per call site by design; a named factory function that returns a schema from its arguments, which is judged where it is called, not where it is defined; `.parse` on a constant the module itself owns; tests.

## zod/issue-values

Scope: `repository-wide`

Zod issue messages embed the offending values; logs and UI carry issue paths and codes only.

Does `hunk` log, persist, send or display zod issue text — `error.message`, `z.prettifyError`, `z.flattenError`, `z.treeifyError`, `issue.message`, `issue.input`, or a schema built with `reportInput` — for data that can hold secrets, tokens, invoices, mint URLs or private message content, or log issue `path`s for a record keyed by a secret (a token, quote secret or invoice), since the path carries the key and `unrecognized_keys` carries key names?

Allowed cases: `loggableIssues(error)` or an equivalent that keeps only `path` and `code`; messages the schema author wrote as fixed strings with no interpolated input; development-only assertions in tests.

## persist/config-seam

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

Every persisted store goes through `persistConfig`, and every persisted enum is tolerant, because the merge discards the whole blob when one field fails to parse.

Does `hunk` call zustand's `persist(` without building its options with `persistConfig(...)`, or add an enum, union or literal field to a schema passed to `persistConfig({ schema })` without `.default(X).catch(X)` (or, for collections, the tolerant helpers in `app/shared/lib/persist/tolerant.ts`)?

Allowed cases: `createQueryCacheStore`, which owns its own envelope; the e2e runtime; a field whose invalid value must reject the blob and is covered by a `version` bump and `migrate`; enums derived from the unit registry that keep `.default().catch()`.

## state/zustand-v5

Scope: `repository-wide`

Zustand 4 APIs that version 5 removed fail at runtime here, not just in review.

Does `hunk` pass a second (equality) argument to a hook made by `create`, import `zustand/traditional`, `createWithEqualityFn` or a default export from `zustand` (none can work here: `use-sync-external-store` is not installed), or call `store.subscribe(selector, listener)` on a store that is not wrapped in `subscribeWithSelector` (the listener never runs)?

Allowed cases: `useShallow` around the selector; `subscribe(listener)` with a single argument; stores created with `subscribeWithSelector`.

## motion/thread-hop

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Work crosses between the UI and JS threads explicitly, with the current worklets API.

Does a worklet in `hunk` — a gesture callback, `useAnimatedStyle`, `useDerivedValue`, `useAnimatedReaction`, `useAnimatedScrollHandler`, `useFrameCallback` or an animation completion callback — call a plain JS function directly (a state setter, `router.*`, a store action, haptics, an imported helper with no `'worklet'` directive), pass `scheduleOnRN` a function literal created inside the worklet, or ADD a new `runOnJS(fn)(…)` / `runOnUI(fn)(…)` call (deprecated in Reanimated 4; use `scheduleOnRN(fn, …args)` / `scheduleOnUI`)?

Allowed cases: `scheduleOnRN` / `scheduleOnUI` with a function defined at component or module scope, or with an identifier whose definition is not visible inside the worklet; functions marked `'worklet'` — the body begins with the directive, even when it is wrapped in `useCallback` or `useMemo`; the Gesture Handler builder option `.runOnJS(true)`, which is a different API; existing `runOnJS` calls the hunk does not add.

## motion/per-frame-js

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Nothing re-renders React or crosses to the JS thread once per frame.

Does `hunk` call `scheduleOnRN`, `runOnJS` or a React state setter on every frame — inside `.onUpdate`, `.onChange`, `useAnimatedScrollHandler`, `useFrameCallback` or `useAnimatedStyle` — with no threshold or change guard, or keep a per-frame value (scroll offset, drag translation) in `useState` instead of a shared value?

Allowed cases: The hop happens in `.onEnd` / `.onFinalize`; a `useAnimatedReaction` whose prepare returns a boolean or bucket and whose react runs only when `current !== previous`; a guard that fires once per threshold crossing; list or media offset bookkeeping that the header contract names.

## motion/shared-value-access

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Shared values are read and written with `.get()` / `.set()`, and never during render.

Does component, hook or worklet source code in `hunk` add a read or write of a Reanimated shared value — something returned by `useSharedValue`, `useDerivedValue` or `makeMutable`, or typed `SharedValue<…>` — through `.value` (including `+=`) rather than `.get()` / `.set()`, which the React Compiler requires, or read or write such a shared value in a component or hook body during render instead of inside a worklet, effect, handler or animation callback?

Allowed cases: `.value`, `.current`, `.get()` or `.set()` on things that are not Reanimated shared values (events, React refs, a `Map`, a store or storage adapter, form state, query results); `.get()` / `.set()` inside worklets, effects, handlers and callbacks; a test that reads `.value` only to assert on it, since test code is not compiled by the React Compiler; files listed in `react-compiler-bailouts.json`; existing `.value` access the hunk does not add.

## motion/reanimated-4-config

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Reanimated 4 rejects or ignores configuration shapes that version 3 accepted.

Does `hunk` pass a raw `'cubic-bezier(…)'` or `'steps(…)'` string or an `Easing.*` value to `transitionTimingFunction` / `animationTimingFunction` (throws; use `cubicBezier()`, `steps()`, `linear()` from Reanimated), give `withSpring` both the physics form (`stiffness`, `damping`, `mass`) and the duration form (`duration`, `dampingRatio`), use `restDisplacementThreshold` / `restSpeedThreshold` (removed; `energyThreshold`), or use — imported from or accessed on `react-native-reanimated` — `useAnimatedGestureHandler`, `useWorkletCallback`, the `Layout` transition, `useAnimatedKeyboard`, `useScrollViewOffset` or `sharedTransitionTag`?

Allowed cases: Named timing-function strings (`'ease-in-out'`); one spring form at a time; `LinearTransition` and the other named layout transitions; `react-native-keyboard-controller` for keyboard tracking; a function or hook this codebase declares itself that merely shares a removed export's name and is built on current APIs.

## motion/gesture-handoff

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

A gesture hands its velocity to the animation that follows it and does not fight the scroller it sits in.

Does `hunk` add a `Gesture.Pan()` inside a scrollable or list with no `activeOffsetX` / `activeOffsetY`, `failOffset*` or relation to the scroll gesture, write `translationX` / `translationY` without adding the offset captured at `.onStart` / `.onBegin`, decide dismiss or commit on distance alone when the event's velocity is available, or start the release `withSpring` without `velocity`?

Allowed cases: A pan that owns the whole screen with no scroller beneath it; a release that snaps with `withTiming` by design and says so; gestures whose end state does not depend on the fling (sliders that stop where released).

## motion/list-rows

Scope: `**/*.tsx`

Recycled list rows do not replay entering animations or lose their layout type.

Does `hunk` put `entering=` or `exiting=` on a row rendered by FlashList, FlatList or the shared `List` (recycling replays it while scrolling), or render visibly different row layouts from one `renderItem` without `getItemType`?

Allowed cases: An entering animation gated to the first mount of a newly inserted item; rows of a small non-virtualized list; lists whose rows share one layout.

## rn/numeric-and

Scope: `**/*.tsx`

`{count && <View/>}` renders the number when it is zero, and a bare number outside `<Text>` crashes on native.

Does `hunk` add JSX of the form `{x && <Component … />}` where `x` is or can be a number (`count`, `length`, `amount`, `balance`, `index`, a `?.length`), so that `0` or `NaN` is rendered as a text node?

Allowed cases: `x` is a boolean, a string, an object or `null`/`undefined`; the condition is a comparison (`count > 0 && …`), `!!x`, `Boolean(x)` or a ternary.

## ui/glass-surfaces

Scope: `**/*.tsx`

Glass effects have rendering constraints that fail silently.

Does `hunk` set `overflow: 'hidden'` on a `GlassView` or an ancestor that clips it, animate the opacity of a glass view, set `isInteractive` on glass that is not itself a control, or render glass without an availability check and a Reduce Transparency fallback?

Allowed cases: The capability hook or `defineVariants` chose the glass variant and supplies the fallback; opacity animated on a sibling or child rather than the glass view; clipping applied to content inside the glass.

## ui/keyboard-tracking

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Keyboard movement comes from `react-native-keyboard-controller`, and taps reach controls while the keyboard is open.

Does `hunk` track keyboard position with `Keyboard.addListener` plus a timing animation or `LayoutAnimation`, or add a scrollable form or search-results list whose rows are tappable while an input is focused without `keyboardShouldPersistTaps="handled"`?

Allowed cases: `react-native-keyboard-controller` hooks and views; `Keyboard.dismiss()`; listeners used for non-layout behaviour (analytics, focus bookkeeping); scrollers with no focusable input above them.

## tests/assert-outcomes

Scope: `**/__tests__/**/*.{ts,tsx}`, `**/*.test.{ts,tsx}`

A test states the expected outcome as a literal and reaches the code through its public interface.

Does a new or changed test in `hunk` make only expectations that carry no expected value (a bare `toHaveBeenCalled()` on a collaborator this codebase owns, `toBeDefined()`, `toBeTruthy()` on a plain value) with nothing comparing a returned value, a rendered element, exact call arguments, an exact call count or a deliberate not-called; produce the expected side of an assertion from the code under test itself on the same input, a helper the implementation calls, a constant imported from the implementation or a line-for-line copy of its formula, so that a bug would change both sides equally; or `jest.mock` / `vi.mock` a module this repository owns (`@/…`, `wallet`, `nostr`) that holds deterministic plain logic — a pure function, parser, mapper, formatter or state machine — whose real output would otherwise flow into the behaviour under test?

Allowed cases: Mocks of system boundaries (network and the repo's network clients such as `apiClient`, native modules, SecureStore, AsyncStorage, time, randomness, the logger); an owned module whose only job is to produce a non-deterministic value (an id, clock or random helper), which is the time and randomness boundary; a store, hook or provider mocked to keep a component render test off the wallet, coco or native runtime; a call assertion that IS the contract (an adapter must call the native module once, a guard must not call the network); `toHaveBeenCalledWith(exact arguments)`, `toHaveBeenCalledTimes(n)` and `.not.toHaveBeenCalled()`, which are concrete expectations; a Testing Library `getBy*` query inside `expect(...).toBeTruthy()`, which throws when the element is missing; expected values that are literals or fixtures independent of the implementation; an independent oracle that could disagree (a naive reference model in a property test, a different library, a differently structured derivation); invariance, round-trip or metamorphic assertions comparing two runs or two inputs; a relation between several outputs stated as a law; the function under test used only to build a later step's input; a generated artifact compared to its canonical source file; mocks of heavy UI primitives in a render test of something else; a stub that only cuts an import graph, where the mocked function is never reached by the tested paths and no assertion depends on it; existing mocks the hunk does not add.
