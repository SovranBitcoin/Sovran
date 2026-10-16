# Multi-account architecture: what primary sources recommend, and how Sovran compares

Research note, 2026-10-09. Scope: whether the account design described in
[`docs/architecture/account-lifecycle.md`](../architecture/account-lifecycle.md), ADR 0029 and
ADR 0030 is sound, judged against library documentation, library source and the source of real
multi-account apps.

Primary sources only. A claim that could not be tied to one is marked **(not verified)**; a
conclusion of mine that no source states is marked **(inference)**. Snapshots consulted:

| Source | Revision |
| --- | --- |
| zustand | installed `5.0.15` (`node_modules/zustand`), docs at tag [`v5.0.15`](https://github.com/pmndrs/zustand/tree/v5.0.15/docs) |
| React docs | `reactjs/react.dev` main `046f17d042` |
| React Navigation docs | `react-navigation/react-navigation.github.io` main, `versioned_docs/version-7.x` |
| Expo | installed `expo` 56.0.20, `expo-router` 56.2.11, `expo-sqlite` 56.0.5, `expo-secure-store` 56.0.4; docs `expo/expo` main, `docs/pages/versions/v56.0.0` |
| AsyncStorage | installed `2.2.0`; docs `react-native-async-storage/async-storage` main (v3) |
| Bluesky | `bluesky-social/social-app` main `8b0e6a067e` (2026-10-09) |
| Element X Android | `element-hq/element-x-android` develop `f12b9c77d5` (2026-10-09) |
| Amethyst | `vitorpamplona/amethyst` main `27df24621a` (2026-10-09) |
| MetaMask | `MetaMask/core` main `d4070216ba` (2026-10-09), `accounts-controller` only |
| Zeus | local checkout `ZeusLN/zeus` `f05a22d60` (2026-09-29) |
| Cashu wallets | local checkouts: `cashu.me` `4abd268`, `minibits_wallet` `a96b22b`, `eNuts` `e61f5c5`, `macadamia` `47f4726`, `numo` `45d7cfb5`, `coco` `5fbb66cd` |

## Short answer

The design is sound and does not need restructuring. Its in-process switch is the pattern zustand's
own documentation gives for resetting module stores, taken further than the documentation or any
comparable app takes it: required scope declarations, a generated manifest, a lint rule, a write
barrier and a restart on any failure. It differs in kind from Bluesky, Element X and Amethyst, which
build account state inside a per-account container and throw the container away, so they have
little or nothing to enumerate. That difference is a maintenance cost, not a correctness defect,
and the default switch (restart the runtime) is stronger isolation than anything the comparable
apps do. The one change the evidence supports is directional: put new account-owned state inside
the account provider tree rather than adding to the registry.

## What the sources say

### 1. zustand

**Resetting.** The "How to reset state" guide gives two patterns. One store:
`set(store.getInitialState())`. Many stores: wrap `create`, collect a reset function per store in a
module-level `Set`, and reset them all with `store.setState(store.getInitialState(), true)`
([`docs/learn/guides/how-to-reset-state.md` L6-L40](https://github.com/pmndrs/zustand/blob/v5.0.15/docs/learn/guides/how-to-reset-state.md?plain=1#L6-L40)).
`getInitialState` is part of the vanilla store API and returns the value the initializer produced
(`node_modules/zustand/esm/vanilla.mjs` L13, L19). The guide does not mention users, accounts or
persistence.

**A store is module state by default; a store per instance needs a context.** The Next.js guide
says "Zustand store is a global variable (AKA module state) making it optional to use a `Context`",
and that "in order to reset a store, we need to initialize it at the component level using a
`Context`"
([`docs/learn/guides/nextjs.md` L11-L12, L22-L24](https://github.com/pmndrs/zustand/blob/v5.0.15/docs/learn/guides/nextjs.md?plain=1#L11-L24)).
Its "No global stores" recommendation is scoped to servers: "Because the store should not be shared
across requests" (L31-L32). The "Initialize state with props" guide says that where dependency
injection is needed "the recommended approach is to use a vanilla store with React.context", built
with `createStore`, held in `useState(() => createBearStore())` and read with `useStore(store, selector)`
([`docs/learn/guides/initialize-state-with-props.md` L6-L69](https://github.com/pmndrs/zustand/blob/v5.0.15/docs/learn/guides/initialize-state-with-props.md?plain=1#L6-L69)).
Neither guide names multi-user or multi-tenant state as the use case. Reading them as guidance for
account scoping is an **inference**.

**`persist`.** From
[`docs/reference/integrations/persisting-store-data.md`](https://github.com/pmndrs/zustand/blob/v5.0.15/docs/reference/integrations/persisting-store-data.md?plain=1)
and the installed source `node_modules/zustand/esm/middleware.mjs`:

- `name` "is going to be the key used to store your Zustand state in the storage, so it must be
  unique" (doc L65-L70). The docs do not describe a per-user key.
- `setOptions` "Changes the middleware options"; the doc example changes the storage name (doc
  L352-L365). In source it merges options and swaps `storage` if one is given (L441-L449). It does
  not rehydrate, and it does not touch in-memory state.
- `skipHydration` leaves the first hydration to a manual `rehydrate()` (doc L288-L300; source L470).
- `rehydrate` is documented as `() => Promise<void>` (doc L385-L394). In source it increments a
  hydration generation, sets `hasHydrated = false`, reads the item, and **merges the stored value
  into whatever `get()` currently returns** before replacing the state (L383-L421). So a rehydrate
  under a new key without a reset first merges the new account's blob over the old account's
  memory. A stale hydration is discarded by the generation check (L413, L426, L434).
- A storage read that rejects is caught, passed to the `onRehydrateStorage` callback, and leaves
  `hasHydrated` false; the promise returned by `rehydrate()` still resolves (L433-L438). The doc's
  `hasHydrated` entry says only that it is "a non-reactive getter" that "updates when calling
  `rehydrate`" (doc L396-L406). It does not say a failed read resolves.
- Every `setState`, including a reset, writes to storage: the middleware replaces `api.setState`
  with a version that calls `setItem()` afterwards (L365-L369). The docs do not state this.
- With asynchronous storage "the store will be hydrated later on, in a microtask", and an app that
  depends on persisted values "might want to wait until the store has been hydrated before showing
  anything" (doc L474-L509).

**Maintainer statements.** In discussion
[#574 "Clear/Reset State After User Sign Out"](https://github.com/pmndrs/zustand/discussions/574)
the accepted answer from dai-shi is "keep the initial state (excluding functions) and overwrite?";
he later suggests a higher-order `resettable` wrapper collecting reset functions, and, asked about
persisted stores, "I'm not sure, but the rehydrate api might help?". In
[#2909](https://github.com/pmndrs/zustand/discussions/2909), where a user keys `persist` by
organisation, maintainer dbritto-dev suggests `storage` events rather than rehydrating; five of the
ten replies were collapsed and not read. No maintainer statement was found that recommends one
architecture for multi-user state.

### 2. React

- A `key` resets state: "Specifying a `key` tells React to use the `key` itself as part of the
  position" so components with different keys "will never share state. Every time a counter appears
  on the screen, its state is created. Every time it is removed, its state is destroyed"
  ([Preserving and resetting state, "Option 2: Resetting state with a key"](https://react.dev/learn/preserving-and-resetting-state#option-2-resetting-state-with-a-key)).
- For a per-user view specifically: "By passing `userId` as a `key` to the `Profile` component,
  you're asking React to treat two `Profile` components with different `userId` as two different
  components that should not share any state"
  ([You might not need an Effect, "Resetting all state when a prop changes"](https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes)).
- State outside React is a separate category. `useSyncExternalStore` exists for "some store outside
  of React", including "Third-party state management libraries that hold state outside of React",
  and the docs add: "When possible, we recommend using built-in React state with `useState` and
  `useReducer` instead. The `useSyncExternalStore` API is mostly useful if you need to integrate
  with existing non-React code"
  ([useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore#subscribing-to-an-external-store)).

The React docs do not say what happens to an external store when a keyed subtree remounts. Nothing
in the `key` documentation reaches module state; that a remount leaves it untouched follows from
the definition of the mechanism (**inference**, and the premise of `account-lifecycle.md`).

### 3. React Navigation and Expo Router

- `resetRoot` "lets you reset the state of the navigation tree to the specified state object" and,
  unlike `reset`, "acts on the root navigator"
  ([`navigation-container.md` L201-L212](https://github.com/react-navigation/react-navigation.github.io/blob/main/versioned_docs/version-7.x/navigation-container.md?plain=1#L201-L212)).
- `navigationKey`: "If the key changes, existing screens with this name will be removed (if used in
  a stack navigator) or reset (if used in a tab or drawer navigator)"
  ([`screen.md` L416-L420](https://github.com/react-navigation/react-navigation.github.io/blob/main/versioned_docs/version-7.x/screen.md?plain=1#L416-L420)).
  The documented example is signed-in versus guest, not one account versus another
  ([`auth-flow.md` L883-L923](https://github.com/react-navigation/react-navigation.github.io/blob/main/versioned_docs/version-7.x/auth-flow.md?plain=1#L883-L923)).
- Expo Router: "all routes are always defined and accessible"; protection is by guard, and "When a
  screen's guard is changed from true to false, all of its history entries will be removed from the
  navigation history"
  ([`router/advanced/authentication.mdx` L18](https://github.com/expo/expo/blob/main/docs/pages/router/advanced/authentication.mdx?plain=1#L18),
  [`router/advanced/protected.mdx` L57](https://github.com/expo/expo/blob/main/docs/pages/router/advanced/protected.mdx?plain=1#L57)).

Neither set of docs addresses switching between two signed-in accounts. `resetRoot` with a single
root route and no inherited state is a documented API used as documented.

### 4. SecureStore, expo-sqlite, AsyncStorage

- **SecureStore.** The docs give no per-user namespacing guidance. The only grouping primitive is
  `keychainService`, which must be supplied again to read the value
  (`node_modules/expo-secure-store/build/SecureStore.d.ts` L41-L46). Relevant to removal and to
  "delete everything": on iOS "data stored with `expo-secure-store` will persist across app
  uninstallations when the app is reinstalled with the same bundle ID"
  ([`securestore.mdx` L90-L97](https://github.com/expo/expo/blob/main/docs/pages/versions/v56.0.0/sdk/securestore.mdx?plain=1#L90-L97)).
- **expo-sqlite.** The docs give no guidance on a database per user or on closing before
  reopening; `closeAsync` is documented as "Close the database" and nothing more
  (`node_modules/expo-sqlite/build/SQLiteDatabase.d.ts` L20-L23). The iOS source shows the module
  caches open databases and hands back the cached one for the same path and options unless
  `useNewConnection` is set, and that `closeAsync` removes the database from that cache
  (`node_modules/expo-sqlite/ios/SQLiteModule.swift` L108, L140-L143; option documented at
  `build/NativeDatabase.d.ts` L35-L39).
- **AsyncStorage.** The installed 2.2.0 is one storage per app. Version 3 adds "scoped storage":
  "Each storage instance has its own isolated data, independent of other instances", and its
  database-naming page uses a per-user example, `createAsyncStorage(\`user-${userId}\`)`, stating
  the name "ensures that each storage instance is scoped by name and prevents data from leaking
  between instances"
  ([`docs/api/usage.md` L15-L25](https://github.com/react-native-async-storage/async-storage/blob/main/docs/api/usage.md?plain=1#L15-L25),
  [`docs/api/db-naming.md`](https://github.com/react-native-async-storage/async-storage/blob/main/docs/api/db-naming.md)).
  That is the only place in these three libraries where the maintainers show per-user isolation.

### 5. Real multi-account apps

**Bluesky (React Native, Expo).**

- The account subtree is keyed by account: `<Fragment // Resets the entire tree below when it
  changes: key={currentAccount?.did}>`, with about twenty account-dependent providers inside
  ([`src/App.tsx` L154-L211](https://github.com/bluesky-social/social-app/blob/8b0e6a067ebff25e2b0fa4a4f88d1c94aa38a708/src/App.tsx#L154-L211)).
  Session, preferences, shell and dialog providers sit above it (L237-L272).
- The query cache is constructed inside the keyed subtree, per account: "Enforce we never reuse
  cache between users", "We create the query client here so that it's scoped to a specific DID. Do
  not move the query client creation outside of this component." The component throws if the DID
  it was mounted with ever differs from the DID it is rendered with. The persister key is
  `'queryClient-' + did`
  ([`src/lib/react-query.tsx` L154-L202](https://github.com/bluesky-social/social-app/blob/8b0e6a067ebff25e2b0fa4a4f88d1c94aa38a708/src/lib/react-query.tsx#L154-L202)).
- Durable per-account values live in one MMKV instance whose API takes the account as an explicit
  argument on every call: `account.set([did, key], value)`
  ([`src/storage/index.ts` L145-L155](https://github.com/bluesky-social/social-app/blob/8b0e6a067ebff25e2b0fa4a4f88d1c94aa38a708/src/storage/index.ts#L145-L155),
  [`src/storage/README.md`](https://github.com/bluesky-social/social-app/blob/8b0e6a067ebff25e2b0fa4a4f88d1c94aa38a708/src/storage/README.md)).
  The account list and device preferences are one global AsyncStorage blob, `BSKY_STORAGE`
  ([`src/state/persisted/index.ts` L17-L56](https://github.com/bluesky-social/social-app/blob/8b0e6a067ebff25e2b0fa4a4f88d1c94aa38a708/src/state/persisted/index.ts#L17-L56)).
- The session store is an instance, not a module singleton: `useState(() => new SessionStore())`
  read through `useSyncExternalStore`
  ([`src/state/session/index.tsx` L83-L132](https://github.com/bluesky-social/social-app/blob/8b0e6a067ebff25e2b0fa4a4f88d1c94aa38a708/src/state/session/index.tsx#L83-L132)).
  The outgoing account's network session is disposed in a post-commit effect, and late events from
  it are dropped by an identity check on the session object (L692-L712).
- A switch is in-process and resets navigation by remounting: "We're switching accounts, which
  remounts the entire app. On mobile, this gets us Home"
  ([`src/lib/hooks/useAccountSwitcher.ts` L33-L40](https://github.com/bluesky-social/social-app/blob/8b0e6a067ebff25e2b0fa4a4f88d1c94aa38a708/src/lib/hooks/useAccountSwitcher.ts#L33-L40)).
- Module-level state exists (network-status flags in `react-query.tsx` L53-L94, the post-shadow
  `WeakMap` in `src/state/cache/post-shadow.ts` L36-L37). No reset of it on a switch was found. A
  complete census of Bluesky's module state was not done.

**Element X Android (Kotlin).** A dependency-injection scope per session:
`@GraphExtension(SessionScope::class) interface SessionGraph`, created by
`Factory.create(@Provides matrixClient: MatrixClient)`
([`app/.../di/SessionGraph.kt` L17-L25](https://github.com/element-hq/element-x-android/blob/f12b9c77d5/app/src/main/kotlin/io/element/android/x/di/SessionGraph.kt#L17-L25)).
An app-scoped cache holds one client and one sync orchestrator per session id, each client carrying
its own `sessionCoroutineScope`; several sessions can be live at once
([`appnav/.../session/MatrixSessionCache.kt` L39-L143](https://github.com/element-hq/element-x-android/blob/f12b9c77d5/appnav/src/main/kotlin/io/element/android/appnav/session/MatrixSessionCache.kt#L39-L143)).

**Amethyst (Kotlin, Nostr).** One `Account` object per pubkey in an app-wide map. A switch calls a
session-ending hook, records the new default account and loads (or reuses) that account's object;
it does not reset shared state
([`AccountSessionManager.kt` L423-L432, L251-L259](https://github.com/vitorpamplona/amethyst/blob/27df24621a/commons/src/commonMain/kotlin/com/vitorpamplona/amethyst/commons/account/AccountSessionManager.kt#L423-L432)).
Removing an account cancels that account's coroutine scope, with a comment that a component holding
its own scope "has to be disposed explicitly" and that an unregistered listener on the shared relay
client would otherwise leak. On-disk state is a directory per pubkey
([`AccountCacheState.kt` L135, L157-L165, L217-L222, L285-L302](https://github.com/vitorpamplona/amethyst/blob/27df24621a/commons/src/jvmAndroid/kotlin/com/vitorpamplona/amethyst/commons/account/AccountCacheState.kt#L157-L165)).
The relay client and event cache are shared across accounts (L125-L130).

**MetaMask (`MetaMask/core`).** A third pattern: every account is loaded at once in one controller
state, and the active account is a pointer, `internalAccounts: { accounts: Record<AccountId,
InternalAccount>; selectedAccount: string }`, with a `selectedAccountChange` event
([`packages/accounts-controller/src/AccountsController.ts` L74-L80, L137-L140](https://github.com/MetaMask/core/blob/d4070216ba/packages/accounts-controller/src/AccountsController.ts#L74-L80)).
Only this controller was read; how other controllers and MetaMask Mobile key their state was not
examined.

**Zeus (React Native, Lightning and Cashu).** The closest to Sovran's in-process switch. Stores are
module singletons constructed once (`stores/Stores.ts` L32-L56). Making another wallet active
writes `selectedNode`, sets a connecting flag and pops to the wallet screen
(`views/Settings/WalletConfiguration.tsx` L1124-L1142); the wallet screen then calls a hand-written
list of thirteen `Store.reset()` calls (`views/Wallet/Wallet.tsx` L643-L664). There is no registry;
a store left out of the list is not reset.

**Cashu wallets in local checkouts.** By text search only, none switches between accounts in a
running app: `cashu.me`, `minibits_wallet`, `eNuts`, `numo` have no active-account concept;
`macadamia` stores several `Wallet` records with one `active` flag, changed by restore
(`macadamia/Settings/RestoreView.swift` L127). `coco` exposes `manager.dispose()`
(`packages/core/README.md` L231, L446) and nothing about several accounts in one process. They
provide no precedent either way.

### 6. Reset singletons versus discard a container

No source states this trade-off in general terms. What each side shows:

- **Reset** is documented by zustand as the way to return module stores to initial state, with a
  collected `Set` of reset functions (section 1). Zeus ships it with a hand-written list. The
  zustand source adds three obligations the guide does not mention: a reset writes to storage, a
  rehydrate merges into current memory, and a rejected read still resolves (section 1).
- **Container** is what React documents for per-user UI state (`key`), what zustand documents when
  a store must be created per instance (`createStore` plus context), and what Bluesky, Element X
  and Amethyst do. Bluesky's comments give the reason: "Enforce we never reuse cache between
  users." Amethyst's comments show the container's own failure mode: anything that escapes the
  account's scope (a separate watchdog scope, a listener on a shared client) must still be disposed
  by hand.
- **Restart** is used by none of the apps examined.

**Inference.** The two patterns fail in opposite directions. With reset, forgetting to register a
piece of state leaks it into the next account. With a container, state is isolated unless someone
deliberately puts it outside. A container therefore needs no inventory; a reset design is only as
good as its inventory.

## How comparable apps do it

| App | Per-account scoping | What a switch does | Module singletons | Source |
| --- | --- | --- | --- | --- |
| Sovran | Module zustand stores with a declared scope; AsyncStorage key `<store>:profile:<pubkey>`; SQLite file and SecureStore keys per account index; provider tree keyed by account index | Default: restart the runtime. Opt-in: stop services, suspend providers, dispose holders, block writes, reset, flip, rehydrate, resume, `resetRoot` | 56 non-global stores, 26 holders and 4 services enumerated in one registry; lint rule and completeness test | `app/shared/lib/account/accountRegistry.ts`, `inProcessProfileSwitch.ts` |
| Bluesky | Subtree keyed by DID; query client built inside it; MMKV keyed by explicit DID argument | In-process; keyed subtree remounts, navigation with it; old network session disposed after commit | Few; account-keyed APIs take the DID as an argument. No reset found | [`App.tsx`](https://github.com/bluesky-social/social-app/blob/8b0e6a067ebff25e2b0fa4a4f88d1c94aa38a708/src/App.tsx#L154-L211), [`react-query.tsx`](https://github.com/bluesky-social/social-app/blob/8b0e6a067ebff25e2b0fa4a4f88d1c94aa38a708/src/lib/react-query.tsx#L154-L202) |
| Element X Android | DI graph per session, client and coroutine scope per session | Sessions coexist in a cache; the session graph is built from the chosen client | App-scoped singletons hold a map keyed by session id | [`SessionGraph.kt`](https://github.com/element-hq/element-x-android/blob/f12b9c77d5/app/src/main/kotlin/io/element/android/x/di/SessionGraph.kt#L17-L25), [`MatrixSessionCache.kt`](https://github.com/element-hq/element-x-android/blob/f12b9c77d5/appnav/src/main/kotlin/io/element/android/appnav/session/MatrixSessionCache.kt#L39-L143) |
| Amethyst | `Account` object and coroutine scope per pubkey; directory per pubkey | In-process; end-of-session hook, then load or reuse the target `Account` | Shared relay client and event cache; per-account scope cancelled on removal, escapes disposed by hand | [`AccountSessionManager.kt`](https://github.com/vitorpamplona/amethyst/blob/27df24621a/commons/src/commonMain/kotlin/com/vitorpamplona/amethyst/commons/account/AccountSessionManager.kt#L423-L432), [`AccountCacheState.kt`](https://github.com/vitorpamplona/amethyst/blob/27df24621a/commons/src/jvmAndroid/kotlin/com/vitorpamplona/amethyst/commons/account/AccountCacheState.kt#L157-L165) |
| MetaMask (core) | All accounts in one state object, keyed by account id | Moves a `selectedAccount` pointer and emits an event | Not examined beyond `AccountsController` | [`AccountsController.ts`](https://github.com/MetaMask/core/blob/d4070216ba/packages/accounts-controller/src/AccountsController.ts#L74-L80) |
| Zeus | Module MobX stores; settings hold `selectedNode` | In-process; a hand-written list of `reset()` calls on reconnect | All stores are singletons; no registry | local `stores/Stores.ts` L32-L56, `views/Wallet/Wallet.tsx` L643-L664 |
| cashu.me, Minibits, eNuts, Numo, Macadamia | Single account at a time | No in-app switch found | Not applicable | local checkouts, text search only |

## Where Sovran differs

1. **Account state lives in module stores and is reset, where Bluesky, Element X and Amethyst
   construct it per account.** Sovran: 30 profile and 26 session stores as module singletons.
   Sources: zustand documents both; the comparable apps choose the container. **Risk, mitigated.**
   The exposure is an unregistered store or holder. A store cannot escape (lint rule in
   `app/eslint.config.js`, completeness test). A holder can: registration is by convention, and
   ADR 0029 names package-private wallet and for-you holders as uninspected gaps.
2. **Default switch restarts the runtime.** No examined app does. **Advantage** for isolation: it
   is the only mechanism here that cannot leak memory by construction. The cost is a slower switch,
   which is a product matter, not an architectural one.
3. **The reset list is derived, not hand-written.** Zeus keeps a list of thirteen calls; the zustand
   guide collects resets in a `Set` with no scope or completeness check. Sovran adds scope, a
   generated manifest that covers stores whose module has not loaded, and a test. **Advantage.**
4. **The switch handles the three `persist` behaviours the zustand docs do not mention.** The write
   barrier covers "reset writes to storage" (source L365-L369); the second reset immediately before
   each `rehydrate()` covers "rehydrate merges into current memory" (L417-L421); the `hasHydrated()`
   check covers "a rejected read still resolves" (L433-L438). Each matches the installed source.
   **Advantage**, and a dependency on zustand internals: the first two are not documented contract.
5. **A profile store resolves its storage key from the ambient active profile on each write.**
   Bluesky's account storage takes the DID as an argument, and its per-account query provider
   throws if the DID changes under it. Sovran has the same idea only for captured-owner stores
   (`createProfileScopedStorage(ownerPubkey)`); ordinary profile stores rely on the switch ordering
   and the write barrier. No check was found in `profileScopedStorage.ts` that the active pubkey
   still equals the pubkey a store hydrated under. **Risk, low:** safe as long as every account
   change goes through the orchestrator.
6. **The provider tree is keyed by account index; storage is keyed by pubkey.** Bluesky keys both by
   DID. **Neutral** while an index cannot change identity in a running process (only an inactive
   profile can be removed, and recovery restarts).
7. **Navigation is reset with `resetRoot`; Bluesky remounts the navigator inside the keyed
   subtree.** `resetRoot` is the documented API for this. Expo Router owns the navigation container,
   so keying it is not available in the same way (**inference**). **Neutral.**
8. **Per-account SQLite files and SecureStore key names.** Amethyst uses a directory per account;
   AsyncStorage v3 documents a database per user. Expo's docs are silent. **Neutral; consistent
   with the only guidance that exists.**
9. **Removal refuses unless the wallet is provably empty (ADR 0030).** Amethyst deletes the account
   directory on log-off; Bluesky clears the account's persisted query cache. Neither holds funds.
   **Advantage; no comparable precedent, because no examined multi-account app is custodial of
   bearer value per account.**

## Recommendations

1. **Change nothing structural, and keep restart as the default switch.** Evidence: the in-process
   path is the zustand-documented reset pattern with every undocumented `persist` behaviour
   covered; the only comparable app using reset (Zeus) is weaker; restart is stronger than any
   examined app. Cost: none. Persisted data: untouched.
2. **Put new account-owned state inside `AccountScopedProviders`, and stop growing the registry.**
   For a new store, build it with `createStore` in a provider and read it with `useStore`, as the
   zustand "Initialize state with props" guide and Bluesky's `QueryProviderInner` do. Evidence:
   sections 1, 2 and 5; a contained store needs no registration, reset or holder. Cost: a
   convention plus a note in the contributor conventions; code that runs outside React (services)
   needs the handle passed in. Persisted data: none for memory-only state. A new persisted
   per-account store built this way still needs a name, key and version chosen once, under the
   existing rules.
3. **Before enabling the in-process switch by default, close the holder gap.** The registry proves
   completeness for stores but not for holders; ADR 0029 lists uninspected ones. Either give each a
   dispose and an empty-state inspection, or move it under the provider tree so the remount
   replaces it. Evidence: Amethyst's comments on scope escapes; difference 1. Cost: per holder,
   small; some are package-private in `wallet/` and `nostr/`. Persisted data: untouched.
4. **Optional: assert the owner in the profile storage adapter.** Record the pubkey a profile store
   hydrated under and refuse (and log) a write when the active pubkey differs, as Bluesky's
   `QueryProviderInner` throws on a changed DID. This turns the hazard in `account-lifecycle.md`
   from "prevented by ordering" into "refused at the write". It is an **inference**, not something
   a source prescribes, and it needs care not to break the first-launch fallback to the bare key.
   Cost: small, in `profileScopedStorage.ts`, plus a test. Persisted data: no name, key format,
   schema or version changes.
5. **Do not migrate existing persisted stores into a container, and do not adopt AsyncStorage v3
   scoped storage for accounts.** Converting the 30 profile stores would touch every consumer for
   no isolation gain over the restart default; scoped storage would move every per-profile blob to
   a new database, which changes the storage location that `releasedPersistedSurface.test.ts`
   freezes. Evidence: nothing in the sources says keyed names in one storage are unsafe. Persisted
   data: this recommendation exists to avoid touching it.

## Not established

- No zustand maintainer statement recommending an architecture for multi-user or multi-tenant
  state was found. Discussion #2909 was read with five replies collapsed. A further thread on
  dynamic persist names (#474) surfaced in search and was not opened.
- That every `setState` on a persisted store writes to storage, that `rehydrate` merges into
  current memory, and that a rejected read resolves, are facts of the installed 5.0.15 source, not
  documented contract. Nothing guarantees them across versions.
- The React docs do not discuss external stores across a keyed remount.
- React Navigation and Expo Router document no account-to-account switch; only signed-in versus
  signed-out.
- Expo documents no per-user namespacing for SecureStore or SQLite, and no rule about closing a
  database before opening another. Native close and delete behaviour on iPhone and Android was not
  tested; ADR 0029 and ADR 0030 already list that as pending device validation.
- Bluesky: where the navigator sits relative to the keyed fragment was taken from the comment in
  `useAccountSwitcher.ts`, not traced. Its module-level state was sampled, not censused.
- MetaMask Mobile was not read; only `MetaMask/core`'s `AccountsController`.
- Signal, Element Web, Damus and Primal were not examined.
- The local Cashu wallets were judged single-account by text search, not by reading their account
  code.
- Sovran's counts (30 profile, 26 session, 22 global stores; 26 holder registrations; 4 services)
  come from text search of the manifest and call sites on branch `feat/offline-send-just-works`,
  and no test was run for this note.
