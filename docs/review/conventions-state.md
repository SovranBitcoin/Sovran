# State, persistence and React

Rules for Zustand 5 stores, persisted-store hydration, and React 19 with the React Compiler. Same format and standing as the [contributor conventions](contributor-conventions.md): human and agent guidance that Hunch compiles into review questions. Every rule here was reproduced against the installed package versions before it was accepted; when a dependency is upgraded, re-check the rules that name its behaviour.

## persist/hydration-gate

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Persisted stores hydrate asynchronously here (AsyncStorage behind the migration gate), so until `persist.hasHydrated()` is true every read returns the in-code default, not the user's data.

Does `hunk` take an irreversible or user-visible decision — a redirect or `router.*` call, showing a terms, onboarding, backup or CTA prompt, starting a network request, or publishing — from the value of a persisted Zustand store inside an effect or at mount, with no check of that store's `persist.hasHydrated()` / `onFinishHydration`, a `_hasHydrated` field, or an ancestor gate that the hunk shows?

Allowed cases: The component renders below a gate that already waits for that store (`AppGate` for `settingsStore`, `ThemeProvider` for wallpaper/theme, `CtaHost`, `useWalletLifecycleHydrated`); the hook follows the house pattern `useState(() => store.persist.hasHydrated())` + `onFinishHydration` + re-check; purely presentational reads where showing the default for a frame is harmless (theme, sort order, toggles); non-persisted runtime stores; `createQueryCacheStore` reads, whose `hydrate(key)` is awaited explicitly.

