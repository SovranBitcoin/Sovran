# NUT-18 transport: bitchat

> Draft spec for cashubtc/nuts — a **transport definition for NUT-18 payment
> requests over the bitchat BLE mesh**. Local document only; nothing here is
> posted upstream automatically. The contribution is deliberately small: no
> new protocol, just a way to run the existing payment-request flow over a
> Noise session between two nearby devices, plus the capability beacon that
> makes the exchange discoverable.

Status: implemented (Sovran iOS + Android, vendor extension); seeking
feedback before a cashubtc/nuts PR.

## Motivation

bitchat gives two phones an encrypted channel (Noise XX) with no internet.
Cashu gives them a bearer-token money format. Gluing them naively — pasting
a `cashuA…` token into a chat message — has two failure modes:

1. **Bearer broadcast**: bitchat's private DMs cap content at 255 bytes, so
   multi-proof tokens only fit on the *public* mesh, readable (and
   claimable) by every peer in range.
2. **Blind locking**: P2PK-locking the token (NUT-11) fixes the theft
   problem but creates a worse one — if the receiver's wallet can't redeem
   the lock, the funds are destroyed for both sides. The sender must never
   have to guess.

NUT-18 already solves the second problem in the general case: the receiver
hands the sender a payment request carrying their spending condition
(`nut10`) and trusted-mints allowlist (`m`). This document specifies how to
run that exchange **in-band over the mesh**, so the sender always pays
against a request the receiver just issued.

## Overview

```
 Sender                                Receiver
   │  0xA0 cashu_solicit                  │
   │ ────────────────────────────────────▶│  builds single-use PaymentRequest
   │                 0xA1 cashu_request   │  (id, unit, m=trusted mints,
   │ ◀──────────────────────────────────── │   nut10=P2PK unless sender-offline)
   │  …amount entry, proof selection…     │
   │  0xA2 cashu_payment                  │
   │ ────────────────────────────────────▶│  validate id/mint/lock → enqueue
   │           0xA3 status: received      │
   │ ◀──────────────────────────────────── │  …mint swap…
   │           0xA3 status: redeemed      │
   │ ◀──────────────────────────────────── │
```

All four payloads ride bitchat's `noiseEncrypted` packets (AEAD'd,
transport-fragmented for large sizes) as **typed Noise payloads**: the first
plaintext byte is the payload type, the rest is the value. Stock bitchat
clients drop unknown payload types silently on both platforms, so the
exchange is invisible to non-implementing peers — and senders only initiate
it with peers that advertised the capability beacon.

Per NUT-18, a payment request whose `transport` is empty means the payment
is returned in-band — here, over the same Noise session as a
`cashu_payment` payload.

## Wire format

### Capability beacon (announce TLV `0xF0`)

Appended to the bitchat announce payload (a TLV stream; vanilla decoders
skip unknown types) **before signing**, so the Ed25519 announce signature
covers it and vanilla verification still passes.

```
type   = 0xF0
length = 6
value  = "NUTB" (4) | version 0x02 (1) | flags (1)
flags  : bit0 = answers cashu solicits over Noise (payloads below)
         bit1 = auto-redeems received ecash (informational, drives UI)
         bits 2–7 reserved: 0 on send, ignored on receive
```

Golden vector (both capability bits): `f0 06 4e 55 54 42 02 03`

The beacon deliberately carries **no key material and no mint list** — both
travel per-exchange inside the payment request, so the beacon can never go
stale and there is no static key broadcast to correlate a user across
nickname changes. Decoders MUST ignore trailing value bytes (append-only
evolution); an unknown version means "treat the peer as vanilla".

### Noise payloads `0xA0`–`0xA3`

Self-assigned vendor range, clear of upstream's `0x01`–`0x11` allocations
and the `0x20`+ range informally used by Android file transfer and PR
#1053. There are no per-payload magic or version bytes: the Cashu artifacts
are self-describing (`creqA…` carries its own prefix and version; NUT-18
owns format evolution) and everything else correlates on IDs the endpoints
issued, so foreign content on a colliding type byte fails parse or
correlation and is dropped. All layouts are append-only — decoders ignore
trailing bytes.

