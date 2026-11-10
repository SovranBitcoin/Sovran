# Code surgery ledger

State, not history. Passes run in order; one call runs one pass.

| Pass                      | Status                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0 Pin behaviour           | **Done** (2026-11-11). Every boundary the surveys listed has a pin; the gates are closed. Branch `surgery/pass-0-gates`. |
| 1 Persisted state         | **Cut, awaiting merge** (2026-11-10). Branch `surgery/pass-1-cuts`. Proposal 3 awaits its plan. See "Pass 1".            |
| 2 Implicit state machines | Not started.                                                                                                             |
| 3 Deepen modules          | Not started.                                                                                                             |

Pass 0 is on branch `surgery/pass-0`; pass 1's evidence is on `surgery/pass-1` and its cuts on `surgery/pass-1-cuts`, each stacked on the one before (worktree `../sovran-surgery`,
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

## Gates (closed 2026-11-11)

Every survey-listed boundary that had no pin now has one, on branch `surgery/pass-0-gates` (stacked on
`surgery/pass-1-cuts`): 40 test files, 481 tests, each `describe` seen to fail under a broken variant in a throwaway
copy. Passes 2 and 3 may cut where a pin exists; a cut that reaches past a pin's stated limit pins first.

| Area                  | Test files (in `app/__tests__/` unless a path is given)                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup and accounts  | `appGateOrder`, `initializationGiveUp`, `accountSwitchBoundary`, `settingsRecoveryRun`, `paymentDeepLinkRouting`                                                                                                                          |
| Payments              | `sovranColadaProviderWiring`, `cocoQuoteFirstWrappers`, `cameraScanBoundary`, `paymentRouteReentry`, `nearbyDiscoveryLifecycle`, `useMempoolAcceleration`, `useOnchainMeltOutpointDiscovery`, `guardedRouterCooldown`, `useAmbientNfcArm` |
| Wallet package        | `wallet/__tests__/integration/operation-outcome-contract`, `wallet/__tests__/unit/use-screen-actions-hook`, `wallet/__tests__/unit/use-transaction-annotation-hook`                                                                       |
| Nostr                 | `nearbyPaymentDmRetry`, `useOwnRelayListSync`, `ownSyncLifecycle`, `giftWrapCache`, `nostrDataLayerMirror`                                                                                                                                |
| Feed                  | `app/features/feed/__tests__/homeFeedLoad`, `publishPoll`, `threadReplyPost`, `composerPost`, `app/features/feed/__tests__/useThreadPaging`, `postMenuActions`, `ownProfileSync`, `composerStore`                                         |
| Messaging and AI      | `whitenoiseDmSend`, `whitenoiseInboxRequests`, `bitchatSend`, `bitchatBridgeLifecycle`, `aiConversationBranchStream`, `mapCameraMerchantDetail`                                                                                           |
| Transactions and mint | `swapTransactionTotals`, `transactionsSwapTimeline`, `debouncedMintValidation`, `mintManagementCache`                                                                                                                                     |