## persist/early-write

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`, `**/providers/**/*.tsx`, `**/migrations/**/*.ts`

A write to a persisted store before hydration finishes is overwritten in memory by the rehydrate merge, while the defaults-plus-write snapshot is what lands on disk, so memory and storage diverge and the next launch loads the clobbered blob.

Does `hunk` call an action or `setState` of a persisted Zustand store from module scope, a store initialiser, app bootstrap, a migration or a mount effect, where nothing in the hunk shows that hydration has finished (`persist.hasHydrated()`, `onFinishHydration`, `afterHydrate`, an awaited hydration helper)?

Allowed cases: Writes made in response to a user action on a screen rendered below the hydration gate; writes inside `afterHydrate` / `onFinishHydration` callbacks; writes wrapped in `withSkippedPersistWrites`; stores without `persist`; helpers that await hydration first (`whenHydrated` in `shared/lib/migrations/dataMigrations.ts`, `refreshVertex`).

## persist/after-hydrate

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

`afterHydrate` / `onRehydrateStorage` is an observer: if it throws, zustand calls it a second time with the error, `hasHydrated()` stays false forever and every gate waiting on `onFinishHydration` hangs; if it mutates `state` in place, synchronous subscribers are never notified.

Does `hunk` add or change an `afterHydrate` or `onRehydrateStorage` callback so that it (a) assigns to a property of its `state` argument (`state.x = …`, `state.list.push(…)`) instead of calling the store's `setState`, or (b) performs work that can throw — parsing, decoding, indexing untrusted persisted data, calling another store or a native module — outside a try/catch?

Allowed cases: Callbacks that only log, set a hydration flag with `useXStore.setState({ _hasHydrated: true })`, or start a promise that carries its own `.catch`; throwing work wrapped in try/catch that logs and continues; derived indexes rebuilt with `setState`.

## persist/nested-defaults

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

The persist merge (`{ ...current, ...parsed }`) is shallow, so a key added inside an already-persisted nested object never reaches existing users: their stored object replaces the new default wholesale, or the blob is rejected if the schema requires the key.

Does `hunk` add a new key inside a nested object (or to the element shape of a persisted array or record) that is part of a persisted store's state, without giving that key a `.default(…)` (or `.optional()` with a handled `undefined`) in the schema passed to `persistConfig`, and without a `version` bump plus `migrate` that fills it?

Allowed cases: New TOP-LEVEL persisted fields (the shallow merge keeps their in-code default) whose schema entry is optional or defaulted; nested keys declared with `.default()` / `.catch()` or the tolerant helpers; stores with a deep-merging `merge`; non-persisted fields left out of `partialize`.

## persist/json-roundtrip

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

Persisted state goes through `JSON.stringify`/`JSON.parse`: `Map` and `Set` come back as `{}`, `Date` as a string, `Uint8Array` as an index-keyed object, `NaN`/`Infinity` as `null`, `undefined` keys vanish, and a single `bigint` makes every `set` throw so nothing is ever saved.

Does `hunk` add to the state returned by a persisted store's `partialize` (or to a `createQueryCacheStore` entry) a field whose type is or contains `Map`, `Set`, `Date`, `bigint`, a typed array or `ArrayBuffer`, or a number that can be `NaN`/`Infinity`, or rely on a persisted key being present with the value `undefined`?

Allowed cases: The field is stored in a JSON-native form (`Record`, array, epoch-ms number, decimal or hex string) and converted at the edge; the schema explicitly transforms on parse AND `partialize` serialises on write; the field is excluded from `partialize`; runtime-only stores (`rollbackStore`'s `Set`s are fine — it is not persisted).

## persist/migrate-total

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

`migrate` runs once with the STORED version (it is not chained), its return value replaces the persisted state, and the result is written straight back to disk — so a missing return path or a dropped field silently turns user data into defaults, permanently; TypeScript does not flag a `migrate` that can return `undefined`.

Does `hunk` add or change a `migrate` function so that (a) some incoming version reaches the end with no `return` (for example only `if (version === N) return …`), (b) a branch builds its result from scratch or from a subset (`return { theme: old.theme }`) instead of spreading the incoming state, (c) steps compare with `===` rather than cumulative `if (version < N)`, so a user two versions behind skips a step, or (d) it can throw on malformed input?

Allowed cases: Cumulative `if (version < N) s = stepN(s)` chains that end in `return s`; branches that spread the incoming state and override fields (`{ ...persisted, mockMode: false }`); deliberately dropping a field, with a comment saying so; defensive parsing that returns the input unchanged on failure so the schema `merge` decides.

## persist/rehydrate-reset

Scope: `repository-wide`

`persist.rehydrate()` merges storage over the store's CURRENT state, not its initial state; when the new storage key has no blob (a fresh profile) the previous profile's data stays in memory and the next write saves it under the new profile's key.

Does `hunk` call `persist.rehydrate()` on a store whose storage key or contents can differ from what is in memory — after a profile switch, account change, storage swap (`persist.setOptions({ storage })`) or `clearStorage()` — without first replacing the state with `store.getInitialState()` (`setState(store.getInitialState(), true)`)?

Allowed cases: `rehydrate()` used only to retry or await the first hydration of the same key (`if (!store.persist.hasHydrated()) await store.persist.rehydrate()`, the `AppGate` settings retry); tests that build a fresh store; flows that restart the JS runtime instead of switching in process.

## persist/partialize-allowlist

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

`partialize` names what is saved; a deny-list saves every field anyone adds later — session tokens, errors, controllers — to unencrypted AsyncStorage without the author ever touching the persist config.

Does `hunk` write a `partialize` that returns the state minus some fields — rest destructuring (`({ isLoading, ...rest }) => rest`), `omit(state, […])`, `Object.fromEntries(Object.entries(state).filter(…))`, or `(state) => state` — instead of an object literal that lists each persisted field?

Allowed cases: An object literal naming every persisted field (all 56 existing `partialize` calls do this); a nested pick built the same way.

## persist/write-amplification

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

Persist re-serialises and rewrites the whole partialized blob on EVERY `set`, including sets that touch only fields `partialize` leaves out, so a fast-changing runtime field or an ever-growing collection in a persisted store costs a full `JSON.stringify` and storage write per update on the JS thread.

Does `hunk` add to a store wrapped in `persist` (a) a field updated at high frequency — download or upload progress, scroll or drag position, a timer tick, typing drafts, streaming tokens, per-event counters — or (b) an action that appends to a persisted array or record with no cap, TTL or eviction?

Allowed cases: The fast field lives in a separate non-persisted store under `stores/runtime`; collections bounded by a constant cap, TTL prune or LRU in the same action; `createQueryCacheStore`, which owns eviction; fields that change only on explicit user actions.

## persist/subscriber-hydration

Scope: `repository-wide`

Hydration is delivered to `store.subscribe` listeners as an ordinary state change, so a listener that reacts to "the user changed X" also fires when X is merely loaded from disk.

Does `hunk` subscribe to a persisted store (`useXStore.subscribe(…)`) with a listener that performs an outward side effect — publishing a Nostr event, a network write, a wallet or mint call, writing another storage key, showing a notification — without ignoring changes that arrive before `persist.hasHydrated()` is true?

Allowed cases: The listener returns early while `!store.persist.hasHydrated()`; the subscription is created inside `onFinishHydration` / `afterHydrate`; listeners that only mirror state into an in-memory adapter or notify React (`transactionAnnotationAdapter.subscribe`, screen-action bridges); non-persisted stores.

## async/set-after-await

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`, `**/hooks/**/*.ts`, `**/use*.ts`, `**/*.tsx`