```
0xA0 cashu_solicit          solicitId (8 random bytes) | flags (1)
                            flags bit0 = sender-offline: the sender intends
                            a bearer payment from existing local proofs;
                            the receiver MUST omit nut10 from its request.

0xA1 cashu_request          solicitId echo (8) | UTF-8 serialized request
                            The string MUST start "creq". Single-use,
                            recommended expiry 120 s. The request SHOULD
                            carry: a fresh `i`, `u`, `s = true`, `m` = the
                            receiver's trusted mints (empty = any), and
                            `nut10 = {k:"P2PK", d:"02"+x-only key}` unless
                            the solicit was sender-offline. `transport` is
                            empty (in-band reply).

0xA2 cashu_payment          UTF-8 NUT-18 PaymentRequestPayload JSON:
                            {"id": <request i>, "mint", "unit", "proofs"}

0xA3 cashu_payment_status   status (1) | reason (1) | UTF-8 payment id
                            status: 0x01 received   (validated + queued)
                                    0x02 redeemed   (swapped at the mint)
                                    0x03 rejected
                            reason (rejected only, else 0x00):
                                    0x01 untrusted mint   0x02 invalid
                                    0x03 mismatch         0x04 duplicate
```

Golden vectors (solicitId `0102030405060708`, payment id `x1`):

```
solicit (offline)   a0 0102030405060708 01
request             a1 0102030405060708 63726571…        ("creq…")
payment             a2 7b226964223a…                      (JSON)
status received     a3 01 00 7831
status rejected     a3 03 01 7831                         (untrusted mint)
```

Solicit timeout: 10 s with one retry **using the same solicitId** (a slow
response to the first attempt still correlates). A timeout is an abort —
"couldn't confirm receiver" — never a downgrade to an unsolicited send.

## Sender rules (the safety matrix)

| Receiver state              | Sender intent | Action                                              |
| --------------------------- | ------------- | --------------------------------------------------- |
| request with `nut10`        | online        | pay P2PK-locked, mint ∈ `m`. No consent needed.     |
| request without `nut10`     | offline       | bearer from local proofs, mint ∈ `m`, with consent. |
| `m` ∩ sender's mints = ∅    | any           | abort, naming both sides' mints.                    |
| beacon set, solicit timeout | any           | abort (an explicit fallback may be offered).        |
| no beacon (vanilla peer)    | any           | out of scope (sender's client decides; Sovran uses a public-broadcast bearer send behind strong consent). |

Two mismatches are hard aborts, never silent downgrades: an online send
whose request carries no lock (sending would mean unsolicited bearer
proofs), and an offline send whose request demands a lock (existing proofs
cannot satisfy it). Senders MUST verify the created token byte-exactly
against the request's `nut10` before transmitting.

## Receiver rules

Validate every inbound payment against the request actually issued: known
`id`, not yet claimed (single-use), same Noise peer it was issued to, mint
inside `m` (empty = any), unit match, and the proofs locked to exactly the
issued key (or bearer iff the request was bearer). Always answer with a
status — `received` on acceptance *and on duplicate deliveries* (so a
sender that missed the first ack converges), `rejected` with a reason
otherwise. A rejected payment leaves the request open for a retry.

The mint allowlist is the receiver's pre-money trust gate: a hostile sender
can never park value at a mint the receiver wouldn't choose, because the
payment is rejected before any wallet state is touched.

## Relationship to existing work

- **permissionlesstech/bitchat #784** — >255-byte private messages. This
  transport sidesteps the cap entirely (typed Noise payloads are
  fragmented by the existing transport layer), matching the maintainer's
  preference for structured payloads over long raw text (#1327).
- **bitchat-android #506 (bitpoints)** — same instinct (capability
  negotiation + cashu over the mesh); this draft replaces the bespoke
  payload format with plain NUT-18 artifacts.
- **bitchat #1053** — Lightning/Cashu Noise payloads at `0x20`/`0x21`;
  this draft needs no new packet model and no protocol-version bump.
- A companion note asks bitchat upstream to document a vendor range for
  announce TLVs and Noise payload types (see `upstream-issue-draft.md`).

## Reference implementation

Sovran (this repo): codecs + golden-vector tests in
`modules/bitchat-module/src/nutDropProtocol.ts` and
`__tests__/nutDropProtocol.test.ts`; transport semantics (planning,
request issuance, validation, delivery tracking, auto-redeem) in
`@sovranbitcoin/colada` `src/transport/`.
