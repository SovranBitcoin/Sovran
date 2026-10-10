# How accounts work

One page for reasoning about profiles: what an account is made of, what happens at startup, what
happens when the active account changes, every guard involved, and what protects people upgrading
from an older release. Each claim names the file that makes it true.

## The short version

- An account is keys, a wallet database, a Nostr cache, a set of stored blobs, and everything
  running in memory for it.
- On disk, accounts are kept apart by their key names. In memory they are not, so **changing
  account restarts the app**. The new runtime starts as the new account and nothing carries over.
- The five operations that change accounts share one lock. Where one of them cannot finish safely
  after the point of no return, it **holds** the app (account providers unmounted, per-profile
  saves blocked) and asks to be reopened, instead of carrying on half-switched. Which exits hold
  and which simply give up is spelled out per flow below.
- A switch without a restart exists behind a developer setting. It is off by default (the setting
  is saved, so an install that turned it on keeps it), and several follow-ups must close before it
  becomes the default.

## What an account is made of

| Piece                                 | Where it lives                                                          | Keyed by                        |
| ------------------------------------- | ----------------------------------------------------------------------- | ------------------------------- |
| Root recovery phrase                  | SecureStore, `user_mnemonic`                                            | shared by every derived profile |
| Derived keys and wallet phrase caches | SecureStore, `derived_keys_<i>`, `cashu_mnemonic_<i>`, `cashu_seed_<i>` | account index                   |
| Imported key                          | SecureStore, `imported_nsec_<pubkey>`                                   | pubkey                          |
| Wallet                                | SQLite, `coco.db` for account 0, `coco-<i>.db` after it                 | account index                   |
| Nostr cache                           | SQLite, `nostr` for account 0, `nostr-<i>` after it                     | account index                   |
| Per-profile stores                    | AsyncStorage, `<store>:profile:<pubkey>`                                | pubkey                          |
| Global stores                         | AsyncStorage, `<store>`                                                 | the installation                |
| Large caches                          | a file in the cache directory (the map cache)                           | the installation                |
| Payment secrets (Routstr)             | SecureStore, through its own adapter                                    | pubkey                          |
| Everything running                    | React providers, zustand stores, module-level state, the wallet manager | the process                     |

The list of profiles and which one is active is itself a global store, `profile-store`.

Three things that are easy to get wrong:

- An **imported** profile's identity cannot be recovered from the root phrase, but its wallet
  phrase is derived from the root phrase plus a number computed from its pubkey
  (`app/shared/lib/nostr/loadAccountKeys.ts`). The imported key alone cannot reproduce that wallet
  phrase: recovering the wallet from scratch needs the original root phrase.
- A **derived** profile's saved pubkey can differ from the key the phrase derives. v0.1.3 produced
  that state (a restored backup without the keychain) and ran in it, so startup tolerates it rather
  than strand the funds. "The saved pubkey" and "the signing key" are therefore not always the same.
- Before any profile exists (first launch), a per-profile store reads its bare key. A save made
  then lands under whichever profile exists once storage is ready, or the bare key if there is
  still none. Bare rows are bootstrap leftovers, not account 0's data.

## The one hazard

Disk is keyed. Memory is not.

- The account providers (`app/shared/providers/AccountProviders.tsx`) are keyed by account index,
  so React state is replaced when the active account changes. Work those providers started can
  still finish afterwards; the key and wallet providers drop results that arrive after unmount.
- Zustand stores and module-level state live outside React. A per-profile store works out its
  storage key on every save but loads its contents once. Flip the account underneath it and it
  would save the old account's contents under the new account's key.

Three things stand in the way of that, in order: a restart (nothing survives), the write barrier
during an in-process switch, and the storage adapter itself, which remembers which profile each
store loaded under and drops a save made while another is active
(`app/shared/lib/cashu/profileScopedStorage.ts`).

## Starting up

Top to bottom, as nested in `app/app/_layout.tsx` and `AccountProviders.tsx`. This is nesting
order, not one awaited sequence: the migration gate, the key provider and the wallet provider each
hold back what is below them; the others do not.

