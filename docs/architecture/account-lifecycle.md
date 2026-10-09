# How accounts work

One page for reasoning about profiles: what an account is made of, where each piece lives, what
happens when the active account changes, and what protects people upgrading from an older release.

## An account is five kinds of thing

| Piece | Where it lives | Keyed by | Survives the React remount? |
| --- | --- | --- | --- |
| Keys and seeds | SecureStore | account index (`derived_keys_<i>`, `cashu_mnemonic_<i>`, `cashu_seed_<i>`) or pubkey (`imported_nsec_<pubkey>`) | on disk |
| Wallet | SQLite, `coco.db` for account 0 and `coco-<i>.db` after it | account index | on disk |
| Nostr cache | SQLite, `nostr` for account 0 and `nostr-<i>` after it | account index | on disk |
| Stores | AsyncStorage, `<store>:profile:<pubkey>` for per-profile stores and `<store>` for global ones | pubkey | on disk, and **in memory** |
| Everything running | React providers, module-level caches, signer, relay pool, clients | the process | **in memory** |

The recovery phrase (`user_mnemonic`) is shared: derived profiles are the same phrase at different
indices. An imported profile has its own key, which the phrase cannot recover.

The list of profiles and which one is active is itself a global store, `profile-store`.

## The one hazard

The last two rows are the hazard. Disk is keyed, so two accounts never collide there. Memory is not.

- The account providers (`app/shared/providers/AccountProviders.tsx`) are keyed by account index, so React state is
  replaced when the active account changes.
- Zustand stores and module-level state live outside React. A per-profile store works out its
  storage key on every write but loads its contents once. Flip the account underneath it and it
  writes the old account's contents under the new account's key.

That is why a profile switch restarts the app, and why anything that changes accounts has to deal
with what lives outside React.

## One registry for what lives outside React

`app/shared/lib/account/accountRegistry.ts` is the only place this is tracked. Its header has the
same table:

| Kind | Who registers | With | On a switch |
| --- | --- | --- | --- |
| Store | every zustand store | `defineStore({ name, scope })` | `profile` and `session` stores are reset; `profile` stores reload under the new key |
| Holder | a module-level cache, Map or singleton | `registerAccountScoped(name, dispose)` | disposed |
| Service | signer, relay pool, Whitenoise, Routstr | `registerProfileSwitchService(name, stop)` | stopped first |
| Boundary | the layout that mounts the account providers | `registerProfileSwitchBoundary` | suspended, then resumed |

A store's `scope` is `global` (the installation), `profile` (one account, on disk under its pubkey)
or `session` (the active account, memory only). It is required, a lint rule bans creating a store
any other way, and a test fails when a store is missing from the registry. That is what stops a new
piece of state from quietly escaping.

Registering does nothing. Only the switch and profile removal act on the registry.

## What changes the active account

The flows are in `app/shared/lib/profile/profileSessionOrchestrator.ts`. Every flow starts the same
way, so two cannot overlap:

```ts
const lock = acquireTransition();          // in memory: one flow per runtime
if (!lock) return false;
if (!(await lock.takeDiskGuard())) { ... } // on disk: survives the restart most flows end in
lock.holdSplash(...);                      // cover the app while it changes
...
await lock.release();                      // gives back exactly what this flow took
```

A flow that restarts the runtime does not release: the reload clears the in-memory guard and the
next start clears the one on disk. Which of the three a flow takes is the difference between them:

| Flow | In-memory guard | On-disk guard | Splash |
| --- | --- | --- | --- |
| Switch, add, delete everything | yes | yes | yes |
| Remove one profile | yes | yes | no: the removed profile is not running |
| Recover from a phrase | yes | no | no: it runs before any account is usable |

| Flow | Function | How it finishes |
| --- | --- | --- |
| Switch to a profile | `switchToExistingProfile` | restart (default), or in the same runtime (developer setting) |
| Add a derived profile | `createAndSwitchProfile` | restart |
| Recover from a phrase | `recoverMnemonicSession` | restart |
| Remove one profile | `removeInactiveProfile` | no restart; the profile was not running |
| Delete everything | `deleteAllProfiles` | restart |

### Switch by restart (default)

`switchByRestart`: close the wallet, write the target account to disk, restart. The new runtime
boots as the target. Nothing in memory survives, so nothing can leak.

### Switch without restart (developer setting, off by default)

`switchWithoutRestart`, with the steps in `inProcessProfileSwitch.ts`:

1. Stop the services, signer first.
2. Suspend the account providers.
3. Close the wallet and wait for it.
4. Let the old account's last writes land, then block writes.
5. Dispose every holder.
6. Reset every `profile` and `session` store in memory.
7. Flip the active account.
8. Reload every `profile` store under the new key, then allow writes.
9. Resume the providers and reset navigation to the root.

Any step that fails or takes longer than five seconds ends in a restart instead. If the restart is
also unavailable, the providers stay suspended and writes stay blocked: a stuck app, never a
half-switched wallet.

### Remove one profile

Only a profile that is not active and not the last. Refused unless its wallet is provably empty,
which is checked by opening its database read-only, without starting anything for that account. An
imported key needs a second confirmation. See ADR 0030.

## Upgrading from an older release

Nothing in this design may strand data written by v0.1.3 or earlier. Three tests hold that line:

| Test | Guards |
| --- | --- |
| `releasedPersistedSurface.test.ts` | every store v0.1.3 wrote is still present under the same name, on the same kind of key (global or per-profile), at no lower version; the SecureStore key names, both database names and the per-profile key format are unchanged. The list is frozen from the v0.1.3 tag |
| `releaseUpgrade.test.ts` | the contents of released blobs survive the current migrate-and-merge |
| `persistSchemaDrift.test.ts`, `persistRoundTrip.test.ts` | a schema cannot change shape without a version bump, and every store's schema accepts what the store writes |

Rules that follow from them:

- `routstr-store` moved its secrets into secure storage after v0.1.3. It still reads the key the
  old release wrote, copies the secrets across, verifies them, and only then strips the plaintext
  (`routstrSecurePersistence.test.ts`).
- Never rename, remove or tighten a persisted field. Add fields with a default and tolerance.
- Never change a store's name, a storage key format, a SecureStore key name or a database name.
- A one-time storage migration keeps its own frozen list of names. It records what old installs
  wrote, so it must not follow the live registry (`globalMigrations.ts`).

## Where to look

| Question | File |
| --- | --- |
| What does an account own outside React? | `app/shared/lib/account/accountRegistry.ts` |
| What happens on switch, add, recover, remove, delete? | `app/shared/lib/profile/profileSessionOrchestrator.ts` |
| The in-process switch, step by step | `app/shared/lib/profile/inProcessProfileSwitch.ts` |
| What removal deletes | `app/shared/lib/profile/profileRemovalStorage.ts` |
| How a per-profile store finds its key | `app/shared/lib/cashu/profileScopedStorage.ts` |
| Which providers remount with the account | `app/shared/providers/AccountProviders.tsx` |
| The lock every flow takes, and the shared restart steps | `app/shared/lib/profile/profileTransition.ts` |
| Decisions | ADR 0029 (registry and switch), ADR 0030 (removal) |
