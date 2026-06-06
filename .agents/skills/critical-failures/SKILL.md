---
name: critical-failures
description: A living catalog of detrimental, easy-to-reintroduce failure modes in Sovran (lost funds, leaked keys, cross-profile/identity bleed, broken gates) with detection signatures and guards. Use before shipping security/payments/identity/persistence changes, when reviewing such a diff, and APPEND a new entry whenever a new class of critical bug is found or fixed.
---

# Critical failures catalog (self-improving)

These are the failure classes that have actually hurt (or nearly hurt) Sovran:
lost funds, leaked keys, cross-profile/identity bleed, demo data in production,
and red CI. Each entry has a **detection** (a grep or `bg.*`/`store.*` log
signature — pairs with `skill:log-debugging`) and a **guard**. Treat this as a
checklist before security/payments/identity/persistence work, and as a place to
GROW: when you find/fix a new critical class, append an entry using the template.

## How to use

1. Touching seeds/keys, payment routing, persisted shape, profile switch, DMs,
   or build config? Scan the matching entries below first.
2. Reviewing such a diff? Run the entry's detection.
3. New critical class found? Append it (template at the bottom). This file is the
   long-term memory; keep it current.

## Catalog

### CF-1 — Non-random / fixed seed reaches a shipped build
A hardcoded or env-driven mnemonic shipping in preview/production lets anyone
reconstruct keys and drain funds. **Detection:** grep for constant mnemonics
(`abandon`, `TEST_`, `DEBUG_`, 12-word literals), any seed from `EXPO_PUBLIC_*`.
**Guard:** `crypto.getRandomValues` + `@scure/bip39`; debug override double-gated
(`__DEV__` AND `development` profile) and pinned by `appConfigDebugMnemonic.test.ts`.
See `.cursor/rules/secure-storage-key-derivation.mdc`.

### CF-2 — Payment context leaks across flows (ecash sent to the wrong place)
A routing flag from one flow (Routstr "Top up", a Nut-Drop session) survives into
the next, so an ordinary Send pays the wrong target. **Detection:** `store.routstr_topup.*`
without a matching `payment.context.clear`; a `reset()` that exists but is never called.
**Guard:** `clearPaymentContext()` at EVERY flow root (Send/Receive/Scan-QR/NFC/
Nut-Drop/mint-selector). Invariant: clear at the root, preserve mid-flow.

### CF-3 — Private key bytes leak into logs
nsec or a 64-hex private key printed/previewed in a log or diagnostics dump.
**Detection:** grep a capture for `nsec1`, `cashuA/B`, or 64-hex; check new logged
fields. **Guard:** `shared/lib/loggerCore.ts` classifies these as secrets
(`{ _kind, len }`, no preview). Never log raw key material; never weaken redaction.

### CF-4 — Demo/mock data bleeds into a real session
Mock mode persisted, or fixture identities (Bob/Alice) cached and rendered after
the toggle is off. **Detection:** `mock.fixture_metadata_purged` should fire when
mock is off; check `settings-store` persist `version`. **Guard:** persist version
bump + migrate forces mock off; `purgeFixtureMetadata` deletes (and persists the
deletion of) fixture metadata on launch. Mock must be runtime-gated, never captured.

### CF-5 — Cross-profile data bleed / crash on profile switch
Profile B sees profile A's decrypted DMs, balances, or crashes on switch.
**Detection:** `cashu.manager.cleanup_*` + `sqlite_closed` must precede restart;
caches must be viewer-pubkey-scoped. **Guard:** switch restarts the app, cleanup
closes SQLite, nip04/giftwrap caches keyed by viewer. See
`.cursor/rules/profile-switch-teardown.mdc`. Don't make switch in-process without
wiring per-pubkey cache eviction.

### CF-6 — Server decrypts DMs (must stay zero-knowledge)
nagg should relay encrypted envelopes and NEVER decrypt or index plaintext.
**Detection:** grep `nagg` for `decrypt`/`shared_secret`/`private_key` in DM paths;
a test asserting endpoints return ciphertext. **Guard:** client-only decryption
(`dmDecryptPipeline.ts`); nagg stores/returns ciphertext only.

### CF-7 — Embedded private key treated as exclusive
The giveaway P2PK key (`GIVEAWAY_P2PK_SECRET`) is in the app bundle and is
extractable by anyone who reverses a build. **Guard:** only lock LOW-VALUE,
rotatable giveaways to it; never reuse it for anything that must stay private;
high-value drops need server-mediated redemption.

### CF-8 — Persisted shape changed without version+migrate (silent data break)
Changing a Zustand-persist / SQLite shape that an installed build already wrote,
without `version`+`migrate`, silently drops or corrupts user state. **Detection:**
diff touches a `partialize`/persisted schema with no `version` bump. **Guard:**
bump `version`, write `migrate` (`__rules__/caching.md`). This is the ONE place
backwards-compat IS required (see `skill:no-backwards-compatibility`).

### CF-9 — A repo-wide override breaks a dev tool / gate (silent red CI)
A global `overrides` (zod, neverthrow) forced an incompatible version into a
devDependency, crashing `eslint` at config load — lint silently broken for
everyone until noticed. **Detection:** `bun run lint` exits non-zero with a
*stack trace* (not lint errors); a plugin requiring an older peer. **Guard:**
load fragile plugins defensively; run all five gates (`skill:code-cleanliness`)
after any dependency/override change.

### CF-10 — In-progress UI state held only in a child, lost on remount
A value the user typed (e.g. the send amount) lives only in a per-session
closure, not in durable state, so a navigation round-trip (mint selector) blanks
it. **Detection:** a field read from a re-created session/entry with no restore.
**Guard:** stash+restore at the navigation chokepoint (e.g. `amountDraftStore`),
scoped so an unrelated flow can't pick it up.

## Append template

```
### CF-N — <one-line failure class>
<what goes wrong and why it's detrimental>. **Detection:** <grep / log signature>.
**Guard:** <the code/test/rule that prevents it; link the rule or skill>.
```
Add new entries here as they're discovered. Keep detections concrete (a command
or a log event), not vibes.
