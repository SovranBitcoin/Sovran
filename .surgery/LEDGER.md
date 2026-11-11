# Code surgery ledger

State, not history. Passes run in order; one call runs one pass.

| Pass                      | Status                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Pin behaviour           | **Done** (2026-11-11). Every boundary the surveys listed has a pin; the gates are closed. Branch `surgery/pass-0-gates`.                                             |
| 1 Persisted state         | **Done** (2026-11-11), proven on every release fixture; no real upgrade was run. Cuts on `surgery/pass-1-cuts` and `surgery/pass-1-queue`, not merged. See "Pass 1". |
| 2 Implicit state machines | **Done** (2026-11-11). All sixteen approved conversions built on `surgery/pass-2` (one partly: the machine turn); not merged, nothing run on a device. See "Pass 2". |
| 3 Deepen modules          | **Done** (2026-11-12). Groups A and B cut on `surgery/pass-3`: product code down 3,687 lines; not merged, nothing run on a device. See "Pass 3".                     |

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

### Pinned in pass 0 (29 test files at the time; the Routstr top-up one was deleted with its code in pass 2; 322 tests, each seen to fail under a broken variant)

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

| Commit                   | Before                                                                                                         | After                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `29b6e02a0`              | A receive or mint-quote lookup returned another operation's history row when that row sat earlier in the page. | It returns its own row wherever it sits; the new-row fallback comes second.                                                       |
| `f88ab8518`, `176b4f4be` | Two wallet managers asking for the same standing quote at once shared the first one's quote and address.       | Each manager gets its own; a rotation that waited across a dispose stays visible to later callers.                                |
| `0d56568e4`              | A secret in an `Error` nested inside logged params was written to the log unredacted.                          | Nested errors get the same redaction as top-level ones.                                                                           |
| `536c7408e`, `0a1048295` | One startup recovery failing skipped every later recovery for that launch.                                     | Each recovery runs and fails on its own; "done" is logged only on success. Order unchanged.                                       |
| `36f0f53e9`              | A background send or melt confirmation always said "sat".                                                      | It uses the operation's unit.                                                                                                     |
| `b3e2cb871`, `65a1d7022` | A cancelled swap counted a failed leg that never sent anything as fees (510 instead of 10).                    | A failed leg with neither side in the history is left out of the fee; the header amount is unchanged.                             |
| `afd6bbdf5`, `fcdda8456` | A Whitenoise inbox whose cursor could not be read never started, with nothing logged.                          | The failure is logged and the inbox starts with a full backfill, leaving the saved cursor alone; other start failures are logged. |

Reverted: `2b9834542` (keep the key import sheet open on an invalid key) had no effect in the real sheet; see F176.

## Open findings

Filed as follow-ups (`docs/follow-ups/`, from F173 on), not fixed, each with its reason; the redeem queue's has since
been repaired. The ones that involve money or saved data:

- **F173** A Balance split in a unit other than sat reads sat balances, fees and proofs. Owner's choice of repair.
- A Bluetooth token over the queue's limits emptied the redeem queue on the next launch. Saved data. Repaired on
  `surgery/pass-1-queue` (below).
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
bridges), F192 (wallpaper and location limits).

Redeem queue (proposal 3), approved on 2026-11-11 and built on `surgery/pass-1-queue` (`a73ea88f1` to `06e2585c8`):
every saved token, mint address and unit is read whatever its length; over-long or wrong-typed notes on an entry read
as absent; an over-limit Bluetooth token is refused before saving, with the message path's check; after a load, a
queue found under `:unreadable` is merged back in by token hash, saved, read back, and only then is the copy removed.
The queue records which copy it merged (`recoveredCopy`, a new optional field), so a copy whose removal failed is not
merged twice. Reviewed by Codex GPT-6.1 Sol: two defects in the merge-back, fixed in `06e2585c8` (not re-reviewed).
Still loads empty, with its bytes kept aside as before: a queue with an entry that has no token or mint address, or a
broken amount, attempt count or time. The review also found F208, older than this work: a second rejected blob is
overwritten when an earlier set-aside copy still exists. No real upgrade was run.