State read before an `await` is a snapshot; writing a value computed from it after the `await` silently discards every update that landed in between (`get()` is only fresh at the moment it is called).

Does `hunk` read store state into a local (`const { items } = get()`, `const s = useXStore.getState()`, a selector value captured by a callback) BEFORE an `await`, and AFTER that `await` write a value derived from the local (`set({ items: [...items, x] })`, `setState({ byId: { ...byId, [k]: v } })`, `count: count + 1`)?

Allowed cases: The post-await write uses the updater form (`set((s) => ({ items: [...s.items, x] }))`) or re-reads `get()` after the last `await`; the pre-await local is only used to build the request, to compare afterwards (an owner or generation check) or for logging; the write is a keyed overwrite that does not depend on the old value (`set((s) => ({ byKey: { ...s.byKey, [key]: result } }))`); synchronous `set({ n: get().n + 1 })`, which is NOT stale.

## state/subscribe-listener

Scope: `repository-wide`

A plain `store.subscribe(listener)` fires on every `set` in the store — including sets of identical values — and a `subscribeWithSelector` subscription whose selector builds a new object or array fires on every unrelated change too; neither delivers the current value unless asked.

Does `hunk` add (a) `store.subscribe((state, prev) => …)` whose listener does work without first comparing the slice it cares about (`state.x !== prev.x`), (b) `store.subscribe(selector, listener)` where the selector returns a new object, array or function (`s => ({ a: s.a })`, `s => s.list.filter(…)`) with no `equalityFn`, or (c) a selector subscription whose listener must also run for the value already in the store, with no `fireImmediately: true` and no explicit initial call?

