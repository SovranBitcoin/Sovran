# Code surgery ledger

State, not history. Passes run in order; one call runs one pass.

| Pass                      | Status                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| 0 Pin behaviour           | **Done for pass 1; gated for passes 2 and 3** (2026-11-10). See "Gates".                   |
| 1 Persisted state         | **Awaiting approval** (2026-11-10). Evidence added; no product code changed. See "Pass 1". |
| 2 Implicit state machines | Not started.                                                                               |
| 3 Deepen modules          | Not started.                                                                               |

Pass 0 is on branch `surgery/pass-0`; pass 1 is on `surgery/pass-1`, stacked on it (worktree `../sovran-surgery`,
based on `main` at `e5d70b590`). Neither is pushed. Until they merge, this file and the survey folders also sit
untracked in the main checkout so the next call finds them.

## How to observe the running app

- Jest (app, `jest-expo/node`) and Vitest (wallet, nostr) are the only observation used in pass 0.
- The native harness exists (`app/e2e`, stories and scenarios, `bun run e2e:story`), with a viewer
  (`bun run e2e:viewer`). It was **not** used: no simulator or emulator was booted and no device was attached, and
  this Mac had 8 to 11 GB of free disk with swap nearly full.
- In the default Jest preset components render as react-native-web elements, so text queries match nothing; tests
  read the rendered tree or testIDs.
- Broken variants are built in a throwaway copy of the repo (`cp -cR`, copy-on-write), never in a checkout.

## Baseline (main, `e5d70b590`)

App 680 suites, 7,821 passed, 2 skipped. Wallet 1,754 passed. Nostr 399 passed. App line coverage 71% of the files
tests load; 828 of 1,728 app source files are loaded by no app test (mostly routes, screens and UI).

## Inventory: boundaries and what pins them

Nine surveys, one per area, are in `pass-0/surveys/`. Each lists the area's boundaries, the test that pins each one
or NONE, ten candidates for passes 2 and 3 with file and line, defects, and what was not read. Counts are the
surveyors' own groupings.

| Area                                 | Survey                          | Boundaries | No test at survey time |
| ------------------------------------ | ------------------------------- | ---------- | ---------------------- |
| Wallet package                       | `wallet.md`                     | 61         | 8                      |
| Nostr package and app glue           | `nostr.md`                      | 48         | 6                      |
| Send, receive, payments, NFC         | `payments.md`                   | 40         | 9                      |
| Signer, Whitenoise, BitChat, AI, map | `signer-messaging-ai.md`        | 46         | 14                     |
| Stores and persistence               | `stores-persistence.md`         | 42         | 5                      |
| Transactions, wallet, mint           | `transactions-wallet-mint.md`   | 44         | 9                      |
| Settings, onboarding, routes         | `settings-onboarding-routes.md` | 42         | 9                      |
| Feed and social                      | `feed-social.md`                | 44         | 13                     |
| Shared hooks, UI, lib                | `shared.md`                     | 52         | 16                     |

### Pinned in pass 0 (29 test files, 322 tests, each seen to fail under a broken variant)

All in `app/__tests__/`. A `// QUIRK:` comment marks behaviour pinned as it is although it looks wrong.

| Boundary                                                  | Test file                                   |
| --------------------------------------------------------- | ------------------------------------------- |
| Payment status listener, every wallet event               | `paymentStatusListener.test.tsx`            |
| Rebalance wallet port                                     | `rebalanceWalletPort.test.ts`               |
| Rebalance run lifecycle                                   | `mintRebalanceRunLifecycle.test.ts`         |
| Coco startup phase 2                                      | `cocoProviderPhase2.test.tsx`               |
| Redeem queue and an oversize entry                        | `nutDropRedeemQueueOversize.test.tsx`       |
| App rollback (`attemptRollback`)                          | `cashuRollbackBoundary.test.ts`             |
| Restore gate decision table                               | `restoreGateDecision.test.tsx`              |
| Share route params                                        | `shareRouteParams.test.ts`                  |
| Identity name precedence                                  | `identityName.test.ts`                      |
| Mint info https guard and check                           | `apiClientMintInfo.test.ts`                 |
| Keyring import                                            | `keyringImport.test.tsx`                    |
| Delete Account result handling                            | `deleteScreen.test.tsx`                     |
| Own-events sync                                           | `useOwnEventsSync.test.tsx`                 |
| Wallet provider lifecycle and deep links                  | `walletProviderLifecycle.test.tsx`          |
| Reusable mint quote hook                                  | `walletReusableMintQuoteHook.test.tsx`      |
| Standing payment request hook                             | `walletStandingPaymentRequestHook.test.tsx` |
| Contact token publisher (gift wrap)                       | `publishGiftWrappedDM.test.ts`              |
| Profile balance sync                                      | `profileBalanceSync.test.tsx`               |
| Profile store actions                                     | `profileStoreActions.test.ts`               |
| Wallet lifecycle transitions                              | `walletLifecycleTransitions.test.ts`        |
| Hand-written `profile-store` writers agree with the store | `profileStoreSideWriters.test.ts`           |
| Decrypted-message cache                                   | `pubkeyScopedCache.test.ts`                 |
| Settings setters and migrate                              | `settingsStoreSetters.test.ts`              |
| Whitenoise storage, DM index, history                     | `whitenoiseStorage.test.ts`                 |
| BitChat durable delivery store                            | `bitchatDmMessages.test.ts`                 |
| Routstr top-up                                            | `routstrTopUp.test.ts`                      |
| Zap start                                                 | `useZapStart.test.tsx`                      |
| Fixed-amount ecash receive screen                         | `receivePaymentRequestQuoteScreen.test.tsx` |
| NFC session                                               | `nfcSessionBoundary.test.ts`                |
| Theme draft commit                                        | `themeDraftCommit.test.ts`                  |

