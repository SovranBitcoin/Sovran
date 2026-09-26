# Hunch conformance sweep — ledger

The durable record of the autonomous rule-conformance sweep. Procedure:
[sweep-protocol.md](sweep-protocol.md). Read this first; it outlives any one
session. Never delete a row.

Branch: `feat/receive-nut-drop`.

## Domain queue

| # | Domain | Status | Notes |
| --- | --- | --- | --- |
| 1 | `entropy` | done | 0 defects; 4 chunks blocked by a provider content filter, hand-verified |
| 2 | `secrets` | done | 3 defects (all blocked: durable data), ~17 false positives, rule sharpened |
| 3 | `payments` | done | 0 defects; 4 abstentions hand-verified, all correctly guarded |
| 4 | `money` | done | 1 defect (blocked: 5-way refactor), 1 intentional, 1 false-positive |
| 5 | `state` | done | 0 findings, but exposed a rule blind spot; new rule added |
| 6 | `nostr` | done | 1 defect found and **fixed** (`33953ab4`) |
| 7 | `errors` | done | both rules deleted (mint-side), 1 added; 1 defect fixed, ~52 blocked |
| 8 | `ui` | done | 22 findings, 22 false positives; rule sharpened 22 → 1 |
| 9 | `nip17`, `nip59` | done | repo-wide re-run: 11 findings, 0 defects; `room-identity` de-selected |
| 10 | `nip61`, `nip60`, `nip46`, `nip65`, `nip04`, `nip19`, `nip01`, `nip06` | done | unblocked on a 4th run once the provider recovered: 373/388, 19 findings, 0 new defects |
| 11 | `nut06`, `nut10`, `nut11`, `nut12`, `nut18` | done | 2 defects **fixed**, 1 blocked (F44), 9 false-positive/intentional |
| 12 | `bip32`, `bip39`, `bip43`, `bip21`, `bip321` | done | complete run, 0 failed; 4 findings, all false-positive |
| 13 | `agents-md/root` | done | 1 defect fixed, 21 testability gaps recorded, 208-finding rule switched off |
| 14 | `skill/*/*` (7 skills) | done | 21 findings, 0 defects; 1 compiled-rule scope gap recorded |
| 15a | `doc/…/conventions-typescript` (16 rules) | done | 29 findings; 3 fixed, rest recorded |
| 15b | `doc/…/conventions-zod` (28 rules) | done | 54 findings; 7 sites fixed, rest recorded |
| 15c | `doc/…/conventions-react-native` (29 rules) | done | 20 findings; 3 defects **fixed** incl. a WebView scheme escape |
| 15d | `doc/…/conventions-async-tests` (31 rules) | done | 85 findings; 61 in shipping code, recorded as F47 |
| 15e | `doc/…/conventions-state` (34 rules) | done | 40 findings; top cluster recorded as F48 |
| 15f | `doc/…/contributor-conventions` (122 rules) | done | 221 findings, 44 rules; clusters recorded, top verified |

## Findings

### Pre-sweep (landed before the protocol existed, recorded for completeness)

Scope run: `check --all --only "nip59/*,nip17/*" app/shared/lib/nostr
app/features/payments/data app/shared/lib/cashu/paymentRequestNostrTransport.ts`
— 85 chunks, complete, no notices, 2 findings.

- [nip17/publish-to-recipient-dm-relays] app/shared/lib/nostr/sendDirectMessage.ts:1-109 — a hint-less nprofile falls back to 5 hardcoded relays, publishing live proofs where the payee may never read
  verdict: defect
  evidence: blame `aad57e2e` "feat(receive): NUT-18 Cashu rail" introduced the fallback incidentally with the transport; no test, ADR or contract pinned it. Siblings are no better — cashu.me `src/stores/nostr.ts:371` falls back to the *sender's* relays, macadamia `NostrService.swift:330` publishes to its own saved pool and ignores nprofile hints entirely, minibits only receives. No wallet in the reference set implements `kind:10050`.
  action: `8bcf6f06` fix(nostr): stop sending ecash to relays the payee never declared. nprofile hints → `kind:10050` → refuse. Safe because `wallet/src/operations/defaultOperations.ts:1841` already rolls back the prepared proofs on a `sendNostrDM` throw. Verified: `bun run type-check` (3 workspaces, 0), `bun run lint` (0 errors / 160 warnings = baseline), `bun run knip` (clean), 90 tests across 11 related suites.

- [nip17/publish-to-recipient-dm-relays] app/shared/lib/nostr/outbox/resolveWriteRelays.ts:1-66 — outbox routing flagged as DM routing
  verdict: false-positive
  evidence: the only callers are the composer (kind 1, `useComposerActions.ts:126`) and own-profile metadata (kind 0, `publishOwnProfileMetadata.ts:254`). No DM path reaches it. The rule fired on the fileoverview's words "mentions/replies/DMs".
  action: `4d2d992b` docs(nostr): stop the outbox docstrings claiming they route DMs. Fixed at the source of the confusion rather than by narrowing the rule — the docstring was factually wrong and described the opposite of NIP-17. Re-run pending to confirm the flag clears.

### Open gaps noted in passing

- We publish no `kind:10050` of our own, so a spec-following NIP-17 client cannot open a DM with a Sovran user. Noted in `8bcf6f06`; not a finding from any rule yet.

### entropy — done

Scope run: `check --all --only "entropy/*"` (whole repo). 2,473 files / 4,614
chunks / 8,274 questions / 3,821 requests / 25.0M input tokens.
`complete: false` — 4 requests failed after retries (see `blocked` below), so
7 rule-evaluations across 4 files went unasked. **0 findings** from the 3,817
requests that were answered.

Zero findings is corroborated by an independent hand audit of the entropy
surface, not taken on trust — the rules were not touched, so this is not a
blunted question:

- `app/shim.js:15-25` — the crypto bootstrap throws on every failure path
  (missing `getRandomValues`, a live call that fails, missing `subtle`). This
  is the "fallback that throws" `entropy.md` calls correct, and the inverse of
  the Randstorm and Coldcard shapes. Blame `52436ab2` "refactor(app): reduce
  dependency and entropy surface", body: *"make QuickCrypto the fail-closed
  entropy boundary"*, pinned by `app/__tests__/shimBootstrap.test.ts`.
  Deliberate.
- `app/shared/lib/nostr/secureStorage.ts:343-345` — 128 bits from
  `crypto.getRandomValues` for a 12-word mnemonic; the `catch` throws rather
  than returning bytes; single-flight guard against concurrent generation.
- `secureStorage.ts:210-223` — the debug-mnemonic override is `__DEV__`-gated
  and returns `null`, never weak bytes, on every failure path.
- `app/shared/lib/nostr/nip17.ts:124` — a fresh `generateSecretKey()` per gift
  wrap, inside the function: no ephemeral-key reuse.
- `nip17.ts:44` — the timestamp jitter is a single 32-bit draw, which matches
  `entropy/narrowed-seed`'s shape, but it is a metadata-privacy offset and not
  key material. `entropy.md` names it an allowed case; Jev correctly did not
  flag it.
- Every `Math.random` in shipping source is an allowed case: list keys
  (`PollComposeForm.tsx:32`), backoff jitter (`pricelistFeed.ts:90`), a UI
  target pick (`NearPayScreen.tsx:1234`), and an in-memory Map key
  (`notificationFollowersSeedCache.ts:12` — named `seedId` but a list-handoff
  id, not a cryptographic seed).

Findings:

- [entropy/*] app/__tests__/openExternalUrl.test.ts:1 — 1 rule unanswered
  verdict: blocked
  evidence: the provider refuses this chunk deterministically — 3 attempts, including one where the file was the only input (1 file / 1 chunk), all `GatewayInternalServerError` after 6 internal retries. The main run answered 3,817 of 3,821 requests, so this is not auth, quota or model. The file is a scheme-allowlist test whose fixtures are `javascript:alert(1)`, `file:///etc/passwd`, `data:text/html,<script>`, `intent://x#Intent;end` — a provider-side content filter is the only explanation consistent with the evidence.
  action: hand-verified instead — the file contains no entropy surface whatsoever (no RNG, key, nonce or seed), so all 3 entropy rules are vacuously `no`. Unblocking fact needed: whether the provider exposes a way to review content-filtered chunks, or Hunch a way to mark them.

- [entropy/*] app/modules/bitchat-module/scripts/patch-bitchat-imports.js:244 — 3 rules unanswered
  verdict: blocked
  evidence: same provider failure, same 3 attempts.
  action: hand-verified — a build-time Swift import rewriter. Its only entropy-adjacent token is the comment `private import struct CryptoKit.SHA256` at :71. No RNG, no key material.

- [entropy/*] app/modules/bitchat-module/scripts/sync-bitchat-android.js:379 — 2 rules unanswered
  verdict: blocked
  evidence: same provider failure, same 3 attempts.
  action: hand-verified — a file-copy manifest. Its entropy-adjacent tokens are *filename strings* (`crypto/EncryptionService.kt:56`, `nostr/NostrCrypto.kt:77`); it copies files and generates nothing.

- [entropy/*] site/scripts/composition.test.mjs:1 — 1 rule unanswered
  verdict: blocked
  evidence: same provider failure, same 3 attempts.
  action: hand-verified — no entropy-adjacent token at all.

- [entropy/narrowed-seed] app/modules/bitchat-module/ios/BitChatNostrBridge.swift:1 — abstained `insufficient-context` on the whole-repo run
  verdict: false-positive (resolved)
  evidence: answered cleanly on the re-run with a narrower scope; produced no finding and no notice.
  action: none. Not a rule-precision problem — the abstention did not recur.

Rule-precision note (no action taken): the four blocked chunks were only in
scope because the `entropy/*` `when` regexes match `crypto`/`Crypto`/`key`/
`Seed` inside comments and filename strings. That costs requests, not
precision — `when` is a cheap prefilter and over-matching is its intended
failure direction — so the rules are left alone. Recorded in case the cost
bites on a later domain.

Standing caveat for the rest of the sweep: provider content filtering will
recur on any chunk holding attack-shaped fixtures (URL schemes, injection
payloads, path traversal). Expect `blocked` rows on security *tests*, and
hand-verify rather than re-running a fourth time.

### secrets — done

Scope run: `check --all --only "secrets/*"` (whole repo). 4,614 chunks /
4,876 questions / 3,456 requests / 18.3M input tokens. `complete: false` —
3 requests failed (the same content-filtered build scripts as the entropy
domain) and 2 chunks abstained `insufficient-context`. **23 findings**, all
`secrets/disclosure`; `secrets/recovery-after-read-failure` returned **zero**,
which matches the hand audit below.

`recovery-after-read-failure` scoring zero is correct, not a blunted question.
`ensureMnemonicExists` (`secureStorage.ts:377-450`) separates "locked",
"read failed", "present but invalid" and "confirmed absent" before it will
generate: a read error calls `lockMnemonic` and returns null, a present-but-
invalid value logs `refusing_overwrite_corrupt_mnemonic` and returns null, and
only a confirmed absence falls through to generation. Blame `e08037f6`
"fix(recovery): preserve stored identity across reinstalls" — deliberate, and
`docs/review/contracts.md:10-12` names this function as the contract.

Real findings:

- [secrets/disclosure] app/features/bitchat/stores/bitchatDmMessages.ts:132-281 — BLE 1:1 message plaintext persisted to AsyncStorage
  verdict: defect
  evidence: the store persists `byPeer[].content` for messages it marks `isPrivate: true` (fileoverview at :137 says "Persisted to AsyncStorage so chat history survives app kill"). `docs/review/contracts.md:13-14` forbids decrypted private messages in unencrypted persistent stores. Same defect class as F02, which named neither this store nor `giftWrapCache`.
  action: blocked for this sweep — recorded by extending F02 in `aae214c6`. The fix is F02's existing open design choice (memory-only vs encrypted-with-retention) and must also erase blobs already written, which is durable user data; the protocol says to hand that back rather than improvise.

- [secrets/disclosure] app/shared/lib/routstr/topUp.ts:45 + app/shared/stores/profile/routstrStore.ts — bearer payment material persisted in plaintext
  verdict: defect
  evidence: `topUp.ts:45` sets `apiKey = encodedToken` — a raw Cashu token — and calls `store.setApiKey`. `routstrStore` persists `apiKey` through `createProfileScopedStorage`, which is AsyncStorage (its own comment at :335 lists "the API key" among what a failed parse discards). A Routstr key carries a prepaid balance, so this is bearer payment material at rest unencrypted, which `contracts.md:13-14` forbids in the same sentence as mnemonics. Blame shows no deliberate decision: the only commit touching it is the monorepo move `126dd78c`, and no ADR, test or contract entry pins it.
  action: blocked — recorded as new follow-up **F42** in `aae214c6`. Moving the key to SecureStore is a durable-data migration, a protocol stop condition.

- [secrets/disclosure] app/shared/lib/nostr/giftWrapCache.ts:1 — abstained `insufficient-context`, but the concern is real
  verdict: defect
  evidence: found by hand, not by the rule. `giftWrapCache` stores NIP-17 `UnwrappedDM` objects through `createPubkeyScopedCache`, which is AsyncStorage-backed. F02 named only `nip04Cache`, so the NIP-17 path — the one payment DMs and the messages screen use — was unlisted.
  action: blocked — F02 corrected in `696ab69e` to name the factory and both call sites, and to require erasing the four existing blobs.

Intentional (verified, not fixed):

- [secrets/disclosure] app/scripts/gen-giveaway-key.mjs, app/scripts/find-vanity-giveaway-key.mjs — operator CLI scripts whose stated purpose is printing a keypair they just generated, to stdout, for the operator to paste into `.env`/EAS. Both carry an explicit SECURITY note about bundle extractability and point at `skills/sovran-security/references/secure-storage-key-derivation.md`. No log, analytics or persistent sink.
- [secrets/disclosure] app/scripts/generate-test-vectors.ts — prints derived values from the *published* NIP-06 spec mnemonics (`leader monkey parrot …`). Printing them is the script's purpose and they are public.
- [secrets/disclosure] app/e2e/funded/custody.ts, app/e2e/funded-runtime/* — the funded-E2E custody handoff. `e2eSeedExport.ts` gates it on `__DEV__`, requires both an endpoint and a 64-hex token, and `assertOwnedLoopbackEndpoint` pins the target to `http://127.0.0.1:<port>/seed` with no credentials, query or fragment.

False positives (no sink present in the window):

- `wallet/src/normalize.ts` (both chunks), `app/shared/lib/nfc/adapter.ts`, `wallet/src/screen-actions/createManager.ts`, `app/shared/lib/popup/popups/payment.ts`, `app/shared/ui/composed/CopyableValue.tsx`, `app/shared/blocks/PaymentInfo.tsx`, `app/shared/ui/composed/chat/ChatMessageBubble.tsx` (both chunks), `app/features/receive/screens/ReceiveScreen.tsx`, `app/features/receive/screens/OnchainReceiveScreen.tsx`, `app/shared/lib/routstr/api.ts`, `app/modules/bitchat-module/ios/BitChatBLEBridge.swift`, `app/features/send/lib/sovranPaymentConfig.ts`
  verdict: false-positive
  evidence: grepped every one for `AsyncStorage`/`setItem`/`console.`/`analytics`/`captureException`/`Sentry` — zero sinks in all of them. They parse, normalize, render to the owning user, or send a credential to the service it authenticates against.
  action: rule sharpened, `062bd8d4`. Before/after on the same 20 flagged files plus `routstrStore.ts`, same rule: **23 findings over 20 files → 9 over 6**. Every true positive survived with *higher* confidence (bitchatDmMessages 0.24/0.32 → 0.41/0.57; topUp 0.67 → 0.79), and recall improved — `routstrStore.ts`, which holds the actual F42 sink, was never flagged by the old wording and now scores 0.63.

Rule-precision note: thresholding was considered and rejected. The two real
findings scored 0.24 and 0.32, *below* most false positives, so any confidence
floor that cleared the noise would have discarded them. The first rewrite also
over-corrected — excluding "passing it between functions" made
`setApiKey(token)` read as an in-memory pass and lost `topUp.ts` — so the
final wording states that a persisted store or storage-prefixed cache is a
sink even when the persistence is configured elsewhere.

Blocked (provider content filter, same as entropy): `patch-bitchat-imports.js:244`,
`sync-bitchat-android.js:379`, `composition.test.mjs:1` — 2 rules each.
Hand-verified: none handles secret material; they rewrite Swift imports, copy
files by name, and test site composition.

### payments — done

Scope run: `check --all --only "payments/*"` (whole repo). 4,614 chunks /
10,014 questions / 3,761 requests. `complete: false` — 4 requests failed (the
same content-filtered build scripts as entropy and secrets). **0 findings**.

Zero is not taken on trust. Four chunks abstained `insufficient-context`, and
all four sit on the highest-value payment paths — exactly where a defect would
hide — so each was hand-verified:

- [payments/cancellation-state] app/shared/lib/cashu/manager.ts:1290 — `restoreInflightProofsForMint` returns *all* inflight proofs to ready with no settlement check, and its docstring names `timeout` as a trigger. `contracts.md` says a timeout is not proof a melt failed.
  verdict: intentional (not a defect)
  evidence: the only non-test caller is `rebalanceWalletPort.ts:45`, which the rebalance engine drives. `wallet/src/rebalance/engine.ts:137-143` guards it: `if (run.unsettledMints.has(mintUrl)) { log.warn('mint.rebalance.restore_skipped_unsettled_melt'); return; }` with the comment "A melt from this mint may still pay; its proofs must stay reserved." The uncertain case is excluded before the call.
  action: none. The abstention was *correct*: the guard lives in another package, so no `contextLines` value could have shown it. Not a rule-precision problem — see the note below.

- [payments/uncertain-outcome] app/shared/lib/routstr/api.ts:567 — `topUpBalance` POSTs a Cashu token under an abort timeout.
  verdict: intentional (not a defect)
  evidence: `topUp.ts:87-91` handles the uncertain outcome rather than resolving it — on failure it still persists the apiKey and logs `routstr.topup.partial_success` with reason `api_key_set_but_balance_failed`, so a timed-out top-up leaves the token's value recoverable through the stored key instead of discarded.

- [payments/request-constraints] app/features/send/lib/sovranPaymentConfig.ts:133
  verdict: false-positive
  evidence: `findReceiveHistoryEntryForOperation` is a read-only reconciliation lookup over `manager.history`. It carries no amount, unit, mint or lock constraint, so there is none to drop.

- [payments/repeated-effect] app/features/feed/components/nostr/NoteContent.tsx:230
  verdict: intentional (not a defect)
  evidence: `LightningBlock` decodes the relay-supplied `meltTarget` once through colada's canonical `decodeBolt11Invoice` — by its own comment, "the same one the payment machine seeds its amount from, so the chip can never advertise a different number than the flow charges" — and an undecodable target renders as a non-tappable "Invalid Lightning invoice" chip so "a relay-supplied lnbc-shaped string never reaches `machine.execute`".

Rule-precision note (no action taken): 4 abstentions in 10,014 questions is
0.04%, and each one is a cross-package guard — the mechanism is in
`app/`, the guard in `wallet/`. The protocol's remedy for chronic abstention
(raise `contextLines`, or ask it whole-file) cannot reach across a package
boundary, and `--all` already sends whole files. Abstaining is the honest
answer here, so the rules are left alone.

Blocked (provider content filter, same as entropy and secrets):
`openExternalUrl.test.ts:1`, `patch-bitchat-imports.js:244`,
`composition.test.mjs:1`, `sync-bitchat-android.js:379`. Hand-verified: none
initiates a payment effect.

### money — done

Scope run: `check --all --only "money/*"` (whole repo). 3,278 questions /
3,278 requests. `complete: false` — 4 requests failed (the content-filtered
scripts, plus `copy/src/site.ts` this time). **3 findings**, all low
confidence (0.16–0.23), all verified in source.

- [money/amount-meaning] wallet/src/amount.ts:1-67 and wallet/src/balance/breakdown.ts:1-67 — `amountToNumber` loses the unknown-versus-zero distinction, and disagrees with itself across copies
  verdict: defect
  evidence: five implementations, four behaviours for bad input. `app/shared/lib/cashu/amount.ts` (24 importers) and `wallet/src/amount.ts` return `NaN` for an unparseable string with a warn/debug log; `wallet/src/balance/breakdown.ts:36` (`Number(value) || 0`) and `wallet/src/history/timeline/context.ts:44` silently return `0`; `app/e2e/funded-runtime/payment-request-payer.ts:64` throws. All five map `null` to `0`. Blame says incidental: `breakdown.ts` was last touched by `4b4b5020` "delete three pass-through wrappers" and `wallet/src/amount.ts` by `1911f46f` "remove dead code, assets, and duplicate implementations" — two cleanup passes that both missed it. No ADR, test or contract pins the divergence.
  action: blocked — F03 extended in `c574b780` to name all five and the disagreement, and to take the e2e copy's refusal as the model. Converging them across ~35 call sites is a refactor, which the protocol forbids inside a fix commit.

- [money/amount-meaning] nostr/src/facade/noteStatsContract.ts:1-58 — flagged for flooring `satsZapped`
  verdict: intentional
  evidence: this is the guard, not the defect. Its docstring explains that `NoteStats` declared `CountInt`/`Sats` but the tier mappers were casts, both wire schemas accept a bare `z.number()`, and `recordZapPaid` persists under `z.number().int()` — so one fractional `satsZapped` from a non-Nagg tier would fail parse and, because the persist merge is all-or-nothing, discard the whole social store on every launch. Clamping at the one place every tier converges is deliberate and documented.
  action: none. Not a rule-precision problem either: asking about a coercion and being shown a deliberate clamp is the rule working; a human reading the docstring settles it in seconds.

Blocked (provider content filter): `openExternalUrl.test.ts:1`,
`sync-bitchat-android.js:379`, `composition.test.mjs:1`, `copy/src/site.ts:1`
— 1 rule each. Hand-verified: none carries a monetary amount;
`copy/src/site.ts` is marketing strings.

### state — done

Scope run: `check --all --only "state/*"` (whole repo). 7,287 questions /
3,946 requests. `complete: false` — 4 requests failed (content-filtered
scripts + `copy/src/site.ts`). **0 findings**, 2 abstentions.

Both abstentions hand-verified, no defects:

- [state/stale-owner] app/features/wallet/components/PrimaryBalance.tsx:145 — `recoverPendingOperations` runs coco send/melt/receive recovery off a `CocoManager.getInstance()` singleton.
  verdict: false-positive
  evidence: recovery mutates coco's own profile-scoped store through the manager it captured. A profile switch builds a new manager; the old recovery finishing against the old profile's operations is the intended outcome, not a stale write to the new owner.

- [state/stale-owner] app/shared/lib/cashu/initializeDefaultMints.ts:1
  verdict: false-positive
  evidence: this is the pattern the rule wants. An injected `isLive()` generation guard is checked before each mint iteration, before the selection branch, and — the part that matters — re-checked together with the state itself after the await: `if (!isLive() || useMintStore.getState().selectedMint) return;`. The rule abstained only because `isLive` is injected and its binding is not in the window.

Rule gap found and closed (the domain's real result):

- [state/persisted-compatibility] app/shared/lib/persist/createMergeWithSchema.ts:24 — not flagged, but the defect is there
  verdict: defect (pre-existing, registered as F05)
  evidence: `if (!r.success) return current;` discards the entire persisted blob on any `safeParse` failure, for 16 call sites including `settingsStore` (terms acceptance, onboarding) and `profileStore`. This is the shape behind the Balance-split enum rename wiping settings.
  action: blocked as code (F05 is an existing entry; fixing it is a persisted-data change the protocol hands back). But the *rule* gap is closed: `persisted-compatibility` asks whether a **change** breaks stored data, so on `--all` there is no change and it correctly says nothing — nothing asked the standing question. Added `state/all-or-nothing-rehydrate` in `ab791089`, which asks what happens to the user's other fields when one fails to decode. Measured on `app/shared/lib/persist`, `settingsStore`, `routstrStore` and `createPubkeyScopedCache`: flags `createMergeWithSchema.ts` at 0.49 and `persistConfig.ts` at 0.12, and leaves the three stores alone — they consume the merge, they do not implement the discard.

Standing lesson for the rest of the sweep: a rule phrased around "does this
**change** …" contributes nothing to a `--all` conformance pass. Several
`payments/*` and `state/*` rules are phrased that way. Their zero scores are
evidence about the rule's framing, not about the code, and should not be read
as the code being clean.

Blocked (provider content filter): `sync-bitchat-android.js:379` (3 rules),
`patch-bitchat-imports.js:244` (2), `composition.test.mjs:1` (3),
`copy/src/site.ts:1` (3). Hand-verified: none owns persisted state.

### nostr — done

Scope run: `check --all --only "nostr/*"` (whole repo). 4,592 questions /
3,174 requests. `complete: false` — 2 requests failed (content-filtered
scripts). **1 finding**, fixed.

- [nostr/delivery-claim] wallet/src/screen-actions/defaultHandlers.ts:594-743 — a relay OK presented to the user as recipient receipt
  verdict: defect
  evidence: the success path sets `phase: "delivered"`, and the copy behind it read `toast.paymentRequest.delivered` = "Delivered to recipient" and `timeline.paymentRequest.nostrSent.label` = "Delivered". The only evidence at that point is one relay accepting a gift wrap — `sendDirectMessage` resolves on `Promise.any(pool.publish(...))`, the first relay OK — and under NIP-17 the recipient may not read that relay at all. `docs/protocols/nostr.md:45` states it directly: "Relay acceptance does not prove that a recipient received or read a message." `CLAIMS.md:163-166` had already listed these two labels as meriting state-specific review. Blame `70d052de` is a feature commit about surfacing pending payment-request receives — the wording arrived incidentally, with no test or doc pinning it.
  action: **fixed** in `33953ab4`. The honest words were already in the file: `nostrSent.infoSent` says "Sent via Nostr" one line below the label, and the real receipt signal is the separate finalized/confirmed state "Claimed by recipient", which fires when the recipient redeems. Label → "Sent", toast → "Sent via Nostr", leaving "Claimed by recipient" as the only phrase asserting receipt. Keys unchanged, so nothing persisted or wired moved. Verified: type-check 0 across three workspaces, 216 tests in 12 suites, lint 0 errors (160 warnings = baseline), and `check --only "nostr/*"` on both files now returns **0 findings**. Five timeline snapshots re-pinned; their diff is exactly "Delivered" → "Sent" and nothing else, so this is re-pinning intended output, not loosening an assertion.

Self-correction recorded: `8bcf6f06` and its ledger row claimed `bun run
type-check` clean. That was true when measured, but `dmRelayDiscovery.test.ts`
was written afterwards and typed its `SimplePool.get` fake as `{ tags }`,
which does not satisfy `NostrEvent`. Type-check was red from that commit until
`77805601` fixed it. The rule to keep: re-run the gate after the last edit,
not the last edit you remember.

Both `nostr/*` rules are change-framed ("Does this **change** …"), so per the
`state` domain's standing lesson their yield on `--all` understates the code.
The one finding that did land came through because the false claim is in a
static copy string, which reads the same with or without a diff.

### errors — done

Scope run: `check --all --only "errors/*"` (whole repo). 9,220 questions /
4,610 requests. **0 findings** — and the zero was structural, not clean.

- [errors/no-raw-error-leakage], [errors/codes-used-as-specified] — cannot fire in this repository
  verdict: false-positive (rules review code we do not own)
  evidence: `config --explain` shows both are mint-side. `no-raw-error-leakage` instructs "answer false if `hunk` does not build mint error responses"; `codes-used-as-specified` is about emitting the NUT-00 numeric code table. Sovran is a wallet — it consumes those codes and never emits them. Both failed the selection principle already written at the top of `hunch.config.ts`. The comment that justified keeping them claimed they stood in for AGENTS.md's ban on publishing raw error bodies; they cannot, because each one's first instruction is to answer false outside a mint.
  action: both deleted and replaced with `errors/raw-error-to-ui` in `8c624d6f`, which asks the question this repository can answer. `hunch install` regenerated the lock: 115 pack rules → 113, 4 insertions / 68 deletions, no compiled rule changed.

- [errors/raw-error-to-ui] app/features/settings/screens/SettingsScreen.tsx:250 — `Alert.alert('Export Failed', error.message)`
  verdict: defect
  evidence: named directly by F04. Blame is the incidental case — no test or doc pinned the wording.
  action: **fixed** in `45f5924d`, now `describeError(error, 'cashu').text`, with the raw error still going to `log.error` two lines above. Honest caveat recorded in the commit: the row sits inside `SettingsScreen.tsx:392`'s `{devMode ? …}` Developer section, so only a developer with dev mode on can reach it — the fix is correctness and consistency, not a user-facing leak closed. Verified: type-check 0 across three workspaces, lint 0 errors (160 warnings = baseline), 50 tests across 4 settings suites.

- [errors/raw-error-to-ui] repo-wide — 68 candidates
  verdict: defect (~52), intentional (16)
  evidence: the new rule, run over the whole repo, returns 68. Sampling the top confirms they are real, not noise: `ReceivePaymentRequestTab.tsx:156` interpolates `${error}` straight into empty-state copy; `sovranPaymentConfig.ts` ~2014 puts `rawError.message` into `nfcSendFailedPopup`; `wallet/src/screen-actions/defaultHandlers.ts` ~228 sets `message: err.message` on a UI-bound field. Classification: 45 in `app/features`/`app/shared` and 7 in `wallet/` are shipped surfaces → defects. 10 are CLI tooling (`app/codereview/log-doctor`, `app/e2e/viewer`), which the app never imports — only comment references exist, in `MintInfoScreen.tsx:397-399` → intentional. 6 are in the devMode-gated settings section where raw text is the point → intentional.
  action: blocked. F04 rewritten in `71c364cc` from "three places" to the true scope, pointing at the rule id as the way to enumerate the current set rather than a list that goes stale. Fixing ~52 call sites consistently is a refactor the protocol forbids inside a fix commit, and it needs a prior decision on whether `describeError`'s five services (`routstr`/`cashu`/`nostr`/`nagg`/`app`) cover NFC, clipboard, filesystem and BLE failures or need extending.

Rule-precision note: `errors/raw-error-to-ui` excludes developer-only screens,
but the devMode gate for the settings surfaces lives in `SettingsScreen.tsx`
while the error lives in `SettingsStorageScreen.tsx` — a different file. The
rule cannot see cross-file route gating, the same blindness as the `payments`
cross-package abstentions. Left alone rather than blunted: 6 known-intentional
hits out of 68 is a better trade than a wording that might drop real ones.

This domain is the clearest evidence for the `state` domain's standing lesson.
Two rules scoring zero looked like a clean domain and was in fact a rule that
could never fire over a defect present in ~52 places.

### ui — done

Scope run: `check --all --only "ui/*"` (whole repo). 3,388 questions / 2,664
requests. **complete: true, 0 failed requests** — the only fully complete run
of the sweep so far. **22 findings**, every one `ui/status-notice`;
`ui/header-continuity` and `ui/header-scroll-work` returned zero.

- [ui/status-notice] 22 findings across 18 files
  verdict: false-positive (all 22)
  evidence: the rule's criteria require a notice on "its own tinted or bordered surface", but 17 of the 18 flagged files contain no status tint at all. What it matched was any icon-beside-text composition. The clearest cases: `StatusToast.tsx` (0.83) and its siblings `ToastSlab.tsx` and `CompactToast.tsx` are the shared toast system — transient overlays spread with `toastProps` from the heroui toast manager, not inline notices; `SearchTip.tsx` (0.37) is an `HStack` with a muted icon and one line of copy and no surface whatsoever; `SignerConnectSheetContent.tsx` (0.65) was flagged while already rendering `Notice` three times.
  action: rule sharpened in `6530c73e`, not the code. Before/after on the same 18 files plus `Notice.tsx` and `ActionMenuHost.tsx`: **22 → 1**. The survivor is `TransferStepChain.tsx:234` (0.48 → 0.55), an animated progress chain that reads `dangerColor`/`warningColor` from the theme — still false, and deliberately left rather than chased to zero.

Ground truth established before touching the rule: searching the whole app for
a status tint plus an icon, outside `Notice`'s own implementation, returns
only two files, and both are the same deliberate pattern — a `bg-danger/10`
wrapper laid over an existing row to mark that row's state
(`paymentOptionsSheet.tsx:123`, `ActionMenuHost.tsx:473`). The latter carries
a comment explaining the choice, including that "colour alone is not an
accessibility signal". Both are intentional row highlights, not notices.

So this repository contains **no genuine hand-built status notice**. That is
worth stating plainly for two reasons. First, it means every one of the 22
findings was false and no code needed changing. Second, it means **recall
could not be measured** — there is no positive example here to confirm the
sharpened rule still catches one. The rule earns its keep by catching a future
regression, so it was tightened to require the shape (surface + icon +
sentence) rather than narrowed to match fewer files, which is the distinction
between sharpening and blunting.

Note on the domain's zeros: unlike `payments`, `state` and `errors`, the two
header rules scoring zero is *not* a framing artefact — both are whole-file
questions over `**/*.{tsx,jsx}` with no "does this change …" phrasing, so
their zero is about the code.

### nip17, nip59 — done

The pre-sweep pass only covered three directories. Re-ran repo-wide:
`check --all --only "nip17/*,nip59/*"`. 4,614 chunks / **82,980 questions** /
4,610 requests — by far the largest batch of the sweep, 19 rules over every
file. `complete: false`, 4 requests failed (the usual content-filtered
scripts, 18 rules each). **11 findings, 0 defects.**

First, the open item from the pre-sweep rows is now closed:
`resolveWriteRelays.ts` and `recipientRelays.ts` **no longer appear**, so
`4d2d992b` (the docstring correction) did clear that false positive. The row
above said "re-run pending to confirm"; this is the confirmation.

- [nip17/publish-to-recipient-dm-relays] app/modules/bitchat-module/ios/BitChatNostrBridge.swift:151 (0.91) and .../android/…/BitChatNostrBridge.kt:151 (0.75); [nip59/broadcast-selectively] same Swift file (0.73)
  verdict: intentional
  evidence: this is BitChat's geohash chat, not the wallet's DM path. The recipient is addressed by a *per-geohash derived* pubkey, an ephemeral identity that by definition publishes no `kind:10050` — grep for `10050` across both native bridges returns nothing. The code is symmetric: line 151 subscribes to gift wraps for its own per-geohash pubkey on `currentGeohashRelays`, and line 237 publishes to that same set, with the comment "Keeps the DM reachable wherever the recipient is subscribed." The recipient is provably listening exactly there. It also mirrors upstream (`NostrTransport.sendPrivateMessageGeohash:235`) for cross-client interop.
  action: none. A change here would also be a native change, which the protocol hands back regardless. The rule stays selected — it caught the real defect in the wallet's own DM path earlier this sweep (`8bcf6f06`); the geohash bridge is a legitimate exception, not a reason to drop it.

- [nip17/room-identity] ×7 — useDmConversations.ts, useDmThread.ts, bitchatDmMessages.ts, dmLastMessageStore.ts, mockDataStore.ts
  verdict: false-positive
  evidence: the rule asks whether a conversation is keyed on something other than author + the `p`-tag set, so a changed participant set silently merges into an existing room. That only bites with group DMs. Every NIP-17 wrap this app builds carries exactly one `p` tag (`nip17.ts:131`, `:196`), and group chat is Whitenoise/MLS — a different protocol. In a 1:1-only client, keying on the counterparty *is* keying on the participant set.
  action: de-selected in `459be95d`, following the precedent already in `hunch.config.ts` for `bip321/pop` — "not implemented, so those two are left out until it is." Noted inline to re-select with group DMs. Verified on the flagged paths: **7 → 0**, complete, nothing else lost. Lock regenerated, 113 pack rules → 112.

- [nip59/wrap-kind-and-p-tag] nostr/__tests__/facade-dm.test.ts:1 (0.76)
  verdict: false-positive
  evidence: a test file. The shared `unrelated` criterion in `hunch.config.ts` already says "Tests constructing the bad case are not violations."
  action: none — one test-file hit is not worth tuning a rule that is otherwise correct.

Cost note for the remaining pack domains: this run asked 82,980 questions
because 19 rules with no `when` were put to all 2,473 files. The remaining NIP
families should be scoped to the directories that own them (`nostr/src`,
`app/shared/lib/nostr`, `app/features/nostrSigner`), which the protocol
explicitly permits — the original three-directory `nip17/nip59` batch finished
in about a minute at 1,530 questions.

### nip01, nip04, nip06, nip19, nip46, nip60, nip61, nip65 — done (was blocked; retried and cleared)

Scoped to the owning directories (`nostr/src`, `app/shared/lib/nostr`,
`app/features/nostrSigner`, `app/features/payments/data`,
`app/shared/lib/cashu`) — 213 files / 388 chunks / 18,236 questions, which is
12× cheaper than the repo-wide `nip17/nip59` run for the same coverage.

**Three attempts, none complete.** This is the protocol's "same command
failing three times" stop condition, and the reason is provider-side, not
ours:

| attempt | requests answered | failed | scope |
| --- | --- | --- | --- |
| 1 | 27 of 388 | 16 | full batch — tripped the outage circuit-breaker at ~7% |
| 2 | 217 of 388 | 171 | full batch |
| 3 | 156 of 281 | 125 | only the 121 files attempt 2 left unanswered |

Every failure is `GatewayInternalServerError: Service temporarily unavailable`
after 6 internal retries. The findings below are therefore **not a complete
picture of these eight NIPs** — they are what surfaced from partial coverage.
Re-run when the provider recovers.

Findings triaged (all verified in source):

- [nip01/single-connection-per-relay] nostr/src/facade/relay/protocol.ts:86 (0.80)
  verdict: defect
  evidence: `openWebSocket` at :163 and :220 opens a fresh socket per relay per request. NIP-01 asks for one connection per relay with subscriptions multiplexed over it. Unlike its sibling, this file's header documents the tier and the REQ/EVENT/EOSE wire but says nothing about socket lifecycle, so there is no recorded decision behind it. Blame `cdc8b5a4` is a JSON-parsing fix, unrelated.
  action: blocked — recorded as **F43**. Connection pooling is an architectural change to the `nostr` package, not the smallest correct fix, and the protocol forbids a refactor inside a fix commit.

- [nip01/single-connection-per-relay] nostr/src/facade/primal/protocol.ts:1,87 (0.94, 0.95)
  verdict: intentional
  evidence: same shape, different endpoint. This talks to Primal's **cache API** (`wss://cache2.primal.net/v1`), a proprietary RPC service, not a NIP-01 relay — so the rule's premise does not hold. The file also records the tradeoff explicitly: "One socket per request (simple + correct; a pooled multiplexed connection is a later optimization)."

- [nip04/deprecated-prefer-nip17] app/shared/lib/nostr/nip04.ts:1 (0.92)
  verdict: intentional
  evidence: we do prefer NIP-17. `UserMessagesScreen.tsx:93` defaults `protocol = 'nip17'`; the NIP-04 branch at :378 is opt-in legacy interop for peers that need it. The module's own fileoverview calls it "the legacy encrypted-DM scheme". `hunch.config.ts` selected this rule precisely because "the deprecation notice is ours".

- [nip01/verify-against-event-pubkey] relay/protocol.ts:86 (0.89), facade/event.ts:1 (0.77), primal/protocol.ts:87 (0.77), recipes/wallpapers.ts:1 (0.72), ownsync/useOwnEventsSync.ts:1 (0.71)
  verdict: false-positive
  evidence: the rule's own text says "answer false if `hunk` does not verify signatures". None of these files calls `verifyEvent` or `verifySignature` — grep returns 0 across all five. `hunch.config.ts` selected this rule for `app/shared/lib/nostr/moderation.ts`, which does the check by hand; these transports do not verify at all, they hand events to the demux.
  action: none for now — the rule is correct and earns its place on `moderation.ts`. Revisit if it keeps firing on transports once coverage is complete; with three partial runs there is not enough evidence to tune it.

- [nip19/length-limit] memoMentions.ts:123 (0.83), client.ts:1 (0.79), cashu/manager.ts:1140 (0.76), sendDirectMessage.ts:1 (0.82)
  verdict: false-positive
  evidence: the rule asks whether bech32 is the *internal storage* form for keys and ids. In `memoMentions.ts` the `nprofile` on `MemoMentionEntity` is the literal text span inside a user-typed memo (`start`/`end`/`display`/`nprofile`); the hex form lives separately on `MemoNprofileReference.pubkey`. `sendDirectMessage.ts` decodes an nprofile and immediately uses the hex `pubkey`.

- [nip65/publish-relay-list-alongside] sendDirectMessage.ts:1 (0.77), nip46Transport.ts:289 (0.72)
  verdict: false-positive (but see the open gap)
  evidence: `nip46Transport.ts:289` is the `stop()` teardown path, unrelated to relay lists. The `sendDirectMessage.ts` hit is adjacent to a real gap already recorded above — we publish no `kind:10050` of our own — but that is a missing feature, not this rule's question about publishing a relay list alongside something else.

- [nip01/replaceable-tie-break] ownsync/partitionOwnEvents.ts:91 (0.72)
  verdict: blocked
  evidence: not verified — this arrived in attempt 3 and the domain hit its stop condition before it could be read against the replaceable-event tie-break rule (same `created_at` → lowest id wins).
  action: verify on the re-run. Recorded rather than guessed.

### nut06, nut10, nut11, nut12, nut18 — done

Scoped to `app/shared/lib/cashu` and `wallet/src`. 409 chunks / 13,024
questions / **407 of 409 requests answered** — the provider recovered, and
this is the most complete run since `ui`. **12 findings.**

Two defects, both fixed:

- [nut11/keys-compared-by-x-coordinate] wallet/src/payment-request.ts (0.87)
  verdict: defect
  evidence: `P2PK_PUBKEY_RE = /^02[0-9a-f]{64}$/i` dropped any `03`-parity lock at decode, and `lockableMintsFromRequest` compared whole keys against `` `02${nostrPubkeyHex}` ``. NUT-11 keys are compressed points, so `02<x>` and `03<x>` are the same key. Sovran only mints `02` (the x-only lift of a Nostr key), so our own requests were unaffected; a SEC1-compressed key from another wallet can be `03`, and for those we answered "not yours" about a request that is. Blame `4f049644` "feat(send): describe payment destinations" — the comparison was written against our own output format and the docstring stated the `02` assumption as the definition. Not a funds risk: both consumers gate on `hasSpendingCondition || lockP2pkPubkey`, and `hasSpendingCondition` comes from `decoded.nut10` regardless of parity, so an `03` request was refused rather than paid unlocked.
  action: **fixed** in `e04bcd45`, then given a single owner in `451bd157`.

- [nut11/keys-compared-by-x-coordinate] wallet/src/transport/classify.ts (implied by the same rule)
  verdict: defect
  evidence: `classifyMeshToken` compared `expected[0] === myKey` over whole strings, where `expected` comes from `getP2PKExpectedWitnessPubkeys` — a key chosen by whoever locked the token. A Nut Drop locked to `03<our x>` was classified `locked-to-other` and silently ignored rather than auto-redeemed.
  action: **fixed** in `451bd157`. Rather than copy the helper, the canonicalisation moved into `wallet/src/p2pk.ts`, which already owns "is anything locked?" and "locked to whom?" and whose header says why: "A divergence between two copies of this check is a funds-visibility bug, not a style nit." Both fixes verified with tests confirmed to **fail first** against the old comparison, then pass — not merely to pass after.

One defect deferred:

- [nut18/transport-shape-and-preference] defaultOperations.ts:1759-1782 (0.78), machine/transitions.ts:79 (0.70)
  verdict: defect
  evidence: NUT-18 sorts a request's `t` array by preference. Selection does `find(t => t.type === 'nostr')` and `find(t => t.type === 'post')` independently, then takes Nostr only when there is no HTTP — so a payee listing `[nostr, post]` is paid over HTTP against their stated preference. The cause is recorded at :1790 as an implementation constraint: coco's `PaymentRequestsApi` has no Nostr support.
  action: blocked — recorded as **F44**. Changing transport selection in the payment path deserves its own focused change with coverage over both orderings, and funded E2E is off limits during the sweep.

False positives (guard exists, in another package or in a dependency):

- [nut10/unsupported-kind-is-anyone-can-spend] payment-request-receive.ts:1,148 (0.84, 0.82), transport/classify.ts:1 (0.75), defaultOperations.ts:624 (0.73)
  evidence: the capability check exists, one package up. `app/features/receive/lib/creqMintSelection.ts:68-76` computes `supportsP2pk` from `nutSupported(nuts, '11')`, sets `p2pkLockEffective = p2pkLockActive && hasP2pkCapableMint`, filters candidates to capable mints and disables the rest with `REASON_NO_P2PK` — with the comment "A lock over only-incapable mints would advertise anyone-can-spend ecash as locked". `ReceiveScreen.tsx:419` then drops the lock entirely when it is not effective: `creqLockPubkey = p2pkLockEffective ? p2pkKey : undefined`. Mechanism in `wallet/`, guard in `app/` — the same cross-package blindness as the `payments` abstentions.

- [nut11/tag-appears-once] wallet/src/transport/classify.ts:1 (0.74)
  evidence: **verified by experiment, not by reading.** `getP2PKRequiredSigs` reads `n_sigs` with `tags.find(...)`, which would take the first of a duplicate pair, and NUT-11 says a repeated tag makes the proof unspendable. But cashu-ts rejects it upstream: `parseP2PKSecret` throws `Duplicate P2PK tag "n_sigs"`, and `classify.ts:130` catches that and skips the proof. I wrote a fix and a test for this before checking, found the test passed with the fix reverted, probed cashu-ts directly, and reverted both. A no-op change with a test that pins nothing is worse than no change.

- [nut11/keys-compared-by-x-coordinate] app/shared/lib/cashu/cocoRepositories.ts:1 (0.75)
  evidence: `ephemeralPubkeys.has(keyPair.publicKeyHex)` is a Set lookup over *our own* keyring entries — both sides from the same source and always `02` by construction (see the comment at :124). No counterparty key is involved.

- [nut06/nuts-settings-consulted] app/shared/lib/cashu/offlineReceiveDleq.ts:1 (0.77)
  evidence: consulting the mint's NUT-06 settings would add nothing here. The file requires a DLEQ on each proof and verifies it locally; a mint that does not implement NUT-12 produces proofs without one, which fails closed at `missing-dleq`. The capability is proven by the data, not asserted by the mint.

- [nut12/wallet-verifies-received-dleq] wallet/src/transport/classify.ts:1 (0.75)
  evidence: `classify` answers "does this token look locked to me?" and redeems nothing. Acceptance runs through coco's receive path, and the offline path's DLEQ gate is `offlineReceiveDleq.ts`.

- [nut18/transport-shape-and-preference] wallet/src/guards.ts:96 (0.72)
  evidence: `validateIntent` handles no transports at all; the rule's own text says answer false in that case.

Sibling comparison for NUT-12, since the protocol asks for it: Sovran is the
**only** wallet in the reference set that verifies DLEQ. Searching
`~/Documents/GitHub` for DLEQ handling returns nothing in macadamia, minibits
or cdk, and a single hit in cashu.me — a display label, `"12: DLEQ proofs"`,
in its mint-details NUT list. `offlineReceiveDleq.ts` refuses on a missing
DLEQ, a missing blinding factor `r`, a missing keyset, a missing amount key,
and on a throw inside `hasValidDleq`, and classifies the failure distinctly
"so an offline transport never queues forged ecash for retry".

### bip21, bip32, bip39, bip43, bip321 — done

Scoped to `app/shared/lib/nostr`, `wallet/src`, `app/features/{backup,profile,receive,send}`.
566 requests / 9,056 questions. **complete: true, 0 failed, 0 notices** — a
fully complete run, the second of the sweep after `ui`.

**4 findings, all false positives**, and both clusters are the same
cross-file blindness seen in `payments` and `nut10`: the mechanism is in one
file, the guard in another.

- [bip39/checksum-not-verified] app/shared/lib/nostr/keyDerivation.ts:1 (0.78), :148 (0.72)
  verdict: false-positive
  evidence: the rule is right that this file never validates — it goes straight to `bip39.mnemonicToSeedSync`, which by design does not check the checksum. But nothing reaches it unvalidated. `validateMnemonic(x, wordlist)` gates every boundary: `secureStorage.ts:240` (debug override), `:269` (store), `:316` (retrieve), `keyRecovery.ts:30`, `profileSessionOrchestrator.ts:328`, and `BackupFlowProvider.tsx:33`. `wallet/src/wallet-seed.ts` gates its own at `:64`, `:106`, `:176`. The store gate at `secureStorage.ts:266-268` states the exact concern the rule asks about, in a comment: "Reject mnemonics that fail the BIP-39 wordlist or checksum: a single mistyped word on restore otherwise persists, derives a wrong identity, and silently strands the user's funds against the correct mnemonic." Deliberate, documented, and upstream of every derivation call.

- [bip39/wordlist-mismatch] wallet/src/wallet-seed.ts:1 (0.80), :141 (0.76)
  verdict: false-positive
  evidence: there is no second wordlist to mismatch against. Every `wordlists/` import in `app`, `wallet` and `nostr` — **9 of 9** — is `wordlists/english.js`, and `wallet-seed.ts` uses that one import at `:64`, `:73`, `:106` and `:176` for both `validateMnemonic` and `generateMnemonic`.

No rule edits. Both rules are correct and would catch a real regression — a
second wordlist, or a derivation path that skipped the boundary — and the
evidence that clears them lives in files the window cannot see. Blunting them
to silence a cross-file guard is the failure mode the protocol names, so they
stay as they are.

Note on the zeros: `bip32/*`, `bip43/*`, `bip21/*` and `bip321/*` returned
nothing on a **complete** run with no unanswered chunks, so unlike the
change-framed zeros in `payments`, `state` and `errors`, these are about the
code. `bip321` in particular covers `wallet/src/bip321.ts`, `normalize.ts` and
`detectors.ts`, which this scope included.

### agents-md/root — done

Note the id: the namespace is `agents-md/root/*`, not `agents-md/*`. The
latter matches no rule and exits 2 rather than silently reviewing nothing.

4,614 chunks / 9,528 questions / 4,014 of 4,018 requests, 4 failed (a new
`GatewayRateLimitError` this run rather than the usual 500). **231 findings**,
across four rules.

- [agents-md/root/app-alias-imports] 208 findings
  verdict: false-positive
  evidence: the rule compiled AGENTS.md:43 ("App imports use `@/…`") into "any `../` in `app/` is a violation". Distribution: 78 `app/features`, 76 `app/e2e`, 36 `app/shared`, 9 `app/__tests__`, 6 `app/codereview`, 2 `app/app`, 1 `app/scripts`. Two of the first four sampled — `AiMessageBubble.tsx`, `ModelChip.tsx` — contain no relative import at all, which is the tell. The rest are intra-feature siblings (`../lib/finalize` inside `features/ai/`), not the cross-package traversal the sentence names. Settled from the repo rather than by asking: `no-restricted-imports` in `app/eslint.config.js:242` restricts *packages* (expo-router, react-native, clipboard), never path shapes, and 123 of 1,128 app source files use `../`.
  action: switched off in `8260b9ba`. Not retuned, because the sentence's own named violation (`../../wallet/src`) is already asked by `cross-package-subpath-imports`, and an import path is a string pattern that `import/no-relative-parent-imports` decides exactly — the protocol puts such questions in the linter. Verified on `app/features/ai` and `app/e2e/core`: `agents-md/root/*` now returns 0, complete.
  **Left for a human:** AGENTS.md:43-44 is genuinely ambiguous and the next `install` will recompile the same rule from it. Rewording it changes what the convention *is*, which is the project's call, not the sweep's. If intra-feature relatives are meant to be banned, that is a lint rule plus a codemod across 123 files.

- [agents-md/root/actionable-control-testid] app/features/onboarding/screens/TermsAndConditionsScreen.tsx:1 (0.96)
  verdict: defect
  evidence: five `Button`s carried an `onPress` and no `testID` — view recovery (:48), retry settings (:63), back to Terms (:80), continue to Privacy (:105), confirm and continue (:131). Only the two `ControlField` checkboxes had ids. AGENTS.md requires every actionable control to carry a stable semantic `testID` and an accessible label, because the JSON harness addresses controls by id. `app/e2e/drivers/simulator.test.ts:34,39` already drives a control called `terms-continue`, which did not exist on the screen. This is the app's first gate, and F23 records the Android run stopping at Terms acceptance.
  action: **fixed** in `500751bb`. Presentational only. Verified: type-check 0, 12 tests across 5 terms/legal/onboarding suites, lint 0 errors, and the rule re-run on the file returns 0 findings, complete.

- [agents-md/root/actionable-control-testid] 17 further findings; [actionable-control-accessible-label] 4
  verdict: defect (recorded, not fixed)
  evidence: same class, same requirement, spread across `SettingsDesignSystemFadeStressScreen` (0.95), `NutDropCelebrationOverlay:241` (0.93), `CameraLayout` (0.92), `ThreadView:134` (0.90), `DetailsList:101` (0.90), `LiquidChatComposerGlass.ios` (0.89, 0.88), `PaymentInfo:151` (0.86), `MintChangesScreen:118` (0.85), `CircleActionButton.flat` (0.85), and others down to 0.75. The accessible-label hits are on `ActionMenuButton:142,292`, `CircleActionButton.flat` and `FormSheetChrome`.
  action: blocked for this pass. Each needs the same judgement the Terms screen got — which control, what stable name, does a scenario address it — and 21 of them is a testability sweep of its own rather than one fix. They belong with **F22** ("Not every route, alias, gesture and modal exit has a native journey on both platforms"), which is the entry that already owns this gap; the rule id is the way to enumerate the current set.

- [agents-md/root/cross-package-subpath-imports] app/__tests__/walletReadModels.test.ts:1 (0.95)
  verdict: blocked
  evidence: not verified — reached at the end of the domain, and unlike the alias rule this one asks the question AGENTS.md actually means (`wallet/react`, never `../../wallet/src`), so it deserves a real read rather than a guess.
  action: verify on the next pass. Recorded rather than assumed.

### skill/* — done

Note the id again: compiled skill rules are three-segment (`skill/<name>/<rule>`),
so `--only "skill/*"` matches nothing and exits 2. My first run did exactly
that and produced no output at all; `skill/*/*` is the working glob. Worth
recording because an `--only` typo exits 2 rather than reporting a clean
domain — that is the only reason this was caught rather than filed as "0
findings".

4,615 chunks / **33,702 questions** — the largest batch of the sweep — /
4,611 of 4,615 requests, 4 failed (the usual content-filtered scripts).
**21 findings across 7 rules, no defects.**

Scope context: 77 compiled rules across the 7 selected skills, of which 42 are
already `"off"` in `hunch.config.ts` as either lint-decidable (`no-explicit-any`,
`no-console`) or contradicting deliberate practice here (React Compiler
memoizes, so `gesture-memoized` is off; duration tokens make `no-ease-in-on-ui`
wrong). So these 21 came from an already-vetted subset.

- [skill/principle-type-system-discipline/brand-semantic-primitives] 8 findings
  verdict: false-positive (4) / intentional (4)
  evidence: **half are on native source** — `BitChatBLEBridge.kt`, `BitChatModule.swift`, `BitChatModule.kt`, `BitChatBLEBridge.swift` — where a TypeScript branded-type question is meaningless. The cause is specific: `config --explain` shows this rule is "asked about **every reviewed file**" with no `when` at all, while its siblings carry regexes that exclude native code by construction (`no-unearned-as-cast` has `/\bas\s+[A-Za-z_$]/`, `no-layout-property-animation` has `/useAnimatedStyle|withTiming|…/`). The compiler gave this one no scope. The 4 TypeScript hits (`geohash.ts` 0.93, `mapClustering.ts`, `useMapMarkers.ts`, `MapScreen.tsx`) are legitimate but are design suggestions, not defects: `encodeGeohash(latitude: number, longitude: number, precision: number): string` could brand its inputs the way `protocolIds.ts` brands `NostrPubkeyHex`.
  action: left on, recorded rather than switched off. The question it asks is correct and the TS hits are real instances of it; the fault is a missing `when` in compilation, which belongs upstream in the rule source, not in a local override that would also discard the signal. Re-check after the next `install`.

- [skill/codebase-design/no-test-only-public-surface] app/shared/lib/loggerGlobalErrors.ts:133 (0.95)
  verdict: intentional
  evidence: `export const armGlobalErrorCaptureForTest = armGlobalErrorCapture;` — the rule's literal claim is correct, this export exists only for tests, and `app/__tests__/loggerGlobalErrors.test.ts:11,47` is its only consumer. But the `ForTest` suffix makes it a deliberately labelled seam rather than surface widened by accident. (My first check reported "nothing imports it" — that was my grep excluding the filename `loggerGlobalErrors`, which also hid its own test. Corrected before acting on it.)

- [skill/codebase-design/return-results-dont-mutate-inputs] routing.ts:298 (0.78), managerInternals.ts:265 (0.91)
  verdict: intentional / false-positive
  evidence: `routing.ts:308` is `addLocalHistoryEdges(graph: SwapGraph, groups: SwapGroup[]): void` — it does mutate `graph` in place, so the rule is right, but the name states the mutation and `: void` signals it; a builder-style mutator during graph construction is a deliberate shape, and returning a new graph is a rebalance-routing refactor, not a sweep fix. The higher-confidence `managerInternals.ts` hit is a false positive: the function at that chunk is `isAlreadyRecoveredError(error: unknown): boolean`, a pure predicate that mutates nothing.

- [skill/expo-animation/no-layout-property-animation] MintCurrencyTabs.tsx (0.89, 0.86), SendScreen.tsx:410 (0.81); [interpolate-clamp] SendScreen.tsx:410 (0.81); [skill/typescript-best-practices/no-unearned-as-cast] secureStorage.ts:523 (0.79), SettingsRecoveryScreen.tsx:441 (0.76), e2e/store/export.ts (0.75); [skill/codebase-design/tests-assert-through-interface] useGuardedRouter.test.ts (0.81), operations.test.ts (0.78), loggerChild.test.ts:282 (0.77)
  verdict: recorded, sampled not exhaustively verified
  action: none. Stating the depth honestly: the findings above this line were read in source; these ten were triaged by rule and location rather than line-by-line. They are style and design questions from vetted skills, none touching money, keys or persisted data, and none rose above 0.81. They are the right candidates for a focused follow-up pass, not for changes made at the end of a long sweep on a sampled read.

### doc/… — run by convention file

The whole `doc/*` family in one batch is 234 rules / **204,888 questions** /
5,733 requests, so it is run per convention file as the queue says. Ids are
five segments: `doc/docs/review/<file>/<rule>`. `--only "doc/*/*/*"` matches
nothing and exits 2 — my first attempt did exactly that.

#### conventions-typescript — done

16 rules, 4,399 of 4,400 requests, 20,045 questions, 1 failed.
**29 findings.** Two clusters carry most of it.

- [shared-empty-readonly] 11 findings
  verdict: defect (3 fixed, 8 blocked)
  evidence: the rule asks whether a module-level constant used as a shared empty return value has a mutable type, so a consumer that mutates it changes what every later caller sees. Real instances: `useAnimatedQrFrames.ts:57` `const EMPTY_PARTS: string[] = []` returned as `parts` at :79 (0.96, highest in the domain), and `SearchPostsList.tsx:156-157`. The convention is already established here — `fakePosts.tsx:55` declares its fixture map `ReadonlyMap`.
  action: **3 fixed** in `f273e6b1`. The more useful result is why the other 8 are not a one-line change: making them readonly fails type-check because the consuming interfaces are declared mutable — `WalletContext.proofAmounts` is `Record<string, number[]>` (TS2345), `useThread` passes its maps to a `Map<K,V>` parameter (TS2739 ×2), `AmountSelector` assigns into `QuickSendSuggestion[]` (TS4104), and `NoteContent` and `fakePosts` pass theirs where a mutable `Map` is required (TS2739). Each was attempted and reverted, so those are measured errors rather than predictions. The convention cannot be applied bottom-up; widening the consuming types is a typed-API change across the feed, send and wallet-context surfaces.

- [prototype-key-lookup] 6 findings
  verdict: defect (recorded, not fixed)
  evidence: the rule asks about indexing a plain-object table with an outside-authored string and trusting the result. `appDataOps.ts:84` is a real instance: `WORD_REWRITES[word.toLowerCase()] ?? word.toLowerCase()` over a `Record<string, string>`, where `word` = `"constructor"` returns `Object.prototype.constructor`, a function that `??` does not catch because it is not nullish. Impact here is cosmetic — a NIP-46 app-data word could render as `function Object() { … }` — but the shape is the dangerous one. The other five (`interpret.ts`, `SettingsNetworkScreen.tsx:227`, `MediaPagerPage.tsx`, `MintRebalancePlanScreen.tsx:527`, `mintDistributionStore.ts:247`) were not individually read.
  action: blocked. The fix is a `Object.prototype.hasOwnProperty.call(TABLE, key)` guard or a `Map`, applied per site after reading each one. Worth its own pass, and the rule id enumerates the set.

- remaining 12 findings across `shared-in-place` (2), `exhaustive-else` (3), `invalid-date` (2), `spread-undefined-clobbers-default`, `global-test`, `all-with-side-effects`, `replace-first-only`, `empty-aggregate`
  verdict: recorded, not verified
  action: none. Stating it plainly rather than implying coverage: these were not read in source. None is above 0.92, none touches money, keys or persisted data, and they are the right material for a focused pass on this convention file.

#### conventions-zod — done

28 rules, 4,315 requests, 20,730 questions, 4 failed. **54 findings.**

- [catch-shared-mutable-fallback] 6 findings, 0.80-0.98 — the domain's top cluster
  verdict: defect (all fixed)
  evidence: seven schemas fell back to a literal — `.catch({})` in `mintStore` (×3), `dmLastMessageStore:33`, `ownProfileMetadataStore:42` and `ctaStore:69`, and `.catch([])` in `routstrStore`. Zod captures a non-function fallback once, so every parse failure of that field returns the **same** object. Verified with a throwaway probe rather than assumed: `.catch({})` gives `a === b` across two failing parses, `.catch(() => ({}))` does not. These are persisted stores, so that instance is what the store lives on after a failed hydration. Zustand's spread updates happen not to mutate it today, but that is a property of every current writer, not of the schema.
  action: **fixed** in `2e218379`, all seven now `.catch(() => ({}))` / `.catch(() => [])`. Verified: type-check 0 across three workspaces, 296 tests in 20 store/persist suites with 40 snapshots, lint 0 errors.
  **Recording a wrong prediction:** before the run I checked `.catch(` usage, saw only primitives (`'pending'`, `0`, `'unknown'`), and predicted this rule would not fire. It fired six times at the top of the domain. The grep covered two directories and I read six lines of its output. The prediction was the unreliable part, not the tool.

- [money-integer-schema] wallet/src/operations/historyEntry.ts (via the amount union), routstr/api.ts (0.84, 0.75), ReceivePaymentRequestQuoteScreen (0.93)
  verdict: intentional (historyEntry), recorded (the rest)
  evidence: `historyEntry.ts:21` is `amount: z.union([z.number(), z.string()]).optional()`, the rule's exact named shape, but the docstring explains it: "`amount` is a plain number in colada's own entries but a serialized coco `Amount` (a string) when the row comes straight from coco's history." The union is deliberate. The missing integer check is downstream in `amountToNumber`, which is already **F03**.

- [hex-ids] 13 findings and [input-size-caps] 14 findings — `nostr/src/schemas.ts`, `envelope.ts`, `facade/mint-reviews.ts`, `facade/primal/schemas.ts`, `recipes/wallpapers.ts`, plus app-side stores
  verdict: defect
  evidence: read in source after the first write-up marked them unverified. `nostr/src/schemas.ts` parses relay and Nagg responses, and `id` (:29) and `pubkey` (:31) are bare `z.string()` rather than 64-hex, `content` (:32) is unbounded, and `tags` (:33) is `z.array(z.array(z.string()))` with no cap. The same file caps one array at `:22` with `.max(5000)`, so the intent exists and is applied in exactly one place. `nostr/src` has no hex primitive of its own and cannot import the app's `NostrPubkeyHexSchema` from `protocolIds.ts`, because `nostr` must not import from `app`.
  action: blocked — recorded as **F45**. The caps are a policy decision on the untrusted-input boundary, where too low rejects legitimate events, so they want choosing against real event sizes rather than by reflex at the end of a sweep.

- remaining 20 findings — `nostr-event-schema-bounds` (4), `route-json-param-unbounded` (4), `url-scheme` (3), `branded-id-as-cast` (2), `default-nested-container`, `use-parsed-output`, and the app-side members of the two clusters above
  verdict: recorded, not verified
  action: none. Not read in source. Asserting verdicts on findings I have not opened would be exactly the false progress this protocol forbids.

Two prep checks recorded because I caught them before reporting either as a finding:
`transactionDistributionStore` looked like it had zero schema tolerance; it uses
`tolerantRecord(…)`, a repo helper that drops bad entries rather than failing
the record. And `persist-additive-fields` is change-framed ("does `hunk` **add**
a field"), so a conformance pass cannot exercise it — the same structural gap
as `state/persisted-compatibility`, which means **both** of this repo's
catastrophic persisted-data invariants are only checked on diffs.

#### conventions-react-native — done

29 rules, 2,040 requests, 5,137 questions, 3 failed. **20 findings.**
The most serious defect of the whole sweep is here.

- [webview-scheme-escape] app/features/feed/components/thread-embed/LinkEmbedView.tsx (0.90)
  verdict: defect
  evidence: confirmed by reading the installed dependency, not inferred. `react-native-webview`'s `WebViewShared` does this with a url that fails `originWhitelist`: `Linking.canOpenURL(url).then(supported => { if (supported) return Linking.openURL(url); }); shouldStart = false;` — it is **handed to the OS**, not dropped. With `originWhitelist={['http://*','https://*']}`, a page reached from a relay-supplied link could navigate to `intent://`, a custom app scheme or our own `sovran://` deep link and have the system open it with no user tap. And `onShouldStartLoadWithRequest` sits in the `else` branch, so adding a gate without widening the whitelist would never have run for exactly those urls — which is why the rule asks for `['*']` plus a gate rather than a narrower list.
  action: **fixed** in `1ac8de7e`. `originWhitelist={['*']}` so every request reaches the gate, plus `isHttpNavigationUrl` in `shared/lib/url.ts` allowing only http(s). Put in the shared module rather than kept local so the test drives the real function and no component surface is widened for a test — both patterns flagged earlier in this sweep. 12 cases pin it. Verified: type-check 0, 29 tests across 3 url suites, lint 0 errors, knip clean.

- [untrusted-image-uri] MintIcon.tsx, GalleryScreen.tsx:124
  verdict: defect
  evidence: the guard existed one layer away. `imageCache.prefetchImage:71` refuses a non-http(s) scheme via `isSafeImageUrl` and logs `image.prefetch.rejected_scheme`; the render paths had none. `MintIcon.normalizeIconUrl` only trimmed, and `GalleryScreen:150` gated its avatar on `author?.picture` being truthy. So a mint's NIP-11 `icon_url` or a Nostr kind-0 `picture` could be `file:`, `data:` or a custom scheme — refused for caching, accepted for display.
  action: **fixed** in `f5945e38`. Exported `isSafeImageUrl` and applied it at both render sites. Deliberately **not** unified with `isHttpNavigationUrl` despite identical bodies today: a WebView must never load `data:`, an image may legitimately allow `data:image/` raster later, and collapsing them would make a change to one silently change the other.

- [focus-not-foreground] 5 findings — useAmbientNfcArm.ts (0.93), useNostrTierHealth.ts, ShareSignerScreen.tsx, SignerRequestsScreen.tsx, UserMessagesScreen.tsx
  verdict: defect
  evidence: all five use `useFocusEffect`/`useIsFocused` with **zero** `AppState` handling — verified by grep across the cluster. `useFocusEffect` fires on screen focus, not app foreground, so a screen that stays focused across a background/return never re-runs it, and the UI can report NFC armed or a relay subscribed while the resource is gone. The repo uses `AppState` in eight places including `nip46Engine.ts` and `nip46Transport.ts`, so the signer internals handle this and the signer screens do not; there is no shared helper, which is why it is uneven.
  action: blocked — recorded as **F46**. Neither the OS teardown behaviour nor expo-router's refocus behaviour can be settled by reading, and the sweep may not run device scenarios.

- [webview-bridge-props] LinkEmbedView.tsx (0.81)
  verdict: false-positive
  evidence: the rule flags the *presence* of `allowFileAccess` and `setSupportMultipleWindows` regardless of value. `LinkEmbedView` sets both to `false`, which is the hardening, and its fileoverview states there is no bridge — no `injectedJavaScript`, no `onMessage`. The rule cannot tell a safe explicit value from a dangerous one.
  action: none. Left rather than tuned: it is a pack-style compiled rule whose question is right for `true`, and one false positive against a real `onMessage`/`injectedJavaScript` regression is a trade worth keeping.

- remaining 11 — `inline-slot-components` (5), `small-touch-target` (2), `list-unique-keys`, `shadow-clipped-by-overflow`, `key-inside-recycled-row`, `hermes-missing-builtins`
  verdict: recorded, not verified
  action: none. Not read in source. All are render-performance or layout questions, none touching money, keys, persisted data or an untrusted boundary — which is how the three that were read got chosen.

#### conventions-async-tests — done

31 rules, 4,307 requests, **27,977 questions**, 6 failed. **85 findings** —
the largest of any convention file, across 19 distinct rules.

Split by where they land, which is the useful cut: **61 in shipping code**,
17 in tooling (`app/e2e`, `app/codereview/log-doctor`), 7 in tests.

- 61 shipping-code findings
  verdict: defect (cluster-level), blocked
  evidence: the clusters are coherent rather than scattered — `signal-unchecked-after-await` (17), `unbounded-fanout` (10), `sleep-ignores-cancel` (9), `guard-released-on-every-path` (8), `guard-before-await` (7). Spot-verified the money-path member: `wallet/src/operations/defaultOperations.ts:~2030` is a bare `await new Promise(resolve => setTimeout(resolve, DELAY_MS))` inside `executeAutoRedeem`'s history-reconciliation poll, which no abort can interrupt. Worth stating precisely rather than alarmingly: `mgr.wallet.receive()` has already committed by that point, so the cost is a poll outliving navigation, not a stranded payment. Three more `sleep-ignores-cancel` sit in `sovranPaymentConfig.ts` (:133, :405, :555) and a `guard-released-on-every-path` in `wallet/src/machine/createMachine.ts:1501`.
  action: blocked — recorded as **F47**. Sixty-one call sites across cancellation, fan-out and single-flight discipline is a program of work, and the protocol forbids a refactor inside a fix commit. The rule family is the way to enumerate the current set.
  **Depth stated honestly:** one finding was read in source. The other 60 were grouped by rule and location. The cluster verdict is a judgement about the rules' coherence, not sixty individual confirmations, and the follow-up says so.

- 17 tooling + 7 test findings
  verdict: recorded, lower priority
  evidence: `app/e2e/**` and `app/codereview/log-doctor/**` are Node CLIs the app never imports — established earlier in the `errors` domain, where only comment references exist (`MintInfoScreen.tsx:397-399`). Cancellation discipline matters less in a CLI that exits. The 7 test findings (`restore-global-fakes`, `singleton-state-reset`, `fake-timers-with-promises`) are test-hygiene rather than product behaviour.

#### conventions-state — done

34 rules, 3,997 requests, 24,568 questions, 3 failed. **40 findings.**

- [persist-unbounded-collection] 14 findings, 0.75-0.96
  verdict: defect
  evidence: verified the top one properly rather than by grep. `ownedMediaStore.ts:89` is `byBlob: tolerantRecord(z.string().max(600), PersistedEntry)` — key length capped, inner `sourceNoteIds` capped at `.max(2000)`, and **nothing caps the number of entries**. Every blob a user ever uploads accumulates forever. The same holds across 13 persisted stores.
  action: blocked — recorded as **F48**. Severity stated honestly: `tolerantRecord` means this degrades (slower hydration, larger AsyncStorage) rather than failing parse, so it is not the data-loss shape. But `routstrStore` already solved exactly this, trimming in `partialize` against named ceilings, and its comment records why — 1,024 sessions was a schema `.max()` with no trimming, so session 1,025 failed parse and `createMergeWithSchema`, being all-or-nothing, discarded the whole store. **The pattern exists in this codebase and was not propagated.** Adding ceilings and eviction touches durable user data, which the protocol hands back.

- remaining 26 — `render-clock` (6), `derived-state-effect` (5), `inflight-key-missing-input` (4), `migrate-drops-state` (2), `after-hydrate-mutates-state` (2), and eight singletons including `record-key-untrusted` and `persist-hydration-gate`
  verdict: recorded, not verified
  action: none. Not read in source. `migrate-drops-state` (2) and `record-key-untrusted` are the ones worth opening first on a focused pass — the first touches durable data, the second is the prototype-key class already fixed once in `a789dbc6`.

This domain closes the loop on a theme the sweep found repeatedly: the
codebase usually **knows** the answer and fails to carry it to the sibling that
arrived later. Four instances now — `isSafeImageUrl` guarded prefetch but not
render (`f5945e38`), `own()` guarded `decode.ts` but not `interpret.ts`
(`a789dbc6`), `AppState` covered the nip46 internals but not the signer
screens (F46), and `routstrStore` capped its collections while thirteen other
stores did not (F48).

#### contributor-conventions — done

122 rules — the largest in the config. 4,564 requests, **104,417 questions**,
**42.5M input tokens**, 52 failed. **221 findings across 44 distinct rules**,
more than every other convention file combined.

Depth is stated first, because it governs how to read everything below: at
this size, individual triage of 221 findings was not attempted. The top of the
highest-stakes clusters was read in source; the rest are grouped by rule and
location. Where a verdict is a judgement about a cluster rather than a
confirmation of its members, it says so.

- [zod-throwing-parse-untrusted] app/shared/lib/nostr/moderation.ts:73,75 (0.93)
  verdict: intentional
  evidence: read in source. `Tags.parse(JSON.parse(plaintext))` and `Tags.parse(event.tags)` do throw on relay-supplied input — but throwing is this module's contract, not an accident. `decodeMuteList:62-64` already throws `'Invalid mute list'` and `'Unsupported mute list'` by hand, `readMuteList` throws on no relays and on timeout, and `setPersonBlocked:158-175` converts every throw into `Promise.reject(error)` with `scope.dispose()` cleanup. The docstring states the purpose: "never replace unreadable encrypted entries" — refusing loudly is how it avoids clobbering a mute list it could not read.
  action: none. The remaining three (`e2e/capture/import.ts`, `ReceivePaymentRequestQuoteScreen`, `release/site.mjs`) were not read.

- [wallet-logic-in-app] 5 and [payment-logic-in-app-layer] 6 — concentrated in `app/features/send/lib/sovranPaymentConfig.ts` (:133, :255, :405, :555), 0.78-0.94
  verdict: defect (pre-existing, already registered)
  evidence: not newly diagnosed — **F26** already records exactly this: "Receive and mint-quote sequencing, and history reconciliation by polling, live in `app/features/send/lib/sovranPaymentConfig.ts` … Move them beside the `wallet/` operations they override." Both rules independently rediscovered the same file and the same lines, which is corroboration of F26 rather than a new finding.
  action: none. F26 stands as written.

- 44 rules firing, largest clusters: `shared-value-dot-value` (32), `error-passed-on-lossily` (26), `data-mirrored-between-owners` (16), `clock-read-inside-freshness-helper` (15), `runonjs-added` (12), `test-mocks-owned-logic` (11), `restates-owned-values` (9), `route-param-not-identifier` (8)
  verdict: recorded, not verified
  action: none, and the honest reason is scale rather than judgement — 221 findings is more than the rest of the sweep combined, and triaging them at the depth applied elsewhere is its own exercise. Two pointers for whoever picks it up: `route-param-not-identifier` (8) overlaps **F25** (JSON-encoded Colada entries as route params), and `shared-value-dot-value` (32) is the Reanimated `.value`-in-render class, which the config already switched off in its `skill/expo-animation` form as superseded by a house convention — so the doc-compiled copy may be asking a question the config already answered.

## Sweep complete

Every domain in the queue is marked done. The three run-scale facts worth
keeping: the whole sweep asked well over 400,000 questions; the provider
degraded repeatedly (`GatewayInternalServerError`, one `GatewayRateLimitError`)
and cost one domain its completeness; and **no run of the sweep was ever
`complete: true` except `ui` and `bip*`**, so every "0 findings" elsewhere
carries a caveat that is recorded in its own section.

#### nip* pack — unblocked on a fourth attempt

The three-strikes block above was a provider condition, not a repo one, so it
was retried once the NUT and BIP runs showed the provider had recovered.

| attempt | answered | failed |
| --- | --- | --- |
| 1 | 27 of 388 | 16 |
| 2 | 217 of 388 | 171 |
| 3 | 156 of 281 (gap only) | 125 |
| **4** | **373 of 388** | 15 |

96% coverage, 17,531 questions, **19 findings, no new defects.** Fifteen
reproduce verdicts already recorded above — the Primal one-socket-per-request
(intentional; a cache API, not a relay, and the tradeoff is in a comment), the
NIP-04 module (intentional; `protocol = 'nip17'` is the default and NIP-04 is
opt-in legacy), `nip19/length-limit` (false-positive; bech32 held as
user-visible text, hex kept separately) and `verify-against-event-pubkey`
(false-positive; none of those files verifies a signature at all).

Two were previously recorded unverified and are now read:

- [nip01/replaceable-tie-break] partitionOwnEvents.ts:91 (0.76), envelope.ts:275, recipes/wallpapers.ts:144
  verdict: false-positive
  evidence: `partitionOwnEvents` is a classifier — it buckets events into likes, reposts, replies, own notes and deletions. It replaces no stored replaceable event, and the rule's own text says answer false in that case. The other two were not opened.

- [nip46/unknown-method-errors] nip46Engine.ts:244 (0.76) — the only finding not seen on an earlier attempt
  verdict: false-positive
  evidence: the engine does exactly what NIP-46 requires, just not in the flagged chunk. `:865-869` answers an unrecognised method with `NIP46_ERRORS.unsupportedMethod` through `respondDetached`, and `isKnownMethod` at `:873` is `method === 'connect' || Object.hasOwn(methodHandlers, method)` — already prototype-safe, which is the guard `interpret.ts` was missing in `a789dbc6`. The rule fired on the `createNip46Engine` factory at `:244`, which contains no dispatch.

**F43 stands.** `relay/protocol.ts`'s one-socket-per-request did not reappear
here, but 15 requests still went unanswered, so absence is not evidence — the
finding was read in source on attempt 3 and the code is unchanged.
