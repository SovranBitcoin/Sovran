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

Raw onchain address-shaped strings are also returned as standalone `onchainAddress` options. The parser only shape-detects the address; outbound onchain payment is disabled later during intent/annotation until send support exists.

```ts
parsePaymentInput('1BM1sAcrfV6d4zPKytzziu4McLQDsFC2Qc', detectors);
// →
{
  type: 'payment',
  container: 'standalone',
  options: [
    { kind: 'onchainAddress', value: '1BM1sAcrfV6d4zPKytzziu4McLQDsFC2Qc', amount: null, source: 'standalone', paramKey: null },
  ],
}
```

## BIP-321 Container

A `bitcoin:` URI is parsed as a container with an address field and key-value parameters:

```ts
parsePaymentInput('bitcoin:bc1q...?amount=0.00001234&lightning=lnbc1...&cashu=cashuBpGF0...', detectors);
// →
{
  type: 'payment',
  container: 'bip321',
  options: [
    { kind: 'ecashToken', value: 'cashuBpGF0...', source: 'bip321', paramKey: 'cashu' },
    { kind: 'lightningInvoice', value: 'lnbc1...', amount: 1000, source: 'bip321', paramKey: 'lightning' },
    { kind: 'onchainAddress', value: 'bc1q...', amount: 1234, source: 'bip321', paramKey: null },
  ],
  bip321: {
    address: 'bc1q...',
    amountBtc: '0.00001234',
    label: null,
    message: null,
    params: { amount: ['0.00001234'], lightning: ['lnbc1...'], cashu: ['cashuBpGF0...'] },
    unsupportedParamKeys: [],
    unsupportedRequiredParamKeys: [],
  },
}
```

Each option carries its `paramKey` for provenance. The address and every parameter value are run through the same detection pipeline.
Parameter keys and the `bitcoin:` scheme are case-insensitive. `amount` is decimal BTC and is converted to sats for onchain fallback options. Onchain options can come from the URI body, bech32/bech32m query keys like `bc=` / `tb=`, or private/silent-payment query keys like `pay=` / `sp=`; outbound onchain payment is disabled later during intent/annotation.

### Recognized BIP-321 parameters

| Parameter          | Protocol              |
| ------------------ | --------------------- |
| `lightning`        | BOLT-11 invoice       |
| `lno`              | BOLT-12 offer         |
| `bc`, `tb`, `bcrt` | Onchain address       |
| `cashu`, `token`   | Ecash token           |
| `creq`             | Cashu payment request |
| `pay`              | Private payment       |
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

Unsupported required parameters (`req-*`) invalidate the URI for routing. `req-pop` and `req-pj` are also treated as unsupported required params because the library does not implement proof-of-payment callbacks or required PayJoin:

```ts
parsePaymentInput('bitcoin:bc1q...?req-pop=sovran%3Apop', detectors);
// → errors: ['Unsupported required bitcoin params: req-pop'], options: []
```

## Option Priority

Options are sorted by priority. When [intent resolution](/pipeline/intent) picks a single option, this order determines which wins:

```ts
paymentRequest(0) > ecashToken(1) > lightningInvoice(2) > lightningAddress(3) > lnurlp(4) > onchainAddress(5);
```

## Deduplication

The same option detected from multiple variants (e.g. raw and stripped) is deduplicated by `kind:value`. Ecash tokens are case-sensitive; everything else is lowercased for comparison.
