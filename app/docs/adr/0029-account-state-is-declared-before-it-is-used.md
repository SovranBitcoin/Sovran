# 29. Account state is declared before it is used

Date: 2026-10-09
Status: Accepted; in-process existing-profile switching is opt-in pending native validation.

Account isolation needs an inventory that is complete even when a feature has
never mounted. Store declarations go through `defineStore` (or
`defineVanillaStore` for captured-owner instances), with an explicit scope:
`global` belongs to the installation, `profile` belongs to an account, and
`session` is memory-only state belonging to the active account.

One module, `app/shared/lib/account/accountRegistry.ts`, holds everything an
account owns outside React: the stores created so far, the stores declared in
source, the module-level holders with their disposal callbacks, the running
services, and the provider boundary. Its header is the map of who registers
what and what a switch does to each. `persistRegistry` in `persistConfig.ts` is
only the list of persisted schemas the compatibility tests iterate. Registering
a store records its original handle and Zustand initial state; registering a
holder records its disposal function. Neither registration changes state or
invokes disposal. Multiple instances with the same name remain discoverable.

Pre-hydration migrations must enumerate storage names without initializing every
lazy feature or native dependency. The registry therefore includes generated
metadata from store declarations. The filesystem completeness test compares the
metadata with those declarations and checks persisted keys. Regenerate it with
`bun run store-registry:update` (in `app/`) after changing a declaration.
Storage inventory consumes the registry rather than an independent key list. The
one-time legacy profile-key migration does not: it keeps its own frozen list of
the names it shipped with, because it records what older installs wrote and must
not follow declarations that change (`globalMigrations.ts`).

Scope describes ownership; it does not authorize changing a persistence adapter,
key, schema, version or projection. Package-owned holders expose disposal to the
app without importing app infrastructure.

## Switch protocol

Existing-profile switches may opt into `inProcessProfileSwitch` in developer
settings (default false). With it disabled, the persist-target/restart path is
unchanged. Create, recover and delete continue to restart.

The opt-in path quiesces signing/account services, unmounts the account provider
tree, and awaits strict Coco cleanup (including otherwise swallowed teardown
errors) while A still owns persistence. Holder disposal drains final owner-bound
writes before captured-owner stores detach from the registry. Only then does the
write barrier drain admitted writes and block reset writes. The switch resets
profile/session memory, activates and persists B, rehydrates B's profile stores,
and releases writes before remounting. Navigation uses Expo Router's root
navigation ref and React Navigation `resetRoot` with a single drawer root route,
without inherited params or nested state. ThemeProvider stays above the boundary
and applies the hydrated profile theme. Every awaited step has a five-second
failure deadline. Hydration must report success: Zustand can resolve after a
storage error. A second memory reset immediately before each rehydration prevents
late A hydration from becoming B's merge baseline.

NDK teardown stops subscriptions and both relay pools, drops signing authority
and event listeners, and replaces ndk-mobile's private store through public
`init`/`logout` after provider suspension. The old instance loses its cache
reference. An inert cache with no SQLite handle clears unpublished events;
the new tree sees this inert instance until B initializes its own cache. No
account database is erased to accomplish teardown. The session quiescence signal
also retains a deferred NDK initialized after the service snapshot for disposal
after suspension.

Whitenoise shutdown stops its owned network subscriptions, drains client,
key-package and invitation work, removes listeners and zeroes the signer's key.
This integration uses AsyncStorage and owns no database handle. Marmot 0.4 has no
non-destructive release for loaded groups' private MLS state: that precise case
still refuses, rather than deleting group history. Routstr shutdown stops recovery
admission and timers, joins pending builds, recovery calls, SDK calls and stream
finalization, flushes the captured owner's driver, and revokes client handles.
The installed SDK's private refund-timer release hook is checked before use;
instrumentation of its public refund method joins callbacks already in flight.
An armed interval refuses only if that release hook is missing or fails to stop
it. Unsettled work times out to restart.

Any failure holds the provider boundary and write barrier, restores the old
in-memory account index, persists the requested restart target, and attempts a
runtime restart. An unavailable restart leaves the transition held, rather than
booting partially reset state. A deadline never authorizes continuing teardown
in process. Captured-owner storage without registered disposal still refuses;
a Vertex instance flushes to its immutable A key, cancels old hydration, disables
its retained handle's persistence, and unregisters before B's stores hydrate.

The registry canary loads profile/session declarations from generated metadata,
seeds store memory, and verifies resets, old durable blobs and new storage keys.
Every loaded holder must supply an empty-state inspection or appear in the
test's explicit uninspectable list with a reason. Inspection covers app-owned
Maps and caches; package-private wallet/for-you holders and the monotonic cache
epoch remain named gaps. Seven holders additionally receive payload canaries.
The dev leak scan inspects account store memory and
storage for the previous pubkey, logging identifiers only; retained old-account
blobs and the global profile inventory are expected. This is bounded JavaScript
evidence, not a native isolation guarantee. iPhone/Android lifecycle, relay,
SQLite, navigation and theme behavior still require device validation.
