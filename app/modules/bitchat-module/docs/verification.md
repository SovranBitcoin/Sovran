# Nearby payment hardening verification

Reviewed on 2026-10-03 against the working tree based on `40d978b7`.
The [decision](../../../docs/adr/0023-quiet-nearby-payments.md) and
[wire contract](README.md) define the resulting behavior.

## Resolved review findings

- **Public neighbor noise:** normal wallet discovery uses a separate BLE service;
  explicit visible chat/network surfaces own public-mesh participation. Automatic
  favorite exchange has been removed from payment discovery.
- **Receiver-screen dependency:** one account-level provider discovers wallets,
  maintains a standing request and warms profiles while Home is open.
- **Unproved payment identity:** fresh signed capabilities must bind to the
  authenticated remote Noise static key. Announce/favorite fields cannot qualify
  a payment row. Fixed-amount, single-use and unsupported lock constraints are
  refused by the standing-wallet capability boundary.
- **Hidden amount entry:** nearby sessions distinguish radar-inline and routed
  presentation, so selecting a recipient from Send opens a visible amount screen.
- **Mutable-recipient delivery:** the recipient/request is durably bound to the
  Coco send operation before execution. A later UI selection cannot redirect it.
- **Duplicate receive and uncertain delivery:** both transports carry the same
  persisted NUT-18 payload. Recovery republishes the original signed Nostr event.
  Coco owns claim deduplication and settlement; transport ACKs do not mark funds
  received. Nonterminal Nostr attempts trigger Coco recovery instead of getting
  permanently marked seen.
- **Hostile inbox exhaustion:** lock, local-request, mint-trust and DLEQ admission
  happen before durable inbox allocation. A failed write no longer poisons every
  later drain. Independent outbound failures do not starve the remaining queue.
- **Recovery material loss:** the journal is in the shared secure vault. Rejected
  inputs remain encrypted after Coco discards its payload. Legacy unredeemed
  queue entries no longer expire merely through age or retry exhaustion.
- **Profile and history races:** stale native/private events are scoped to their
  profile; queue redemption uses its captured Manager, and legacy history lookup
  uses the child receive operation's canonical ID instead of a set difference.
- **Stock chat framing:** default chunks remain below the `0xFF` extension marker.
  Wallet control traffic is suppressed from chat history and bubbles.

An independent read-only Codex review found navigation, inbox, storage-barrier,
encrypted-persistence, original-event replay, type-import and test-fixture defects.
Those findings were addressed and the affected checks rerun. A second pre-commit
review found inbound recovery blocking outbound deliveries and missing receive
history annotations. Separate directional concurrency guards and canonical
receive annotations fixed both; regressions failed before each fix and passed
after it. Sibling Bitchat
repositories were read-only research inputs.

## Verification performed

| Check | Result and scope |
| --- | --- |
| Workspace TypeScript | App iOS/Android, wallet and Nostr checked; no type errors after fixture corrections. |
| App ESLint | Full app lint: zero errors, 210 warnings. Final parser cleanup checked separately. |
| Wallet Vitest | 104 suites, 1,595 tests passed, without live-mint tests. |
| App Jest | Full run: 576 suites, 5,561 assertions and 168 snapshots passed before final parser/legacy-queue cleanup. Focused affected suites were rerun after those edits. The full runner reported Routstr recovery imports after teardown and stayed alive; it was interrupted after assertions completed. This is recorded as F55, not a clean full-run exit. |
| Coco dual delivery | Installed Coco plus in-memory repositories and a synthetic mint: concurrent BLE/Nostr input and later replays produced one swap, one attempt and one receive history entry. No funded/live mint was contacted. |
| Secure persistence | Existing secure-vault regression tests plus delivery restart, rejected-payload retention and transient-write recovery tests passed. |
| E2E schema | JSON scenarios are valid, compact and registered. `send.nearby.select` is a physical, unfunded navigation scenario; it was not run on devices. |
| Metro | Both iOS and Android exports passed. Dependency-export fallback warnings remain. |
| iOS native | `BitChatModule` compiled for the iOS simulator with signing disabled. |
| Android native | `:bitchat-module:compileDebugKotlin` passed offline in a temporary Expo-generated project, compiling the owned bridge and patched vendor sources. The generated project reported the installed Expo/template version difference and dependency deprecations; this was module compilation, not a release APK build. |
| Pre-commit audit | Independent review findings reproduced and fixed; final focused app run: 12 suites, 77 tests. Wallet ownership/standing/deduplication run: 4 suites, 92 tests. Workspace types and affected ESLint pass. Both platform bundles were rebuilt after the fixes. |
| Diff and docs | Whitespace checks and the decision/wire-contract link chain checked. |

## Remaining proof boundary

No two-phone payment or public-relay settlement was performed. Physical
notification silence, iOS/Android radio interoperability, background suspension,
profile/radio toggles, public relay hops, native storage interruption and
simultaneous real BLE/Nostr arrival still need the matrix in
[F58](../../../../docs/architecture/follow-ups.md). These are device verification
gaps, not evidence of successful native delivery.

Quiet discovery is not radio invisibility. Stock-mesh participation is explicitly
visible, and a hidden wallet cannot depend solely on stock peers to relay to it.
An idle warm directory also does not guarantee zero-latency cold discovery or
instant profile metadata when connectivity is unavailable.