| Step                                      | What it does                                                                                       | If it fails                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Transition guard cleanup                  | clears the on-disk guard a previous run left; not waited for                                       | nothing; a stale guard is ignored                                                                |
| Splash gate                               | covers the app until the wallet screen is ready, or a blocking stage fails                         | fades after a timeout                                                                            |
| Global migrations (`GlobalMigrationGate`) | one-time storage moves, then opens per-profile storage                                             | storage stays closed; a retry screen is shown                                                    |
| Account boundary                          | lets an in-process switch unmount everything below                                                 | —                                                                                                |
| Key provider                              | finds the keys and wallet phrase (`loadAccountKeys`), hands them to the wallet manager             | key recovery screen                                                                              |
| Nostr providers, then wallet provider     | mount in that order, but the wallet database opens first; the Nostr cache opens after it, deferred | the wallet stage fails and nothing below it renders; there is no retry screen for this yet (F85) |
| App gate (`AppGate`)                      | settings loaded, terms accepted, reinstall check, onboarding, restore                              | its own screens                                                                                  |

Three separate kinds of readiness, easy to confuse:

- **Storage**: a per-profile store can load once migrations have finished and the profile list has
  loaded (`profileScopedStorage.ts`).
- **Stages**: `InitializationProvider` tracks the blocking stages `global-migrations`, then
  `nostr`, then `coco`.
- **The splash**: `NativeSplashLayoutGate` hides the native splash as soon as the root lays out,
  then keeps its own overlay up until the wallet screen publishes its position, a blocking stage
  fails, or a timeout passes. The splash coming down does not prove the wallet is usable.

After the wallet opens, read-only watchers and default mints start at once; sync, processors and
recovery of pending operations wait for any restore to finish.

## Changing the active account

All five flows live in `app/shared/lib/profile/profileSessionOrchestrator.ts`.

| Flow                  | Function                  | Takes                    | When it works        | When it fails                                                             |
| --------------------- | ------------------------- | ------------------------ | -------------------- | ------------------------------------------------------------------------- |
| Switch profile        | `switchToExistingProfile` | lock, disk guard, splash | restart, lock kept   | before the restart call: gives up and releases; restart call fails: holds |
| Add a derived profile | `createAndSwitchProfile`  | lock, disk guard, splash | restart, lock kept   | same as switch                                                            |
| Recover from a phrase | `recoverMnemonicSession`  | lock only                | restart              | releases; never holds                                                     |
| Remove one profile    | `removeInactiveProfile`   | lock, disk guard         | no restart, releases | stops at the failed step, reports what is left, releases                  |
| Delete everything     | `deleteAllProfiles`       | lock, disk guard, splash | restart, lock kept   | before the wipe starts: releases; after: holds                            |

"Lock kept" means the flow does not release: the reload discards the in-memory lock and the next
start clears the one on disk. The differences between the rows are deliberate (confirmed
2026-10-09).

Two things are not transactions. Recovery writes several things in turn (the restore decision, the
profile list, the phrase, settings) and can stop partway. Removal deletes in steps and stops at the
first that fails, keeping the profile row until the last. Importing a key stores the key and adds
the profile row before any of these flows takes the lock (`DrawerProfileChrome.tsx`).

### A switch, step by step (the default)

`A` is the account you are leaving, `B` the one you chose.

| #   | Step                                                                                                                          | Active account in memory | Active account on disk | Where                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------- | ---------------------------------------------------- |
| 1   | Refuse unless the wallet is open and idle (not starting, closing or busy in the background), and no other flow holds the lock | A                        | A                      | `CocoManager.isReadyForCleanup`, `acquireTransition` |
| 2   | Take the disk guard (refused if a guard under ten seconds old exists), raise the splash, close popups                         | A                        | A                      | `takeDiskGuard`, `holdSplash`                        |
| 3   | Ask A's wallet to close. Carry on when it has closed, failed, or five seconds have passed; the close may still be running     | A                        | A                      | `cleanupCocoWithTimeout`                             |
| 4   | Write B as the active account, to disk only                                                                                   | **A**                    | **B**                  | `persistSwitchTargetToDisk`                          |
| 5   | Ask the system to restart                                                                                                     | A                        | B                      | `teardownAndRestart`                                 |
| 6   | New runtime starts as B                                                                                                       | B                        | B                      | startup, above                                       |

