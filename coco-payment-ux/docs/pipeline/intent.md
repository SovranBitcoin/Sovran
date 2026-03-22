# Intent

`intent.ts` — maps `ParsedPaymentInput` to a `ResolvedIntent`. Decouples "what did the user scan?" from "what should we do?".

## Resolution Rules

### Single option — direct resolution

When exactly one option is detected, the machine resolves directly with no user prompt:

```ts
// Ecash token
resolveIntent(parsed, detectors);
// → { type: 'receiveToken', option: { kind: 'ecashToken', value: 'cashuBpGF0...' } }

// Lightning invoice
resolveIntent(parsed, detectors);
// → { type: 'meltLightningInvoice', option: { kind: 'lightningInvoice', value: 'lnbc1...', amount: 1000 } }

// Lightning address
resolveIntent(parsed, detectors);
// → { type: 'meltLightningAddress', option: { kind: 'lightningAddress', value: 'user@mint.example.com' } }

// LNURL-pay
resolveIntent(parsed, detectors);
// → { type: 'meltLnurlp', option: { kind: 'lnurlp', value: 'lnurlp://...' } }

// Payment request
resolveIntent(parsed, detectors);
// → {
//      type: 'sendPaymentRequest',
//      option: { kind: 'paymentRequest', value: 'creqA...' },
//      info: { mints: [...], amount: 1000, unit: 'sat', transports: [...] },
//    }
```

### Multiple options — annotated choice

When multiple options exist (common with BIP-321 URIs), options are [annotated](/pipeline/annotate) and the user is prompted:

```ts
resolveIntent(parsed, detectors, walletContext);
// →
{
  type: 'chooseOption',
  options: [
    {
      option: { kind: 'ecashToken', value: 'cashuBpGF0...', source: 'bip321', paramKey: 'cashu' },
      status: 'recommended',
      reason: { code: 'PAYABLE_ECASH', message: 'Payable with Cashu — no fees' },
    },
    {
      option: { kind: 'lightningInvoice', value: 'lnbc1...', source: 'bip321', paramKey: 'lightning' },
      status: 'available',
      reason: null,
    },
  ],
}
```

Without `walletContext`, all options default to `available`.

### Non-payment inputs

```ts
// Mint URL
resolveIntent(parsed, detectors);
// → { type: 'openMint', url: 'https://mint.example.com' }

// Nostr npub
resolveIntent(parsed, detectors);
// → { type: 'openProfile', npub: 'npub1...' }

// BIP-321 with no recognized options
resolveIntent(parsed, detectors);
// → { type: 'ignore', reason: { code: 'UNSUPPORTED_INPUT', message: 'Bitcoin URI contained no supported payment option' } }

// Unrecognized
resolveIntent(parsed, detectors);
// → { type: 'ignore', reason: { code: 'UNSUPPORTED_INPUT', message: 'Unsupported input' } }
```

## All Intent Types

| Intent                 | When                   | Machine routes to                               |
| ---------------------- | ---------------------- | ----------------------------------------------- |
| `receiveToken`         | Single ecash token     | `handler.receiveToken()`                        |
| `sendPaymentRequest`   | Single payment request | Amount → mint → confirm (constrained by `info`) |
| `meltLightningInvoice` | Single invoice         | Melt flow (amount may be embedded)              |
| `meltLightningAddress` | Single address         | Melt flow (amount required)                     |
| `meltLnurlp`           | Single LNURL-pay       | Melt flow (amount required)                     |
| `chooseOption`         | Multiple options       | `handler.chooseOption()` with annotated list    |
| `openMint`             | Mint URL               | `handler.openMint()`                            |
| `openProfile`          | Nostr npub             | `handler.openProfile()`                         |
| `ignore`               | Nothing actionable     | No handler called, machine stays idle           |

## Payment Request Info

For `sendPaymentRequest`, the intent includes structured info extracted from the `creq` format:

```ts
{
  type: 'sendPaymentRequest',
  option: { kind: 'paymentRequest', value: 'creqA...' },
  info: {
    mints: ['https://mint.example.com'],
    amount: 1000,           // undefined = open amount
    unit: 'sat',
    transports: [
      { type: 'nostr', target: 'npub1...' },
      { type: 'post', target: 'https://...' },
    ],
  },
}
```

The machine uses `info` to:

- **Constrain mint selection** — only intersection of receiver's mints and sender's trusted mints
- **Skip amount entry** — when `info.amount` is set
- **Determine transport** — HTTP POST, Nostr DM, or in-band delivery