Limits of these pins: `whitenoiseStorage` uses a JSON stand-in for the marmot-ts rumor codec;
`receivePaymentRequestQuoteScreen` uses stand-ins for its presentational children; the restore gate's own hydration
wait could not be isolated (AppGate's reinstall check waits first); `forgetWalletDatabases`, a fourth hand-written
`profile-store` writer, is exercised but not asserted.

## Gates

Pass 1 touches stores, migrations and wire formats. Those boundaries are pinned by the existing upgrade tests
(`cd app && bun run test:upgrade`) plus the store tests above.

Passes 2 and 3 may only cut where the boundary is pinned. These survey-listed boundaries still have **no** pin; pin
first (same rules: passes today, seen to fail) before any cut touches them:

- **Startup and accounts:** AppGate rendered order; `InitializationProvider` stages when a profile flow gives up;
  `AccountSwitchBoundary` and provider order; `SettingsRecoveryScreen` run; payment deep links through the route tree.
- **Payments:** `SovranColadaProvider` assembled wiring; quote-first wrappers in `cocoOperations.ts`; camera scan
  orchestration; route re-entry for pending send, melt and receive; nearby discovery lifecycle;
  `useMempoolAcceleration`; `useOnchainMeltOutpointDiscovery`; `guardedRouter` cooldown; `useAmbientNfcArm`.
- **Wallet package:** operation outcome contract against a real Manager; `useScreenActions`;
  `useColadaTransactionAnnotation`.
- **Nostr:** prepared payment-request DM retry; `useOwnRelayListSync`; `useOwnSocialGraphSeed`; `useMuteListSync`;
  gift-wrap cache wrapper; data-layer durable mirror.
- **Messaging and AI:** Whitenoise DM create/send, inbox and requests; BitChat send and bridge lifecycle; AI
  conversation branch and streaming; map camera and merchant detail.
- **Feed:** HomeFeed loader; poll publish path; reply bar and composer post flows; `useThread` paging;
  `usePostActions`; `useModerationActions`; `ownProfileSync`; `composerStore`.
- **Transactions and mint:** swap detail totals; swap-group injection and sections in `Transactions.tsx`;
  `useDebouncedMintValidation`; `useMintManagement` cache.

## Behaviour changed in pass 0 (branch `surgery/pass-0`)

| Commit                   | Before                                                                                                         | After                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `29b6e02a0`              | A receive or mint-quote lookup returned another operation's history row when that row sat earlier in the page. | It returns its own row wherever it sits; the new-row fallback comes second.                        |
| `f88ab8518`, `176b4f4be` | Two wallet managers asking for the same standing quote at once shared the first one's quote and address.       | Each manager gets its own; a rotation that waited across a dispose stays visible to later callers. |
| `0d56568e4`              | A secret in an `Error` nested inside logged params was written to the log unredacted.                          | Nested errors get the same redaction as top-level ones.                                            |
| `536c7408e`, `0a1048295` | One startup recovery failing skipped every later recovery for that launch.                                     | Each recovery runs and fails on its own; "done" is logged only on success. Order unchanged.        |
| `36f0f53e9`              | A background send or melt confirmation always said "sat".                                                      | It uses the operation's unit.                                                                      |

Reverted: `2b9834542` (keep the key import sheet open on an invalid key) had no effect in the real sheet; see F176.

## Open findings

Filed as follow-ups F173 to F190 (`docs/follow-ups/`), not fixed, each with its reason. The ones that involve money
or saved data:

- **F173** A Balance split in a unit other than sat reads sat balances, fees and proofs. Owner's choice of repair.
- **F174** A Bluetooth token over the queue's limits empties the redeem queue on the next launch. Saved data.
- **F175** Giving up a profile flow after the splash closes the wallet and leaves a blank app. Traced, not run.
- **F178** Forced recovery: timed-out mints keep restoring; two states have no way out.
- **F180** Standing-quote work that outlives a profile switch can write into the next profile. Saved data.
- **F181** A receive lookup can adopt another operation's row when its own is not saved yet.

Quirks pinned but not filed, for the owner to rule on:

- The payment status listener confirms any processing payment-request toast when an unrelated send finishes, and
  matches a melt toast by variant alone.
- Transaction rows always show USD whatever the display currency; the wallet header pill always shows sats; ambient
  NFC auto-pay keeps running during a swap.
- A restart turns BitChat messages marked sent into failed; a late failure overrides delivered.
- A settings blob already at version 4 never re-runs the developer reset, and that reset misses five flags.
- A restore error over 500 characters would make the next launch discard the wallet lifecycle record (no caller
  passes one today).

## Not verified

- Nothing was run on iOS or Android. Every fix and every pin is Jest or Vitest only.
- Defects marked "traced" or "read" in the follow-ups were not reproduced at runtime.
- The surveys did not read every file; each lists what it skipped (most of `shared/ui`, large screens such as
  NearPay and UserProfile, native modules, vendored code).
- `jevlint` saved checks were not run for the families the fixes touch (`payments-*`, `wallet-*`, `secrets-*`,
  `state-*`).
- No fix was checked against a live mint, a funded wallet or a real profile switch.

## Pass 1: persisted state

### Inventory

The repo's own record is the inventory: `docs/architecture/persistence/persistence-map.md` (every durable thing by
epoch, with a "Corrections and additions, 2026-11-10" section from this pass), `release-provenance.md` and
`store-builds.tsv` (456 store builds; refreshed on 2026-11-10 with no change; latest release 0.1.3 at `d9ad12c4b`).
Four surveys in `pass-1/surveys/` checked it against `main`:

| Survey                       | Covers                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `stores.md`                  | All 45 persisted stores: key, scope, version, failed-read behaviour, every read limit against the released writers |
| `secrets-databases-files.md` | SecureStore, SQLite, AsyncStorage keys outside stores, files, native storage, library versions, derivation         |
| `wire-formats.md`            | 25 formats another install, wallet, relay or the OS can hand back; each compared with 0.1.3                        |
| `fixture-coverage.md`        | Every row of the map against the release fixtures and tests; the state space the fixtures do not hold              |

Facts that later passes rely on:

- Every persisted store carries a version. Keys outside stores mostly do not (listed in the second survey).
- Storage libraries, Coco and the key derivation paths are unchanged since 0.1.3.
- Every release epoch has a fixture (E01 to E20) and every Coco version that shipped has a database; 983 upgrade
  tests pass (`cd app && bun run test:upgrade`).
- Not inventoried: BitChat's vendor storage (sources not in the checkout), and the 99 builds from 2024 (F138).
- `persistSchemaDrift` does not see a `.catch()` being added or removed, so it cannot guard read tolerance.

### Evidence added (all in `app/__tests__/`, each seen to fail under a changed variant)

| What is pinned                                                                                                  | File                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Nine stores that load as defaults when one saved value is over the reader's limit                               | `releasedWriterBounds.test.ts`                                                               |
| A 0.1.3 payer's payment-request payload at today's receiver, against the real Coco                              | `paymentRequestReleasedPayer.test.ts`                                                        |
| The emoji token codec with the real codec, all 1,341 picker emojis                                              | `emojiTokenRoundTrip.test.ts`                                                                |
| Which `sovran:` Bluetooth messages stay out of chat                                                             | `bitchatSovranPrefixSuppression.test.tsx`                                                    |
| An upgrade from 0.1.3 with a restore pending, running or failed                                                 | `releaseFixtureRestoreInFlight.test.ts`                                                      |
| What 0.1.4 writes outside the store registry (journal, SDK vault, Whitenoise rows, new profile and swap fields) | `releaseFixtures/E20-0.1.4.ts`, `E20-0.1.4.records.json`, `releaseFixtureE20Records.test.ts` |
| The Nostr cache library's version                                                                               | `persistenceSurface.test.ts`                                                                 |