### Open findings from this pass

F191 to F193 and F195 to F199 in `docs/follow-ups/`. Money first: F193 (0.1.3 payments to a Nostr request sit in the sender's pending
send), F191 (account list), F197 (relay hints Sovran does not read; partly
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

## Pass 2: implicit state machines

Branch `surgery/pass-2`, stacked on `surgery/pass-1-queue`. Three lanes were built in parallel worktrees and merged
into it. Not pushed until the owner says so; not merged.

### Inventory

Eight surveys in `pass-2/surveys/` (the brief is in its `README.md`). Each candidate there has its variables, states,
events, the meaningless combinations, which were reachable and how, whether it is saved, its consumers, its pins and
a recommendation. They describe the code before this pass; several machines appear in two surveys.

| Area                                | Survey                        | Candidates |
| ----------------------------------- | ----------------------------- | ---------- |
| Wallet package                      | `wallet.md`                   | 13         |
| Send, receive, payments, NFC        | `payments.md`                 | 13         |
| Stores and persistence              | `stores.md`                   | 15         |
| Startup, accounts, providers        | `startup-accounts.md`         | 12         |
| Transactions, wallet screens, mints | `transactions-wallet-mint.md` | 12         |
| Messaging, signer, AI, map          | `messaging-signer-ai.md`      | 12         |
| Feed, social, Nostr package         | `feed-social-nostr.md`        | 15         |
| Shared hooks, UI, lib, settings     | `shared-settings.md`          | 11         |

The house pattern for an explicit machine is `wallet/src/machine`: named steps, data that moves with its step, a pure
`transition`, effects that return a tagged result, and a generation counter that drops stale results. No XState in
the repo. Every conversion below follows it: a tagged union for a value, a table for synchronous moves, that
hand-written shape for async work. The builders' brief is `pass-2/CONVERSION-BRIEF.md`.

### Decisions (owner, 2026-11-11)

- All sixteen conversions approved.
- Follow: build the full repair. A follow is accepted on the phone at once and is published only on top of the
  contact list that a complete read of every write relay just returned; otherwise it waits.
- Bluetooth message: a delivery report that arrives after the 15 second mark wins.
- Payment routing: delete the AI top-up branch of Send.

### Conversions

"Saved" means the shape on disk is as it was and the states are decoded where it is read. No saved field, key,
version, enum value or wire format changed in this pass.

| #   | Machine                        | Where the states live now                                                   | Saved | Outcome                                                                                                        |
| --- | ------------------------------ | --------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Own follow list                | `app/shared/lib/nostr/followSync.ts`, `nostrSocialStore.ts` (`ContactList`) | yes   | Converted. One worker per account plans `idle, wait, ask-indexers, already-applied, publish`.                  |
| 2   | Payment preview phase          | `wallet/src/machine/types.ts`, `screen-actions/paymentRequestPhase.ts`      | no    | Converted. `preview, settled, undelivered`; one decoder for the screen entry.                                  |
| 3   | Swap group and legs            | `app/shared/lib/cashu/swapGroupPhase.ts`, `swapTransactionsStore.ts`        | yes   | Converted. Group `running, interrupted, finished, cancelled`; leg and group move tables; one outcome function. |
| 4   | Recovery run                   | `app/features/settings/lib/recoveryRun.ts`, `recoveryProgress.ts`           | no    | Converted. `idle, running, cancelling, finished`; per-mint outcomes.                                           |
| 5   | AI answer                      | `app/features/ai/lib/turns.ts`                                              | yes   | Converted. One turn per answer: `asking, streaming, done, failed, interrupted`.                                |
| 6   | Bluetooth DM delivery          | `app/features/bitchat/stores/bitchatDmMessages.ts`                          | yes   | Converted. One move table; `unconfirmed` decoded from saved `failed` with reason `timeout` or `app_restart`.   |
| 7   | Redeem queue entry             | `wallet/src/transport/redeemEntry.ts`                                       | yes   | Converted. One status list, one decode, one move table the store enforces.                                     |
| 8   | Wallet manager                 | `app/shared/lib/cashu/manager.ts` (`WalletLife`)                            | no    | Converted. `closed, opening, ready, closing`; every open joins the one open.                                   |
| 9   | Restore status                 | `app/shared/stores/global/walletRestorePhase.ts`                            | yes   | Converted. One decode, four named questions; the readers' disagreements kept and named.                        |
| 10  | The turn around a machine step | `wallet/src/machine/createMachine.ts` ("Turn")                              | no    | Partly. One way in, one way out; not one tagged value (two exit shapes and the generation counter remain).     |
| 11  | Follow button intent           | with 1                                                                      | yes   | Converted. The saved intent is the desired state; the worker resumes it.                                       |
| 12  | Notification sources, own sync | `nostr/src/facade/session/notifications-session.ts`, `useOwnEventsSync.ts`  | no    | Converted. Per-source `pending, ready, backoff, exhausted, unsupported, failed-first-page`; one sync session.  |
| 13  | Payment toast                  | `app/shared/stores/runtime/paymentStatusStore.ts`                           | no    | Converted. A toast has an owner: `pending(key), melt(quote), send(operation)`.                                 |
| 14  | White Noise DM screen          | `app/features/whitenoise/hooks/useWhitenoiseDM.ts`                          | no    | Converted. One reducer: `closed, loading, reading-history, ready, creating-group, failed`.                     |
| 15  | NFC session                    | `createMachine.ts` (`NfcTap`), `app/shared/lib/nfc/reader.ts`               | no    | Converted. One tap value ended in one place; one reader hold `idle, ambient, explicit`.                        |
| 16  | Payment routing                | `app/shared/stores/runtime/sendRoute.ts`                                    | no    | Converted. `nearby, contact, handOff`; the AI top-up branch and its helpers deleted.                           |

Product code grew in most conversions (named states, exhaustive switches and the rules that did not exist before);
it shrank in 5 and 16. Deferred and left candidates are as each survey lists them.

### Behaviour changed in pass 2

Each has a test that failed first. Grouped by what the person sees; the commits are on `surgery/pass-2`.

Paying:

- A payment-request send that failed before any ecash existed showed as sent; it now stays a preview and can be
  retried. One that was delivered stays delivered when its history row cannot be read.
- A paid melt, a delivered or undelivered payment request, a finished ecash send and a paid NFC tap are final for
  their flow: opening or re-picking the mint, entering an amount, choosing an option, a mint review or a second Pay
  can no longer send the same payment again. Before, each of those could.
- Ecash that left and could not be taken back no longer leads to another payment option or a second send. An NFC
  token written to the tag is recorded as delivered even if closing the tag session then fails; a write that failed
  and could not be rolled back says the payment may have reached the terminal and keeps nothing to resend.
- An event a step does not handle no longer wipes the step's data. A listener or notification that throws no longer
  leaves the machine locked. Fallback history entries carry the unit paid, not always sat.
- An NFC tap that stops or throws releases the tag and switches the unit back; an overtaken tap cleans up only what
  is still its own and rolls back a token it created and did not write. On an explicit Tap to pay, the scan's own
  sheet close no longer cancels the tag session (Android; not run on a phone).
- The wallet is handed out only after its plugins start; a failed open closes the database it opened.
- A payment toast changes only for its own payment; another payment's result is held and shown after it.

Swaps and recovery:

- A swap that throws, is aborted or is killed no longer stays Pending for ever: its group closes, and after a
  restart it is settled from its own melt and mint operations. A retry reopens the group and the toast.
- A swap shows Pending while any leg can still move, Failed only when nothing can and the transfer did not arrive.
- A melt whose outcome is unknown is no longer failed with its proofs returned (which allowed a second payment); it
  stays payment-pending until the mint's answer or Coco's saved state shows it did not pay.
- A cancelled reroute no longer resumes beside another swap. A run stops before a new leg once the account changed.
- Recovery deletes pending mint operations only for mints it restored, and only those pending before the run; before,
  it deleted all of them. A timed-out mint stays timed out and is never untrusted; Stop holds for its run for good.

Messages, follows, feed, AI:

- Follow: tapping Follow could replace the whole public follow list with one entry. It now publishes only on top of
  the list a complete read of every write relay returned, to exactly those relays, once this session's relay-list
  discovery has answered; otherwise the follow waits and is retried. A follow interrupted by an app kill resumes. A
  contact list or profile older than a year now arrives; another account's contact list is refused.
- Own events are no longer written into another account's stores after an in-process switch; the own-profile
  tie-break is the same however events arrive in batches.
- One failed load-more no longer ends notification paging.
- After the last review's repairs: sending again from the amount screen after an ecash send starts a new send; a
  tap's token is not rolled back once its write has started; "rolled back" is reported only when it is known; only
  mint error codes that prove a melt was refused free its ecash; a swap leg given up before its melt was sent is
  cancelled in Coco before it is called failed; a failed swap transfer is replaced only by a route that carried its
  amount; relay-list discovery needs every asked relay to answer and never reads the cache; an AI send stops for good
  once its conversation or account changed; a White Noise group whose invitation failed is reused.
- Bluetooth: one retry per failed message for the session; a delivered or read report wins over a timeout, a restart
  or a failure; a Nut Drop arriving during a redeem run gets one more run; a duplicate intake can no longer park a
  token that is being redeemed; a queue move with no meaning is refused.
- White Noise: no send until the conversation has loaded for this client and peer; after a failed load a send reads
  again first; a failed setup shows its error.
- AI: an answer is written to the conversation that asked for it; leaving the screen keeps what arrived, with Retry;
  a send or retry sends nothing if the conversation, the account or the screen changed while it was preparing.
- Smaller: a failed onchain address rotation is retried; a closed DM feed's error clears; the newest keyset read
  wins; acceleration polling stops with its screen; a cancelled theme Apply applies nothing.

### Models and review

Surveys: Claude Opus 5.5 (four areas), Codex GPT-6.1 Sol and GPT-6 Astra (two each). Builds: Claude Opus 5.5; small
review fixes and the merge: Claude Fable 5.2. Every build was reviewed commit by commit by Codex GPT-6.1 Sol or GPT-6
Astra from the diff and the tests; each review found defects, most of them older bugs the named states exposed, and
each was followed by a fix run. The owner then asked for what the last review left to be repaired (2026-11-11): it
was, in two more rounds, each reviewed by Codex. What those reviews still found is filed as F238 (payments, NFC,
swaps: money first) and F239 (follow, AI, recovery, toast). The reviews did not converge to nothing: each round found
fewer and narrower gaps, most of them older than this pass.

`persistence-release-safety` for the store-touching conversions (1, 3, 5, 6, 7, 9, 11): every upgrade test passes,
the schema drift snapshots are unchanged and every release fixture loads; **no real upgrade was run**, so the verdict
is INCONCLUSIVE, not PASS.

### Open findings from pass 2

In `docs/follow-ups/`: F213, F216, F218, F220 to F234, F238, F239. Highest: F238 (above), F227 (a follow can wait for ever with nothing on
screen saying so), F228 (the NFC and Tap to pay changes have not been run on a phone), F230 (swap leftovers, among
them upgraded legs that cannot reach done and proofs that can stay reserved), F232 (AI answer text not saved across
a kill).

### Not verified in pass 2

- Nothing was run on iOS or Android. The NFC and Tap to pay changes in particular are proven only against mocks.
- No real upgrade (old build, then this one) was run.
- No change was checked against a live mint, live relays, a funded wallet or the AI provider.
- The surveys are traces unless they say "run".
- `jevlint` saved checks were not run. `audit-commit` was not run per commit; the Codex reviews stood in.
- Some intermediate commits do not type-check on their own (each is fixed by the commit after it); the branch head
  passes every check.

## Pass 3: deepen modules

Branch `surgery/pass-3`, stacked on `surgery/pass-2`. Product code at the start of the pass: 373,414 lines (app,
wallet and Nostr sources without tests). The pass is done when that number went down and each cut removed something
a caller had to know.

### Inventory

Eight surveys in `pass-3/surveys/` (the brief is in its `README.md`). Each candidate has its callers, the obligation
they carry, the proposed shape, the deletion test, the lines it deletes, its risk, its pins and its size.

| Area                                | Survey                        | Candidates |
| ----------------------------------- | ----------------------------- | ---------- |
| Wallet package                      | `wallet.md`                   | 15         |
| Send, receive, payments, NFC        | `payments.md`                 | 10         |
| Stores and persistence              | `stores.md`                   | 13         |
| Startup, accounts, settings         | `startup-settings.md`         | 10         |
| Transactions, wallet screens, mints | `transactions-wallet-mint.md` | 11         |
| Messaging, signer, AI, map          | `messaging-signer-ai.md`      | 15         |
| Feed, social, Nostr package         | `feed-social-nostr.md`        | 12         |
| Shared hooks, UI, lib               | `shared.md`                   | 10         |

Facts the surveys established: `bun run knip` does not see unused exports of the wallet package's own entry files,
unused store actions (they are members, not exports), or code only tests import; the surveys found those by counting
callers. `createMachine.ts` should lose its pure NFC rules to their own module and gain one `advance(event)` helper;
its turn functions and settled-step table should stay where they are.

### Decisions (owner, 2026-11-12)

Groups A and B approved. Group C not approved: each row needs a ruling first. The builders' brief is
`pass-3/CUT-BRIEF.md`.

### Cuts made

Product code went from 373,414 to 369,727 lines (app, wallet and Nostr sources without tests). Every cut kept
behaviour; nothing saved or sent changed.

| #   | Cut                                                                                                     | Outcome                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Nostr package: capability cache and request builders nothing sends                                      | Deleted (about 950 lines); the capability-cache follow-up is closed                                                             |
| A2  | Wallet: hooks, options and flow definitions with no caller; the loader's page mode                      | Deleted (about 650)                                                                                                             |
| A3  | BitChat: TypeScript nothing calls                                                                       | Deleted (about 330); native side untouched                                                                                      |
| A4  | Routstr: API-key readers and branches unreachable since the top-up was deleted                          | Deleted (about 190); saved key, archive, migration and reclaim untouched                                                        |
| A5  | Wallet: `inspect()` fields no screen reads; the machine's trust-mint path                               | Deleted (about 360); `inspect()` returns `step`, `isExecuting`, `details`                                                       |
| A6  | Store actions and runtime state with no caller                                                          | Deleted (about 150); the four that look like missing features stay (C3)                                                         |
| A7  | Small dead parameters and surface                                                                       | Deleted (about 150)                                                                                                             |
| B1  | One way to wait for a store to load                                                                     | Made: `useStoreLoad`, `useStoreLoadLatched`, `useStoreLoadOutcome`, `onceLoaded`, `whenLoaded` in `persist/hydrationOutcome.ts` |
| B2  | One reader for the active account's key and one capture                                                 | Made: `selectActivePubkey`, `activePubkey()`, `captureActiveProfile` in `profileStore`                                          |
| B3  | One transaction filter value and route codec                                                            | Made, in `TransactionsFilterContext`                                                                                            |
| B4  | `HomeFeed` page 0 on `useCachedRead`                                                                    | Not made: it would change what is fetched and when (F242); pins added                                                           |
| B5  | `ColadaProvider` props that duplicate the instance                                                      | Made (about 230 lines); the second owner of the wallet context stays (F242)                                                     |
| B6  | Machine: one `advanceNfc`, one `previewStep`                                                            | Made; `nfcTap.ts` and the lock-pubkey mirror not made (longer, or tests would change)                                           |
| B7  | History and mint screens: sections, swap legs, chain grouping, mint pill and smalls                     | Seven of nine made                                                                                                              |
| B8  | Own replaceable events: one `signOwnEvent`, one `created_at` rule, `supersedes` everywhere              | Made; the follow list's pre-sign check and the profile's signing step keep their differences                                    |
| B9  | AI: one `selectLineup` and `useSelectedModel`                                                           | Made; the picker's different rule for an empty lineup is kept and pinned (F241)                                                 |
| B10 | `useBitChat` as one transport table with bubble-ready rows and retry                                    | Made                                                                                                                            |
| B11 | Startup: one migration gate, one `STAGES` table, one timeout helper, no splash options, disk guard      | Five of eight made                                                                                                              |
| B12 | Shared UI: toasts, search input, cached reads, read policy, pill sizes, popup type                      | Six of eight made                                                                                                               |
| B13 | Payments: receive capability and routes, DM inbox fetch and caches, one `prepareMintQuote`, camera scan | Eight made, the receive rails only in part                                                                                      |
| B14 | Messaging and map: `useMerchantMap`, blocked-conversation guard, White Noise teardown and relays        | Five made; signer leases and one setup owner skipped (they change behaviour, F225 and F241)                                     |

Group C stands as proposed: C1 (wallet entry files export 344 names nothing imports: is the package meant to be
published?), C2 (facade `getOwnHistory` and `discoverMints` have no caller; ADR 0003 planned the first), C3 (four
unused store actions that look like missing features, F241), C4 (one writer for the saved profile list), C5 (one
owner for read-change-publish of own lists; F227 and F240 first).

### Behaviour changed in pass 3

Each with a test that failed first; none changes a saved shape or anything sent.

| Commit      | Before                                                                                    | After                                                        |
| ----------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `f04617475` | A notification that threw inside the payment machine skipped the next step's handler      | Every notification is logged on failure and the turn goes on |
| `03eadc142` | A mint advertising a malformed method or unit crashed the discovery list                  | The malformed entry is dropped                               |
| `aaa6e6d53` | A numeric-string timestamp gave the DM pager no cursor, so older messages stopped loading | It reads as the number                                       |
| `ed0415cc8` | "Copied" showed before the clipboard write finished, even if it then failed               | It shows after the write; a failure shows "Failed to copy"   |
| `1b8011983` | After changing mint, the previous mint's details showed until the new ones arrived        | Nothing shows until the new mint's details arrive            |
| `4a8f1fcdc` | A transaction's source label disappeared from its screen while its row still showed it    | The screen reads what the row reads                          |
| `59c8c3f21` | The filter sheet counted zero for the test account while the list showed its entries      | The count uses the list's rule                               |
| `f68cefe30` | A currency-only filter showed no badge                                                    | It counts as one filter                                      |
| `581a57fab` | The map's Retry cleared the error and fetched nothing                                     | It fetches again                                             |
| `0eed57d62` | The AI image button chose its model from a balance nothing writes                         | It uses the wallet balance the send uses                     |
| `c4e87d666` | A replaced signer connection kept its session allows, so re-pairing skipped the prompt    | Disconnect, block and replace all end the client's session   |
| `0ccc36cbf` | The Bluetooth connection dot could come back on after leaving a chat                      | A late result changes nothing                                |

The twelve fixes were built by Claude Opus 5.5 and reviewed commit by commit by Codex GPT-6.1 Sol: eleven clean, one incomplete (the source
label had no entry for Bluetooth), fixed in `aaa1ea2e9` by Claude Fable 5.2 and not re-reviewed.

### Models and review

Surveys: Claude Opus 5.5 (four areas), Codex GPT-6.1 Sol and GPT-6 Astra (two each). Cuts: Claude Opus 5.5 in three
parallel worktrees; merges, two small fixes and the restoring of two deletions that belonged to group C: Claude
Fable 5.2. Reviews, each from the diff and tests: Codex GPT-6 Astra passed the dead-code round with no production
regression; Codex GPT-6.1 Sol found one regression in the first round of merges (the store-load latch could miss a
finished load, and a later settings re-read blanked the app gate), repaired in `772b1642b` and `1e433d64a`, which Codex GPT-6.1 Sol then
passed, naming three timing differences with no known trigger (F242); Codex
GPT-6 Astra passed the second round with two harmless timing differences. `persistence-release-safety`: no saved
shape changed and every upgrade and drift test passes; no real upgrade was run, so the verdict is INCONCLUSIVE.

### Open findings from pass 3

F240 (relay list and profile edits: marked published without being sent, or built on older data), F241 (smaller
defects and four missing features), F242 (cuts stopped on, and the two wallet-context defects behind one of them).

### Not verified in pass 3

- Nothing was run on iOS or Android.
- No real upgrade was run.
- The Bluetooth label fix and the restoring commit were not reviewed by another model.
- `jevlint` saved checks were not run; `audit-commit` was not run per commit.
- Some pin commits and intermediate commits do not type-check alone; the branch head passes every check.

## Sweeps

### Sweep 1 (2026-11-12)

Branch `surgery/sweep-1`, stacked on `surgery/pass-3`. Eight surveys in `sweep-1/surveys/` (brief in its
`README.md`), one per area plus one for configuration, tests and documentation; each finding carries a verdict, fix
or list. The fix brief is `sweep-1/FIX-BRIEF.md`.

Surveyed by Claude Fable 5.2 (wallet, stores and shared code, feed and Nostr), Claude Opus 5.5 (messaging, signer,
AI), Codex GPT-6.1 Sol (payments; transactions, wallet, mint) and Codex GPT-6 Astra (startup and settings;
configuration, tests, docs). Fixed by Claude Fable 5.2 (two lanes) and Claude Opus 5.5 (one lane).

Of 72 findings marked fix, 61 were fixed or removed in 57 commits and 11 were left by the builders on a closer
look (not confirmed by a failing test, two reasonable repairs, or a change to something saved or sent). Product code
went from 369,727 to 369,529 lines.

Behaviour changed (each with a test that failed first; nothing saved or sent changed):

| Commit      | Before                                                                                  | After                                                    |
| ----------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `17ef4d80a` | A mint list that finished loading for an earlier picker replaced the open picker's rows | Only the latest load applies                             |
| `f5c9a388e` | A payment-request send that failed before Coco started it left its ecash reserved       | It is cancelled, as the other send paths do              |
| `f8c246bcc` | A preview restored after a dismissed mint list lost its recipient on a quote refresh    | It keeps it                                              |
| `f0ddbde35` | A failing cancel replaced the error that explained the failure                          | The first error is kept                                  |
| `215675d07` | A single-rail build's receive screen opened on Unified                                  | It opens on its own rail, and Copy copies it             |
| `3eabe8784` | A removed mint stayed in mint contacts and the spinner stuck                            | Both clear                                               |
| `039c696e7` | A mint contact's key was read from the first Nostr contact                              | It is read from the npub that admitted the mint          |
| `82c05fa3d` | An older inbox snapshot erased a live DM; a live arrival replaced the seeded rows       | Both are kept                                            |
| `ed4aa3871` | A later, worse data source overwrote the first answer for profiles, follows, note stats | Only a better-ranked source replaces it                  |
| `99832507a` | A search hit that held only AI providers wrote no profile stats                         | It writes them                                           |
| `afc0c056f` | A failed post delete threw past its caller                                              | It ends its toast as failed and logs why                 |
| `cfcdc20ba` | The map re-centred and asked for location again on every rotation or resize             | It asks once                                             |
| `7c7acb993` | The AI model picker ignored a tap on a model that arrived while it was open             | The pick resolves against the current lineup             |
| `49b125fd6` | White Noise teardown left the key copy un-wiped if a listener removal threw             | It is wiped                                              |
| `069a4daaa` | Four copy buttons said "Copied" before the clipboard write finished                     | They say it after; a refused write says "Failed to copy" |
| `6f21bad47` | A cached read cancelled by leaving the screen showed "fetching" for ever                | It clears                                                |
| `d3ad07d3f` | Stopping the price feed mid-request left it loading                                     | Loading ends                                             |
| `e3f1ea10f` | Relay health probes restarted on every render                                           | One probe each until the hosts change                    |
| `04375eee5` | The rating bar chart kept its first fill                                                | It follows the rating                                    |

Also: unreachable code and exports removed, identical copies merged (tier rank table, note metrics, the
payment announcements, the timeout helper), three tests that could not fail rewritten so they can, and stale
comments and documentation corrected against the code.

Reviewed commit by commit by Codex GPT-6.1 Sol (wallet and payments) and Codex GPT-6 Astra (the rest): two defects,
both repaired with a failing test first by Claude Fable 5.2 and not re-reviewed: a live DM could not fill a seeded
row with the same time (`90c97c1cb`), and note stats were ranked per answer, not per note (the commit after it).
The review also noted that the tier-rank fix can change which follow set is saved as the seed.

Listed for the owner, not fixed: F243 (money and saved data), F244 (behaviour needing a decision), F245
(unreachable code that carries tests, repeated work not yet measured, leftovers from passes 2 and 3). No decisions
have been taken on that list yet.

Not verified: nothing was run on iOS or Android; no real upgrade was run (no saved shape changed); the surveys did
not read every file (each lists what it skipped, among them most of `shared/ui`, the large stores and much of the
feed UI); the unmeasured speed-ups are listed, not made.

## Decisions (owner, 2026-11-12, after sweep 1)

None of these is built yet. Each names the follow-up it settles.

| Decision                                                                                                                                                         | Settles                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Run the released app and the new one on simulators, upgrade one to the other and try the payment screens. Use Claude Fable 5.2 or Codex GPT-6.1 Sol for it.      | F228 in part, the upgrade run |
| Follow: show that a follow is waiting to sync; after a relay has failed several reads in a row, read and publish without it.                                     | F227, F239 (1)                |
| Pay again after a failed Lightning payment: show the new fee first; a second tap pays.                                                                           | F243 (wallet B3)              |
| Offline check: use the phone's own connection signal if it can be made right on both iOS and Android; otherwise use whether Nostr relays answer. Not one server. | F243 (stores B2)              |
| AI Regenerate and Retry follow the same confirm-spend rule as a normal send.                                                                                     | F243 (messaging I2)           |
| The backup reminder counts every currency.                                                                                                                       | F243 (stores B5)              |
| White Noise invitations: look back three days.                                                                                                                   | F243 (messaging B1)           |
| The four unused actions (un-hide a post, unblock a signer app, the NFC armed flag, composer content warning and mention): delete all four.                       | F241, pass 3 C3               |
| Unreachable feed and wallet code that only tests exercise: delete it and its tests.                                                                              | F245 (unreachable)            |
| The wallet package is only for this app: remove the entry-file exports nothing imports.                                                                          | pass 3 C1                     |
| Profile, relay list, mute list and follows share one rule: read the latest copy, change it, publish to the relays read, wait when that cannot be done.           | F240, pass 3 C5               |
| Merging: the owner merges the stacked pull requests, oldest first; they are kept up to date and reported when ready.                                             | all open pull requests        |

Still without a ruling: the rest of F243 and F244, the saved-but-unread fields and the unmeasured speed-ups in F245,
pass 3 C2 (two facade reads with no caller) and C4 (one writer for the saved profile list).