Stated limits of these pins: Expo Router's own resolution of a passed-through `sovran://<token>`; multi-frame `ur:`
scans and scans dropped while busy; the ecash send screen beyond its route shell; advertised-request reuse in nearby
discovery; `RootLayout` is not rendered for the account switch; the spam-audit promotion in `useThread`; onchain and
bolt12 melts in the outcome contract; `useSetTransactionAnnotation` (needs the provider's context exported).

The pinning confirmed F175 and F178 by running them, and exposed the defects in F200 to F207.

## Behaviour changed in pass 0 (branch `surgery/pass-0`)

| Commit                   | Before                                                                                                         | After                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `29b6e02a0`              | A receive or mint-quote lookup returned another operation's history row when that row sat earlier in the page. | It returns its own row wherever it sits; the new-row fallback comes second.                        |
| `f88ab8518`, `176b4f4be` | Two wallet managers asking for the same standing quote at once shared the first one's quote and address.       | Each manager gets its own; a rotation that waited across a dispose stays visible to later callers. |
| `0d56568e4`              | A secret in an `Error` nested inside logged params was written to the log unredacted.                          | Nested errors get the same redaction as top-level ones.                                            |
| `536c7408e`, `0a1048295` | One startup recovery failing skipped every later recovery for that launch.                                     | Each recovery runs and fails on its own; "done" is logged only on success. Order unchanged.        |
| `36f0f53e9`              | A background send or melt confirmation always said "sat".                                                      | It uses the operation's unit.                                                                      |
| `b3e2cb871`              | A cancelled swap counted a failed leg that never sent anything as fees (510 instead of 10).                    | Only what left the wallet counts toward the fee; the header amount is unchanged.                   |
| `afd6bbdf5`              | A Whitenoise inbox whose cursor could not be read never started, with nothing logged.                          | The failure is logged and the inbox starts with a full backfill; other start failures are logged.  |

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

### Decisions (owner, 2026-11-10) and what was cut

Approved: every store repair (1, 4 to 9, 12), the 0.1.3 payment (2), emoji tokens (10), hiding `sovran:` from chat
(11, knowing a typed `sovran:` message will not show), a plan for the redeem queue shown before it is built (3), and
pushing with pull requests. Rule applied to every store: the reader accepts what a release could have written,
unaltered; limits apply to new writes. No key, version or field was renamed, removed or tightened.

| #   | Commit on `surgery/pass-1-cuts` | Before                                                                   | After                                                                                                                                              |
| --- | ------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `8729892fe`                     | An over-long cached name or picture emptied the account list             | Read as absent; new names clipped, an over-long picture not saved                                                                                  |
| 4   | `48cb8c4cb`                     | An over-long swap leg error emptied every swap                           | Read as absent; new errors clipped                                                                                                                 |
| 5   | `27933bf63`                     | A large contacts document emptied follows, likes and the rest            | Read whole, unaltered                                                                                                                              |
| 6   | `3f1f1d110`                     | A long own note emptied every own note                                   | Read whole                                                                                                                                         |
| 7   | `fbc5fb03f`                     | A 65th relay emptied the relay list                                      | Read whole; a new relay beyond 64 is refused with a message                                                                                        |
| 8   | `f4e8fd259`                     | A very long search emptied search history                                | Read whole; a new search over 2,048 is not recorded                                                                                                |
| 9   | `9d0a3041c`                     | An over-long mint name, icon or description emptied every mint's details | Read as absent for that mint; new ones clipped, an over-long icon not saved                                                                        |
| 12  | `92e1c9bd9`                     | An over-long restore error emptied the lifecycle record                  | Read as none; new errors clipped                                                                                                                   |
| 2   | `3c51c5642`, `11e05366d`        | A 0.1.3 payment to a Nostr request was refused on every poll             | Claimed when its id is, byte for byte, a request this wallet handed out; otherwise set aside and offered again when the wallet holds more requests |
| 10  | `1c1e525ee`, `99f3cf1e9`        | A token copied with 212 emojis could not be pasted back                  | Every picker emoji works; old copies are repaired only around a well-formed token                                                                  |
| 11  | `ae12658a2`                     | A `sovran:` message other than version 1 showed as chat                  | No `sovran:` message is stored or shown as chat; handlers still receive it                                                                         |

Reviewed commit by commit by Codex GPT-6.1 Sol: nine clean, two defects (a set-aside payment the inbox window could
pass; an emoji repair check that accepted a malformed token), both fixed in `11e05366d` and `99f3cf1e9`, which were
not re-reviewed. One nit left: a mint that changes to an over-long icon keeps showing its old icon.

`persistence-release-safety` for the eight store commits: every upgrade, capacity and resilience test passes and
every release fixture loads; **no real upgrade was run**, so by that skill's rule the verdict is INCONCLUSIVE, not
PASS. They sit in a pull request, not on `main`.

Remaining: F193 (after a restart, a 0.1.3 payment to a re-drawn request waits until it is shown again), F195 (native
bridges), F174 (redeem queue: plan below, not built), F192 (wallpaper and location limits).

Redeem queue plan (proposal 3), awaiting approval: read every saved token, mint address and unit whatever its length;
read over-long notes on an entry as absent; refuse an over-limit Bluetooth token before saving, as the message path
does; on start, merge a queue found under `:unreadable` back in by token hash and remove that copy only after the
merged queue is saved.

### Open findings from this pass

F191 to F193 and F195 to F199 in `docs/follow-ups/`. Money first: F193 (0.1.3 payments to a Nostr request sit in the sender's pending
send), F174 (redeem queue), F191 (account list), F197 (relay hints Sovran does not read; partly
inferred).

### Not verified in pass 1

- Nothing was run on a device. No proposal was checked on a phone, against a real mint or with a real 0.1.3 sender.
- The two review fixes (`11e05366d`, `99f3cf1e9`) were not reviewed by another model.
- Thirteen keycap emojis may draw as plain text when used as the carrier; not looked at on a phone.
- No real upgrade (old build, then this one, on a device) was run for the store changes.
- Native BitChat storage and the Nostr cache database contents have no upgrade test (F198).
- The surveys' "inferred" items: relay behaviour behind F197, other wallets' emoji decoders, whether any release
  published an `npubx.cash` address.
- The second opinion covered proposals 1 to 11, not 12.