`releaseFixtureRestoreInFlight` and `releaseFixtureE20Records` are not in the `test:upgrade` script (that needs a
`package.json` edit); they run with the full suite.

### Proposed changes, awaiting the owner's approval item by item

None is made. Each changes how saved data or a wire message is read, so each needs the `persistence-release-safety`
verdict when it is built. "Tried" means in a throwaway copy with every upgrade, capacity and resilience test passing.
The reviewer is Codex GPT-6 Astra, given the code and the tests; its changes are folded into the shapes below. None
of these helps a downgrade: older builds keep their limits.

| #   | Change                                                                                                                                                                                                  | Follow-up | Proof today                                                              | Reviewer                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1   | `profile-store`: an over-long cached name or picture is read as absent instead of rejecting the account list. New writes: clip the name, drop an over-long picture                                      | F191      | Tried                                                                    | Sound, with the write cap added                                             |
| 2   | Receiver accepts a 0.1.3 payer's payload: when the `id` is an encoded request that exactly matches a request this wallet holds, use that request's id. Stop re-offering a payload Coco refuses for good | F193      | Built (exact match, integer-safe); F193 keeps the after-restart gap      | Sound only with the exact match and integer-safe parsing                    |
| 3   | `nut-drop-redeem-queue`: read every token a release could have saved, unclipped; park a record that cannot be processed instead of dropping it; recover queues already under `:unreadable`              | F174      | **Unproven.** Needs a design                                             | A drop-on-failure record is unsound here: tokens are money                  |
| 4   | `swap-transactions-store`: an over-long leg error is read as absent; new errors clipped. Groups are never dropped                                                                                       | F192      | Tried                                                                    | Sound, without dropping groups                                              |
| 5   | `nostr-social-store`: no read limit on the contacts document or its tags; never truncated                                                                                                               | F192      | Tried                                                                    | Sound                                                                       |
| 6   | `own-content-store`: no read limit on a note's content                                                                                                                                                  | F192      | Tried                                                                    | Sound; dropping the note instead is rejected                                |
| 7   | `nostr-relay-list-store`: lists over 64 are read; the limit applies to every way of adding; a long list stays editable                                                                                  | F192      | Read side tried                                                          | Sound, with all growth paths capped                                         |
| 8   | `search-history-store`: long searches are read; new ones capped                                                                                                                                         | F192      | Tried                                                                    | Sound                                                                       |
| 9   | `mint-metadata-store`: an over-long name, icon or description is read as absent for that mint                                                                                                           | F192      | Tried                                                                    | Sound but narrow: other fields can still reject                             |
| 10  | Emoji tokens: strip the emoji's own U+FE0F before encoding; on decode try as today, then without the leading byte only if the rest is a whole valid token                                               | F194      | Decode side tried in simple form                                         | Sound in that shape; cashu.me reads the new output, other wallets unchecked |
| 11  | Keep the whole `sovran:` namespace out of BitChat chat, in JavaScript and both native bridges, while still delivering it to the payment handlers                                                        | F195      | Not tried                                                                | Sound, but a person can type `sovran:hello`: a product call                 |
| 12  | `wallet-lifecycle`: an over-long restore error is read as null                                                                                                                                          | F192      | Tried                                                                    | Not reviewed separately                                                     |

Not proposed: the wallpaper catalog limits (not shown to be reachable) and `transaction-location-store`'s 256-character
key (the reviewer's addition; no caller shown to produce one). Both are in F192. Nothing at a storage boundary was
found safe to delete.

### Open findings from this pass

F191 to F199 in `docs/follow-ups/`. Money first: F193 (0.1.3 payments to a Nostr request sit in the sender's pending
send), F174 (redeem queue), F191 (account list), F194 (emoji tokens), F197 (relay hints Sovran does not read; partly
inferred).

### Not verified in pass 1

- Nothing was run on a device. No proposal was checked on a phone, against a real mint or with a real 0.1.3 sender.
- No proposal is built in the worktree; the throwaway-copy trials were simple forms, not the reviewed shapes.
- The `persistence-release-safety` verdict was not run: no change to saved data was made.
- Native BitChat storage and the Nostr cache database contents have no upgrade test (F198).
- The surveys' "inferred" items: relay behaviour behind F197, other wallets' emoji decoders, whether any release
  published an `npubx.cash` address.
- The second opinion covered proposals 1 to 11, not 12.
