# Animated QR only where a spec and the other wallets carry it

Date: 2026-09-26
Status: Accepted.

## Context

The receive surfaces animated any payload over 500 characters when the caller
opted in, and the two Cashu payment-request surfaces (the hub tab and the
fixed-amount request screen) opted in. A payment request is scanned by other
people's wallets, so what the app displays is a claim about what they can read.

The survey (2026-09-26) of the NUTs and of Minibits, macadamia, cashu.me and
eNuts: NUT-16 (optional) specifies animated QR for **tokens** only, as UR
`bytes` fountain frames, and all four wallets show and scan animated tokens.
No NUT covers an animated NUT-18/26 payment request; NUT-26 instead shrinks the
request (Bech32m, uppercase, BIP-321) so it fits one static code. No wallet
deliberately shows one animated — Minibits only falls back when a static code
fails to render — though every scanner would accept one, since decoded UR
content goes through the same parser as any scan.

## Decision

A surface animates only when a spec and the sibling wallets both support the
animated form for that payload. Today that is Cashu tokens. Payment requests,
invoices, addresses, npubs and unified URIs stay static. The one exception is
a payload larger than a single QR can hold (`MAX_QR_DATA_LENGTH`), which splits
into frames whatever the surface, because the alternative is no code at all;
the Advanced size line names that case rather than promising animation.

No per-surface toggle is added for payment requests: a toggle would only be a
way to show other wallets something they do not display themselves.

## Consequences

- `ReceivePaymentRequestTab` and `ReceivePaymentRequestQuoteScreen` render
  `PaymentInfo` without `animated`; `SendTokenScreen` keeps it.
- `ANIMATE_THRESHOLD` and `MAX_QR_DATA_LENGTH` live in `shared/lib/qr.ts` with
  this rationale beside them.
- Revisit when a NUT specifies animated payment requests or when the sibling
  wallets display them.