The two columns are only the active account's index. From step 3 A's wallet is closed and its
credentials are cleared, whatever the index says.

Between steps 4 and 6 memory says A and disk says B. Nothing may flip memory to B in that window:
that would remount the providers over stores still holding A.

Step 3 is the point of no return. Before it a failure gives up; from it on the only endings are
a restart or a hold (`restartInto`). Ways out other than step 6:

- **Something fails before step 3** (the target does not exist, the keys for a new profile
  cannot be derived): the lock and splash are released and the app carries on as A.
- **Step 4 fails**, or the restart call throws: the app is **held** on A with an alert. A's wallet
  is already closed, so carrying on is not an option. Reopening starts as A.
- **The restart call reports failure** (step 5): the app is **held**. Account providers are
  unmounted, saves are blocked, the lock is kept, and an alert asks to close and reopen. Reopening
  starts as B. Checked on a device.
- **The restart call returns but nothing reloads**: not detected. `true` from `restartApp` means
  the request was made, not that a reload was seen. In a development build the reload call can
  throw instead, which holds the app.

Adding a profile differs before step 3: the new keys are derived (the flow gives up waiting after
thirty seconds; the derivation itself is not cancelled) and the profile row is added, in memory
and on disk. Then the wallet is closed, the new index is written as active, and the app restarts.

### Delete everything

In order: work out what secure storage holds; close the wallet and delete every wallet database
and its backups; clear secure storage; delete Whitenoise data, then the Nostr caches (failures in
these two are logged and do not stop the wipe); clear all of AsyncStorage; empty the profile list
and the map cache in memory; restart.

- A failure **before the wallet reset begins** gives the app back unchanged.
- A failure **from that point on** holds the app, as a failed restart does, even if nothing had
  been deleted yet. Reopening finds whatever survived. In the case tried on a device (secure
  storage failing to clear) that was the profile and phrase with a new empty wallet database, and
  the wipe could be run again; a later failure can leave less.
- An error deleting a wallet database or its backups fails the wipe. It is not reported as
  success. Errors deleting Nostr caches are only logged.

### Remove one profile

Only a profile that is not active and not the last. Its wallet database is opened on a separate
connection in query-only mode, with no migrations and no seed. Removal is refused unless the
database is provably empty: no unspent proof, no open quote or operation, no reusable quote, no
unknown table or state, no migration backup. The profile's own standing payment request does not
count (ADR 0030). An imported key needs a second confirmation.

### Switch without a restart (developer setting, off)

`runInProcessProfileSwitch` in `app/shared/lib/profile/inProcessProfileSwitch.ts`, in this order:

1. Mark the switch as under way.
2. Stop the services, the remote signer first.
3. Unmount the account providers.
4. Close the wallet, and require that it really closed.
5. Dispose every registered holder.
6. Block saves and wait for the ones already admitted to land.
7. Reset every `profile` and `session` store in memory.
8. Flip the active account in memory and write it to disk.
9. Reload every per-profile store that exists and is saved to disk, resetting each again just
   before its read.
10. Allow saves, remount the providers, reset navigation.

