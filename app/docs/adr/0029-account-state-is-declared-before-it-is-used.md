# 29. Account state is declared before it is used

Date: 2026-10-09
Status: Accepted; in-process existing-profile switching is opt-in pending native validation.

Account isolation needs an inventory that is complete even when a feature has
never mounted. Store declarations go through `defineStore` (or
`defineVanillaStore` for captured-owner instances), with an explicit scope:
`global` belongs to the installation, `profile` belongs to an account, and
`session` is memory-only state belonging to the active account.

The existing `persistRegistry` owns store instances and non-store disposal
callbacks. Its array iteration remains the persisted-schema view used by the
compatibility tests. Registering a store records its original handle and Zustand
initial state; registering a holder records its disposal function. Neither
registration changes state or invokes disposal. Multiple instances with the same
name remain discoverable.

Pre-hydration migrations must enumerate storage names without initializing every
lazy feature or native dependency. The registry therefore includes generated
metadata from store declarations. The filesystem completeness test compares the
metadata with those declarations and checks persisted keys. Regenerate it with
`bun run store-registry:update` (in `app/`) after changing a declaration.
Storage inventory and legacy profile-key migration consume the registry rather
than independent key lists. Memory-only query caches retain their storage-name
metadata so migration can still find blobs from their persisted predecessors.

Scope describes ownership; it does not authorize changing a persistence adapter,
key, schema, version or projection. Package-owned holders expose disposal to the
app without importing app infrastructure.

## Switch protocol

Existing-profile switches may opt into `inProcessProfileSwitch` in developer
settings (default false). With it disabled, the persist-target/restart path is
unchanged. Create, recover and delete continue to restart.

The opt-in path blocks profile writes and drains admitted writes under their
captured old key (including reads that migrate provider credentials); stops
signing/account services; unmounts the account provider tree; awaits strict Coco cleanup (including otherwise swallowed teardown errors); invokes every registered holder; replaces every
profile/session store with its recorded initial state without persistence; flips
the account; rehydrates persisted profile stores; and releases writes before
remounting providers and replacing navigation with the root. ThemeProvider stays
above the boundary and applies the newly hydrated profile theme. Each awaited
step has a five-second failure deadline. Hydration must also report success:
Zustand may resolve its promise after a storage error. A second memory reset
immediately before each rehydration prevents a late old-key hydration from
becoming the merge baseline while another store is awaited.

Any failure holds the provider boundary and write barrier, restores the old
in-memory account index, persists the requested restart target, and attempts a
runtime restart. An unavailable restart leaves the transition held, rather than
booting partially reset state. A deadline never authorizes continuing teardown
in process. Active Whitenoise and Routstr clients currently refuse this path:
their APIs do not establish awaited quiescence. Instantiated captured-owner
storage also refuses, because its immutable key cannot follow the new account.

The registry canary loads profile/session declarations from generated metadata,
seeds store memory, and verifies resets, old durable blobs and new storage keys.
It observes all loaded holder disposals; opaque closure/native contents remain
an explicit injection gap. The dev leak scan inspects account store memory and
storage for the previous pubkey, logging identifiers only; retained old-account
blobs and the global profile inventory are expected. This is bounded JavaScript
evidence, not a native isolation guarantee. iPhone/Android lifecycle, relay,
SQLite, navigation and theme behavior still require device validation.
