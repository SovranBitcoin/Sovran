# Parse

`parse.ts` — takes a raw string and detectors, produces a `ParsedPaymentInput` with typed options. Handles standalone strings, BIP-321 containers, UR fragments, mint URLs, and npubs.

## Entry Point

```ts
const result = parsePaymentInput(rawInput, detectors);
```

## Parse Order

The parser tries formats in this order — first match wins:

1. **Empty** → `{ type: 'unknown', errors: ['Empty input'] }`
2. **UR fragment** (`ur:` prefix) → `{ type: 'ur' }` — signal to caller for animated QR assembly
3. **BIP-321** (`bitcoin:` prefix) → parse container, extract options from address + all params
4. **Standalone** — run all detectors against normalized input variants
5. **Mint URL** (`https://` prefix) → `{ type: 'mintUrl', mintUrl: '...' }`
6. **Nostr npub** → `{ type: 'npub', npub: '...' }`
7. **Nothing matched** → `{ type: 'unknown' }`

## Result Structure

```ts
interface ParsedPaymentInput {
  raw: string; // original input
  normalized: string; // after sanitization
  type: 'ur' | 'payment' | 'mintUrl' | 'npub' | 'bip321' | 'unknown';
  container: 'standalone' | 'bip321' | null;
  options: PaymentOption[]; // detected payment methods, sorted by priority
  bip321?: Bip321Container;
  mintUrl?: string;
  npub?: string;
  warnings: string[];
  errors: string[];
}
```

## Standalone Input

For non-BIP-321 strings, the parser produces [input variants](/pipeline/normalize) and tests each against every detector:

```ts
parsePaymentInput('cashu://cashuBpGF0...', detectors);
// →
{
  type: 'payment',
  container: 'standalone',
  options: [
    { kind: 'ecashToken', value: 'cashuBpGF0...', source: 'standalone', paramKey: null },
  ],
}
```

```ts
parsePaymentInput('lnbc10u1pj...', detectors);
// →
{
  type: 'payment',
  container: 'standalone',
  options: [
    { kind: 'lightningInvoice', value: 'lnbc10u1pj...', amount: 1000, source: 'standalone', paramKey: null },
  ],
}
```

## BIP-321 Container

A `bitcoin:` URI is parsed as a container with an address field and key-value parameters:

```ts
parsePaymentInput('bitcoin:?lightning=lnbc1...&cashu=cashuBpGF0...', detectors);
// →
{
  type: 'payment',
  container: 'bip321',
  options: [
    { kind: 'ecashToken', value: 'cashuBpGF0...', source: 'bip321', paramKey: 'cashu' },
    { kind: 'lightningInvoice', value: 'lnbc1...', amount: 1000, source: 'bip321', paramKey: 'lightning' },
  ],
  bip321: {
    address: null,
    amountBtc: null,
    label: null,
    message: null,
    params: { lightning: ['lnbc1...'], cashu: ['cashuBpGF0...'] },
    unsupportedParamKeys: [],
  },
}
```

Each option carries its `paramKey` for provenance. The address and every parameter value are run through the same detection pipeline.

### Supported BIP-321 parameters

| Parameter          | Protocol              |
| ------------------ | --------------------- |
| `lightning`        | BOLT-11 invoice       |
| `lno`              | BOLT-12 offer         |
| `cashu`, `token`   | Ecash token           |
| `creq`             | Cashu payment request |
| `pay`              | Generic pay endpoint  |
| `sp`               | Silent payment        |
| `pj`, `req-pj`     | PayJoin               |
| `r`                | Payment URL           |
| `pop`, `req-pop`   | Proof of payment      |
| `amount`           | BTC amount            |
| `label`, `message` | Metadata              |

Unrecognized parameters generate a warning:

```ts
parsePaymentInput('bitcoin:?lightning=lnbc1...&custom=foo', detectors);
// → warnings: ['Ignored unsupported bitcoin params: custom']
```

## Option Priority

Options are sorted by priority. When [intent resolution](/pipeline/intent) picks a single option, this order determines which wins:

```ts
paymentRequest(0) > ecashToken(1) > lightningInvoice(2) > lightningAddress(3) > lnurlp(4);
```

## Deduplication

The same option detected from multiple variants (e.g. raw and stripped) is deduplicated by `kind:value`. Ecash tokens are case-sensitive; everything else is lowercased for comparison.
