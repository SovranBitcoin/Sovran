# Hunch conformance sweep — ledger

The durable record of the autonomous rule-conformance sweep. Procedure:
[sweep-protocol.md](sweep-protocol.md). Read this first; it outlives any one
session. Never delete a row.

Branch: `feat/receive-nut-drop`.

## Domain queue

| # | Domain | Status | Notes |
| --- | --- | --- | --- |
| 1 | `entropy` | in-progress | 4,614 chunks / 3,825 requests on `--all` |
| 2 | `secrets` | pending | |
| 3 | `payments` | pending | |
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

### entropy

_Run in progress._
