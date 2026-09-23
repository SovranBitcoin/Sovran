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
| 3 | `payments` | in-progress | |
| 4 | `money` | pending | |
| 5 | `state` | pending | |
| 6 | `nostr` | pending | |
| 7 | `errors` | pending | |
| 8 | `ui` | pending | |
| 9 | `nip17`, `nip59` | partly done | see the pre-sweep rows below; re-run to confirm |
| 10 | `nip61`, `nip60`, `nip46`, `nip65`, `nip04`, `nip19`, `nip01`, `nip06` | pending | |
| 11 | `nut06`, `nut10`, `nut11`, `nut12`, `nut18` | pending | |
| 12 | `bip32`, `bip39`, `bip43`, `bip21`, `bip321` | pending | |
| 13 | `agents-md` | pending | |
| 14 | `skill/*` (by skill) | pending | |
| 15 | `doc/*` (by convention file) | pending | |

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