Allowed cases: Listeners that compare against `prev` before acting; selectors returning a primitive or an existing reference; `{ equalityFn: shallow }` for multi-field picks; `fireImmediately: true` or an explicit first call after subscribing; listeners that are idempotent and cheap by design (forwarding to `useSyncExternalStore`'s callback).

## state/useshallow-depth

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

`useShallow` compares one level with `Object.is`; if any member of the selected object or array is itself created inside the selector, every comparison fails and the component crashes at mount with "Maximum update depth exceeded".

Does `hunk` wrap in `useShallow` a selector whose result, once any spreads are applied, has at least one own member that is itself created inside the selector — a nested object or array literal (`s => ({ user: { name: s.name } })`), an inline function (`{ onX: () => … }`), a `.map` that builds new objects (`s.items.map(i => ({ ...i }))`), `Object.entries`/`Object.values` of nested records, or a `?? []` / `?? {}` fallback inside the literal?

Allowed cases: Members that are primitives or existing references from state (`{ a: s.a, list: s.list }`); `.map` to primitives (`s.items.map(i => i.id)`); `.filter` over existing element references; `new Map(s.map)` / `new Set(…)` of primitives; module-level constant fallbacks; a helper result spread into the returned object when the fields it contributes are primitives (`...counts(s.legs)` contributing `settled` and `total` numbers); `useShallow` around a primitive selector is a harmless no-op and needs no comment.

## state/pure-selectors

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

A selector re-runs only when the store changes and must return the same result for the same state: reading the clock in it gives a value that never updates, a random or fresh value loops forever, and sorting in place mutates store state without notifying anyone.

Does `hunk` pass to a Zustand hook a selector that calls `Date.now()`, `new Date()`, `Math.random()` or an id generator, calls an in-place array method on state (`s.list.sort(…)`, `.reverse()`, `.splice(…)`), or performs a side effect (a `set`, a log, a fetch)?

Allowed cases: Selectors that are pure functions of `state` and closed-over props; time-dependent derivations computed outside the selector from a selected timestamp and a `nowMs` that a ticking hook or effect provides; sorting a copy outside the selector (`[...list].sort(…)`) in a render-time or memoized derivation.

## state/getter-in-render

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Selecting a function from a store and calling it during render subscribes the component to the function's identity, which never changes — not to the data it reads through `get()` — and the React Compiler then caches the call, so the value is frozen for the life of the component.

Does `hunk` select a store function that reads state (`getTotal`, `isStale`, `has…`, `get…`, `find…`, `can…`) with a Zustand hook and call it in a component or hook body during render — directly, in JSX, or inside `useMemo` — to produce a displayed or branching value?

Allowed cases: Calling the selected function inside an event handler, effect or async callback; selecting the VALUE instead (`useStore(s => s.getTotal())` when it returns a primitive, or selecting the underlying fields and deriving in render); store functions that are true actions (they `set`, return nothing); non-React modules using `getState()`.

## state/store-in-component

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

`create` / `createStore` (and factories built on them, such as `createQueryCacheStore`) called in a component or hook body build a new store on every render, so state written to it is lost on the next render.

Does `hunk` call `create(`, `createStore(` or a store factory inside a component or hook body without holding the instance in `useState(() => …)` (or a lazily-initialised ref)?

Allowed cases: Module-scope stores; `const [store] = useState(() => createStore(…))` read with `useStore(store, selector)`; stores created in a provider and passed through context; tests.

## state/init-cross-store

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

A store initialiser runs once at module evaluation, before any persisted store has hydrated and possibly before the other module has finished loading: a value copied from another store there is that store's in-code default forever, and with an import cycle it is a `TypeError` at startup.

Does `hunk` read another store (`useOtherStore.getState()`, a value exported from another store module) inside the object returned by a `create` / `createStore` initialiser — as a field's initial value or in any code that runs at module scope — rather than inside an action, selector or subscription?

Allowed cases: Reads inside actions and other functions that run later; subscriptions set up after `onFinishHydration`; constants imported from non-store modules; a store reading its own `get()`.

## state/record-keys

Scope: `**/stores/**/*.{ts,tsx}`, `**/*[Ss]tore.{ts,tsx}`, `**/persist/**/*.ts`, `**/{cache,caches}/**/*.ts`, `**/*[Cc]ache.ts`

A plain-object record inherits from `Object.prototype`, so for keys an attacker or a relay controls, `record[key]` and `key in record` report `constructor`, `toString` and `__proto__` as present, and `record[key] = v` with `__proto__` rewrites the prototype instead of storing an entry.

Does `hunk` key a plain-object `Record` by a string that comes from outside the app unvalidated — relay tags, hashtags, emoji shortcodes, NIP-05 names, memo text, URL path or query parts, QR or deep-link fields — and test membership with `key in record`, a truthy `record[key]`, or write with direct assignment `record[key] = value`?

Allowed cases: Keys validated to a fixed alphabet before use (64-hex pubkeys and event ids, schema-parsed mint URLs, keys with an app-controlled prefix such as `quote:` / `id:`); `Object.hasOwn(record, key)`; `Map`; `Object.create(null)`; immutable writes with a computed key in a spread (`{ ...rec, [key]: v }` defines an own property) when reads use `Object.hasOwn`.

## async/inflight-map

Scope: `repository-wide`

A module-level in-flight dedupe map must drop its entry when the promise settles — on rejection too — and only if the entry is still its own; otherwise a failed request is served from the map forever, or an old request's cleanup evicts a newer one and breaks the dedupe.

Does `hunk` store a promise in a module-level or store-level `Map`/record for request dedupe and (a) delete the entry only on the success path (`.then(v => { map.delete(k) … })`, a `delete` after `await` with no `finally`), or (b) delete in `finally`/`catch` without checking the entry is still this promise (`if (map.get(k) === p) map.delete(k)`) when the hunk also shows the map being cleared, invalidated or overwritten elsewhere, or (c) let a caller with different arguments, profile, mint or unit join a running call because the slot or key leaves that input out?

Allowed cases: `finally` cleanup with an identity or generation check (the `createQueryCacheStore` pattern); maps never cleared or overwritten, where an unconditional `finally` delete is safe; a single slot for work that takes no arguments, or whose joined callers re-evaluate their own inputs after it settles (`mintTestnutRefresh`); state held per manager or profile (`WeakMap<Manager, …>`); caches of settled VALUES (not promises) with their own TTL.

## react/derived-state-effect

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

An effect that only computes state from props or other state commits one frame in which the new input is paired with the old derived value — a new recipient shown with the previous recipient's amount — and then renders again; compute it during render, or reset with `key`.

Does `hunk` add a `useEffect` / `useLayoutEffect` whose body does nothing but call state setters with values computed from its dependencies or constants (`useEffect(() => { setFull(a + b) }, [a, b])`, `useEffect(() => { setAmount('0'); setError(null) }, [contactId])`), with no subscription, async work, imperative call or cleanup?

Allowed cases: Deriving during render (`const full = a + b`); resetting by giving the component a `key` tied to the identity; effects that synchronise with something external (subscriptions, timers, native modules, animations, store hydration flags) and set state from its callback; the guarded set-state-during-render pattern for a previous-prop comparison; resetting a load status for a new media URL where a one-frame stale status is invisible, with a comment saying so.

## react/state-mirrors-prop

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

`useState(x)` reads `x` on the first render only; when `x` is a prop, a route param or a store value that can change while the component stays mounted, the UI keeps showing the first value.

Does `hunk` initialise state from a prop, a `useLocalSearchParams` / `useGlobalSearchParams` value or a store-selected value (`useState(props.balance)`, `useState(unitParam)`, `useState(selectedMint)`) and then display or act on that state as if it tracked the source, with no `key` on the component tied to the source and no handler that owns all further changes?

Allowed cases: Editable drafts deliberately seeded once (`initialDraft`, names starting with `initial` / `default`), which the user then owns; components remounted per identity through `key` or a separate route instance; the `state ?? prop` fallback pattern where `undefined` state means "follow the prop"; values that cannot change for the lifetime of the mount.

## react/effect-as-handler

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Work the user triggered belongs in the event handler: routed through a state flag and an effect, it runs again whenever any other dependency of that effect changes, which for a payment or publish is a duplicate side effect.

Does `hunk` perform a payment, send, publish, mint or melt call, navigation, toast or other one-shot side effect inside a `useEffect` whose trigger is a state flag that a handler sets (`submitted`, `shouldSend`, `confirmed`, `pending…`), where the effect's dependency list contains anything besides that flag?

Allowed cases: The side effect is called directly from the handler; effects that react to something the user did not trigger (a store or machine entering a state, a deep link arriving, a subscription event); effects guarded by a single-flight ref or a state-machine phase that the hunk shows being consumed before the call; navigation in response to an external state change.

## react/subscribe-recheck

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

A value read during render and subscribed to later in an effect can change in between — hydration finishing, a native event, another component's layout effect — and that change is missed forever unless the effect re-reads after subscribing.

Does `hunk` seed `useState` from an external source (a store's `persist.hasHydrated()`, `AppState.currentState`, a module-level emitter's `get()`, NetInfo, a native module value) and subscribe to it in an effect that only sets state from the change callback, without re-reading the current value inside the effect after the subscription is attached, and without `useSyncExternalStore`?

Allowed cases: `useSyncExternalStore(subscribe, getSnapshot)`; the house pattern that re-checks after subscribing (`const un = store.persist.onFinishHydration(() => setHydrated(true)); if (store.persist.hasHydrated()) setHydrated(true);`); Zustand hooks, which already do this; sources that replay their current value to new subscribers.

## react/render-mutation

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

The React Compiler compiles a component that mutates a prop or a store-selected value in place without any diagnostic, so `.sort()` on such an array silently reorders the caller's data or the store's state with no subscriber notified.

Does `hunk` call an in-place mutator during render — `.sort(`, `.reverse(`, `.splice(`, `.push(`, `.pop(`, `.shift(`, `.unshift(`, `.fill(`, `delete obj.k`, `obj.k = v`, `Object.assign(target, …)` — on a prop, a value returned by a Zustand or context hook, a route param, or anything reached through one of them?

Allowed cases: Mutating an array or object created in the same render (`[...items].sort()`, `items.filter(…).sort(…)`, `items.map(…).reverse()`, an array literal, `Object.values(rec).sort(…)`); non-mutating copies (`toSorted` / `toReversed` only once Hermes support is confirmed — the app has 0 uses today); mutation inside event handlers and effects of values the component owns; Reanimated shared values via `.set()`.

## react/render-clock

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

Render is not re-run when time passes, and the React Compiler may cache a clock or random read so that it never changes even when the component does re-render; a render-time `Date.now()` therefore shows "not expired", "just now" or a countdown that is wrong and stays wrong.

Does `hunk` read `Date.now()`, `new Date()`, `performance.now()` or `Math.random()` directly in a component or hook body during render (outside any handler, effect, `useState` initialiser or callback) and use the result for displayed or branching output such as expiry, staleness, relative time, a countdown or a generated id?

Allowed cases: Reads inside handlers, effects, callbacks and lazy `useState(() => …)` initialisers; a `nowMs` state advanced by a timer that stops when off-screen (see `perf/offscreen`); values used only for a one-off computation whose staleness cannot be observed (a chart's current month, a log timestamp); files listed in `react-compiler-bailouts.json` are not exempt — the value still never updates on its own.

## react/external-store-snapshot

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

`useSyncExternalStore` compares snapshots with `Object.is` on every render; a `getSnapshot` that builds its result crashes the component with "Maximum update depth exceeded" (React logs "The result of getSnapshot should be cached").

Does `hunk` pass to `useSyncExternalStore` a `getSnapshot` that returns a new object, array or function on each call — an object literal, a spread, `.filter` / `.map` / `.slice` / `Object.values(…)`, or a `?? []` / `?? {}` fallback?

Allowed cases: Snapshots that return a primitive or the same stored reference until the source changes (the module keeps the derived value and replaces it only in its own setter, as `getCarouselPages` and `getActionMenuSnapshot` do); module-level constant fallbacks.

## react/use-promise-in-render

Scope: `**/*.tsx`, `**/hooks/**/*.ts`, `**/use*.ts`

`use(promise)` needs the SAME promise on every render of the suspended component; a promise created during render is recreated on each retry, so the component starts a new request every time, never resolves and stays on the Suspense fallback — with or without the React Compiler.

Does `hunk` call `use(` with a promise created in the same component render — a direct call (`use(fetchThing(id))`), an `async` function invocation, `new Promise(…)`, or a `.then(…)` chain built in the body?

Allowed cases: Promises created outside render and passed in as a prop or read from a cache keyed by the inputs (a module-level map, `createQueryCacheStore`, a loader); `use(Context)`; promises held in `useState(() => …)` of a PARENT of the suspending component.

## react/context-churn

Scope: `**/*.tsx`

Every consumer of a context re-renders when any part of its value changes — the React Compiler stabilises the value object but cannot split it — so one fast-changing field makes every reader of the slow fields re-render at that rate.

Does `hunk` add a frequently-changing value (scroll or drag position, progress, a timer tick, text-input contents, a per-frame or per-event counter, streaming text) to the `value` of a context that also carries slow-changing data or is consumed by many components?

Allowed cases: The fast value lives in a Zustand store read through a selector, a Reanimated shared value, or its own narrowly-consumed context; contexts whose whole value changes together and rarely; contexts that carry only stable functions and refs.
