# Lightning

Lightning is bridged through Cashu mints: receiving uses a mint **quote**
(BOLT-11 invoice you pay to mint ecash), and sending pays a BOLT-11 invoice via a
mint **melt**.

## What ships

- **BOLT-11** — invoice decoding via `@gandlaf21/bolt11-decode`; pay-to-invoice
  through mint melt quotes.
- **Lightning address (LUD-16)** — pay any `name@domain.com` static internet
  identifier.
- **LNURL-pay (LUD-06)** — `payRequest` flow over bech32 `lnurl1…` or `lightning:`
  URIs.
- **NIP-05 on Lightning sends** — Lightning addresses and NIP-05 identifiers share
  the `local@domain` shape, so Sovran also queries the domain's
  `/.well-known/nostr.json` and surfaces the linked Nostr profile, avatar, and
  Vertex credibility before you confirm.

## Receiving (mint quote)

Receiving Lightning opens a BOLT-11 mint quote with live status. Start it through
the machine and bind `unit` in the route wrapper:

```tsx
// app/app/(receive-flow)/lightningReceive.tsx (route wrapper)
const machine = usePaymentFlowMachine({ walletContext, unit });
// machine.startReceive(...) drives mint selection + BOLT-11 quote + live status
```

## Sending (melt)

Paste or scan a BOLT-11 invoice or Lightning address and let the machine parse and
route it — that is the melt path:

```tsx
// bolt11 / lnaddr → melt quote
void machine.execute(meltTarget, { reset: true });
```

The melt pays from any mint that can cover the amount; mid-flow mint swaps are
available through `app/app/(send-flow)/meltQuote.tsx`. See
[Sending](/wallet/sending) for the full set of machine entry points.
