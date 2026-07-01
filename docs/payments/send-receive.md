# Send and receive

The send/receive flow is driven by a state machine in the `wallet` package:
**amount → mint → recipient → execute**. The app renders the machine's steps as
Expo Router screens; the machine owns the transitions.

## The flow

- **Send flow state machine** — the wallet machine drives amount → mint →
  recipient → execute.
- **Recipient identity enrichment** — NIP-05 + Nostr profile resolved before you
  confirm.
- **Mint revalidation** — mint health is revalidated on amount entry.
- **Token detail share screen** — copy (text or emoji), share, and NFC
  side-by-side.
- **Receive flow** — mint selection, BOLT-11 mint quote, live quote status.
- **Lightning melt** — pay an invoice from any mint that can cover it.
- **Multi-rail fallback** — BIP-321 rails dim on failure; remaining rails are
  offered inline.

## Code

- [Sending](/wallet/sending) — `machine.startSend`, `startSendEcash`, `execute`.
- [Receiving](/wallet/receiving) — `machine.startReceive`, `useScreenActions('receiveToken', …)`.
- [Lightning](/payments/lightning) — BOLT-11, LNURL, Lightning addresses.

## Offline handoff

Ecash send works without network once spendable proofs are selected. Share
targets include QR, system share, NFC, and the BitChat BLE mesh — see
[NFC and BitChat](/offline/nfc-and-bitchat). Outgoing tokens the recipient never
claims stay live on the mint; the Transactions Pending tab surfaces a
"Cancel N pending" footer that mass-reclaims them, with per-row
swipe-to-cancel for single sends.
