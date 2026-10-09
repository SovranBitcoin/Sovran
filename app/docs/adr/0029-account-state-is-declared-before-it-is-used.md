# 29. Account state is declared before it is used

Date: 2026-10-09
Status: Accepted; the switch itself still restarts the runtime.

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

Profile switching continues to restart the runtime. Disposal registration is
preparation for a later teardown protocol, not proof that in-process switching is
safe. That protocol still needs to coordinate pending operations, reset stores,
rehydrate them, and validate isolation on both native platforms. Holders without
safe teardown must remain explicit coverage gaps rather than registering empty
callbacks.
