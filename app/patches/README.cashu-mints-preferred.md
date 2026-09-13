# Cashu payment-request compatibility patch

The registered patch for `@cashu/cashu-ts@5.0.0-rc.4` preserves NUT-18
`mp` and NUT-26 tag `0x09`. It adds the optional ninth constructor parameter
`mintsPreferred`, preserving the first eight arguments and the published
ESM/types entry points used by the app and wallet.

The patch also rejects NUT-18 `sm` and NUT-26 tag `0x0a`. The installed SDK
otherwise silently discards these required payment-method constraints. Until
the wallet can enforce method/unit compatibility and the additional method fee,
rejecting the request prevents unsupported or insufficient payments.

The change to `sm` and net input-fee handling is in
[NUT-18 revision df1ca22](https://github.com/cashubtc/nuts/blob/df1ca22e77756556223ab05cea89500402922a3e/18.md).
The wallet regression uses its published preferred-mint/method-fee test vector
and an independently constructed NUT-26 supported-method TLV.

## Supported behavior and limits

Strict requests restrict payment to their listed mints. Advisory requests rank
listed mints first and permit other funded trusted mints, including during
NFC currency switching. The wallet removes only the advisory list in the
private input copy passed to Coco's legacy outgoing parser.

Nostr payment payloads use the request's `i` field and explicitly prepare proofs
in its unit. An absent identifier is omitted. NFC and Nostr request sends
reject all NUT-10 conditions before preparing proofs because these direct send
adapters do not preserve the complete lock contract. HTTP preparation retains
Coco's supported P2PK validation path.

Incoming Coco 2.0.0 request claims reject untrusted mints and mints outside the
durable operation's list. Both receive screens therefore emit strict requests
and explain why Preferred is disabled. Enabling it needs an add/trust-mint
claim workflow with durable resume; ordinary token recovery is insufficient.

Coco's default send handler currently emits the gross requested amount and its
public durable prepare API has no recipient-fee option. NFC, Nostr, and HTTP
payment requests therefore require verified zero-fee keysets for the request
unit before preparing proofs. This includes inactive keysets, whose existing
proofs can be selected without a swap. Charged, missing, or unknown fee data
stops the payment with an actionable alternative; fees in unrelated units do
not block it. Ordinary token sends are unaffected. Supporting fee-bearing
requests requires a durable implementation of NUT-18's net-amount contract.

## Installation and verification

The patch is installed through the root `patchedDependencies` registration.
Run `bun install` after switching branches; do not manually reapply it to an
already patched dependency. Keep the patch under `app/patches` and retain only
one registration. Bun's internal `.bun-tag-*` markers do not belong in patches.

The final review verified application against pristine published 5.0.0-rc.4
ESM and declaration files, and ran the installed wallet's full tests and
TypeScript check. Real Numo taps, fee-bearing settlement, and native timing
remain separate device checks.

Remove or revise the patch when a Coco-compatible SDK exposes `mintsPreferred`
and method constraints. Merely decoding `sm` is insufficient: the wallet must
honor it before sending. Recheck constructor compatibility on upgrades.