Each awaited operation (one service, one holder, one store's reload) gets five seconds, so a
numbered step can take longer than that in total. An operation that runs out is not cancelled,
only no longer waited for. A failure holds the app and attempts a restart, after trying to write
the target to disk; if that write failed, the restart opens the previous account. If the restart
is also unavailable the providers stay unmounted and saves stay blocked, without the alert the
default switch shows.

## Every guard, and who clears it

They do different jobs and are not interchangeable.

| Guard                                         | Stops                                                                                 | Set by                                                                             | Cleared by                                                                                                                                                                   | File                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Transition lock (in memory)                   | two flows running at once                                                             | `acquireTransition`                                                                | `lock.release`, or a reload                                                                                                                                                  | `profileTransition.ts`       |
| Disk guard (`profile-transition-in-progress`) | a flow starting while one from the previous run may be finishing                      | `lock.takeDiskGuard`                                                               | removed on release and at startup, best effort; one over ten seconds old is ignored and overwritten; a storage error lets the flow in                                        | `profileTransition.ts`       |
| Splash wait                                   | the app looking ready with no stages registered                                       | `lock.holdSplash` (`resetStages`)                                                  | the first render in which any stage exists, including one kept through the reset; or release                                                                                 | `InitializationProvider.tsx` |
| Quiescing                                     | a service starting up late during a switch or a hold                                  | the in-process switch, and a hold                                                  | the in-process switch finishing; otherwise a reload                                                                                                                          | `accountRegistry.ts`         |
| Provider boundary                             | account UI and providers mounted during a switch or a hold                            | `boundary.suspend`                                                                 | `boundary.resume` (in-process switch only)                                                                                                                                   | `AccountProviders.tsx`       |
| Write barrier                                 | per-profile saves during a switch or a hold (global stores are not covered)           | `blockProfilePersistWrites`                                                        | `unblockProfilePersistWrites` (in-process switch only)                                                                                                                       | `profileWriteBarrier.ts`     |
| Skip-saves scope                              | saves caused by resetting state on purpose                                            | `withSkippedPersistWrites`                                                         | end of that call                                                                                                                                                             | `profileWriteBarrier.ts`     |
| Loaded-profile check                          | a store saving under a profile it was not loaded for                                  | each successful read with a profile active (before the schema has judged the data) | replaced by the next such read; applies only when both profiles are known                                                                                                    | `profileScopedStorage.ts`    |
| Migration gate                                | any per-profile read or save before migrations finish                                 | module load                                                                        | `GlobalMigrationGate` on success                                                                                                                                             | `profileScopedStorage.ts`    |
| Unreadable guard                              | a store overwriting data it could not load                                            | a failed or rejected load                                                          | a failed read: the next successful read. A rejected blob: a side copy that already exists, or a new one that reads back. Removing the store's data on purpose is not guarded | `preserveUnreadable.ts`      |
| Wallet init and cleanup in flight             | opening and closing the wallet overlapping                                            | `initialize`, `cleanup`                                                            | when each settles                                                                                                                                                            | `cashu/manager.ts`           |
| Reset generation                              | a wallet that was already opening from finishing after delete-all                     | `completeReset`                                                                    | never; compared, not cleared                                                                                                                                                 | `cashu/manager.ts`           |
| Staged credential revisions                   | cleanup wiping the next account's keys, or the next account inheriting the last one's | the three credential setters                                                       | never; compared, not cleared                                                                                                                                                 | `cashu/credentialStaging.ts` |

A **hold** is four of these at once: quiescing on, the provider boundary down, the write barrier
up, the lock kept. It only ends with a restart. Providers above the account boundary stay mounted,
and a sheet the system presented can stay visible on top (follow-up F82).

## One registry for what lives outside React

`app/shared/lib/account/accountRegistry.ts` is where state that outlives React is declared. Only
the in-process switch and profile removal act on it; the default switch restarts instead.

| Kind     | Registered with                                                        | On an in-process switch                                           |
| -------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Store    | `defineStore({ name, scope })`, scope `global`, `profile` or `session` | `profile` and `session` stores are reset; `profile` stores reload |
| Holder   | `registerAccountScoped(name, dispose)`                                 | disposed                                                          |
| Service  | `registerProfileSwitchService(name, stop)`                             | stopped first                                                     |
| Boundary | `registerProfileSwitchBoundary`                                        | unmounted, then remounted                                         |

A lint rule bans creating a store any other way, and a test fails when a store is missing from the
registry. Not in the registry, and tracked by their own owners instead: the wallet manager's staged
credentials, the storage adapter's loaded-profile map, and the list of persisted schemas.

### Adding state for an account

1. **React state inside a provider under `AccountProviders.tsx`.** It is discarded on a remount.
   If it starts asynchronous work, that work must check it is still current before publishing.
2. **A `defineStore` store** with `scope: 'profile'` or `'session'`, when the state must be read
   outside React or kept on disk.
3. **A registered holder**, for a module-level cache or singleton that cannot be either of the
   above. This is the kind that leaks when forgotten, so it is the last resort.

## Upgrading from an older release

Nothing in this design may strand data written by v0.1.3 or earlier.

What the tests hold:

| Test                                                     | Holds                                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `releasedPersistedSurface.test.ts`                       | every store v0.1.3 declared is still declared under the same name, on the same kind of key, at no lower version; the SecureStore key names, database names and per-profile key format are unchanged. It compares declarations and source text, not behaviour |
| `releaseUpgrade.test.ts`                                 | hand-written blobs in the shape v0.1.0 wrote, for ten stores, survive migrate and merge and load through the real save-and-load path (over a mock disk) without being set aside. `routstr-store` is covered by its own test instead                          |
| `persistSchemaDrift.test.ts`, `persistRoundTrip.test.ts` | a recorded schema shape cannot change unnoticed, and every store's schema accepts that store's initial state as saved, plus chosen filled-in cases                                                                                                           |
| `globalMigrationsRunner.test.ts`                         | with the marker a released build wrote, the migration runner writes nothing and resolves, which is what lets the gate open                                                                                                                                   |

What was run on devices is in `PERFORMANCE.md`: v0.1.3's code created data on a fresh Android
emulator and a fresh iOS simulator (new wallets, two profiles), and the current code loaded over
it; everything inspected was still there. That was v0.1.3's JavaScript in the current native
build. The native storage modules are the same versions in both, but an upgrade from the released
binary on real phones, with real wallets in other states, has not been run.

Rules:

- Never change a store's name, a storage key format, a SecureStore key name or a database name.
- Never rename, remove or tighten a persisted field. Add fields with a default and tolerance.
- A limit belongs on the code that writes, never on the schema that reads. A stored blob the
  schema rejects is replaced by defaults (`profileStoreCapacity.test.ts`).
- A one-time storage migration keeps its own frozen list of names; it must not follow the live
  registry (`globalMigrations.ts`).
- A startup migration that fails stops the app on a retry screen with storage still closed.
- A store that cannot load its saved data does not destroy it: data that was read but rejected is
  copied to `<store>:unreadable` (for a per-profile store, `<store>:unreadable:profile:<pubkey>`)
  before the store's next save, and the save is refused unless a copy exists or the new one reads
  back; data that could not be read at all is left alone until a read succeeds. Caches that can be
  fetched again, and `routstr-store`, opt out.
- `routstr-store` moved its secrets into secure storage after v0.1.3. It still reads the key the
  old release wrote, copies the secrets across, verifies them, and only then strips the plaintext.
- On Android, AsyncStorage is capped at 6 MB in total and a row over about 2 MB cannot be read
  back. Large refetchable data goes in a file (`fileCacheStorage.ts`), not a store row.

## Where to look

| Question                                                                | File                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| What happens on switch, add, recover, remove, delete?                   | `app/shared/lib/profile/profileSessionOrchestrator.ts`                       |
| The lock, the disk guard and the shared restart steps                   | `app/shared/lib/profile/profileTransition.ts`                                |
| The in-process switch, step by step                                     | `app/shared/lib/profile/inProcessProfileSwitch.ts`                           |
| What removal checks and deletes                                         | `app/shared/lib/profile/profileRemovalStorage.ts`                            |
| How an account's keys and wallet phrase are found                       | `app/shared/lib/nostr/loadAccountKeys.ts`                                    |
| How the wallet opens, closes and is wiped                               | `app/shared/lib/cashu/manager.ts` (`initialize`, `cleanup`, `completeReset`) |
| Which credentials the next wallet opens with, and when they are cleared | `app/shared/lib/cashu/credentialStaging.ts`                                  |
| How a per-profile store finds its key, and when a save is dropped       | `app/shared/lib/cashu/profileScopedStorage.ts`                               |
| What every store's save-and-load options are                            | `app/shared/lib/persist/persistConfig.ts`                                    |
| Which providers remount with the account, and in what order             | `app/shared/providers/AccountProviders.tsx`                                  |
| Which startup stages block, and their order                             | `app/shared/providers/InitializationProvider.tsx`                            |
| When the splash comes down                                              | `app/shared/blocks/NativeSplashLayoutGate.tsx`                               |
| What an account owns outside React                                      | `app/shared/lib/account/accountRegistry.ts`                                  |
| Decisions                                                               | ADR 0029 (registry and switch), ADR 0030 (removal)                           |
| Known gaps                                                              | `docs/architecture/follow-ups.md` (F72, F76, F77, F79 to F83, F85)           |
