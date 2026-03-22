# Detectors

`detectors.ts` — protocol-specific detection functions. Each returns a boolean or parsed value. Detectors receive **pre-normalized** input from [normalize](/pipeline/normalize) — they don't strip prefixes or clean strings themselves.

## Interface

```ts
interface Detectors {
  isValidEcashToken(value: string): boolean;
  isPaymentRequest(value: string): boolean;
  isLightningInvoice(value: string): boolean;
  isLightningAddress(value: string): boolean;
  isLnurlp(value: string): boolean;
  getLightningAmount(invoice: string): number | null;
  getPaymentRequestInfo(value: string): PaymentRequestInfo | null;
  parseNpub(value: string): string | null;
}
```

## Default Implementations

The library ships `defaultDetectors` using `@cashu/cashu-ts`, `@gandlaf21/bolt11-decode`, and `nostr-tools`:

```ts
// Ecash token — try to decode, return boolean
isValidEcashToken: (v) => tryDecode(() => getDecodedToken(v)) !== null;

// Payment request — regex prefix check + full decode
isPaymentRequest: (v) =>
  /^creq[ab]/i.test(v.trim()) && tryDecode(() => decodePaymentRequest(v.trim())) !== null;

// Lightning invoice — try bolt11 decode
isLightningInvoice: (v) => tryDecode(() => decode(v)) !== null;

// Lightning amount — extract from bolt11 sections
getLightningAmount: (inv) => {
  const d = tryDecode(() => decode(inv));
  const msats = d?.sections?.find((s) => s?.name === 'amount')?.value;
  return msats ? msats / 1000 : null;
};

// Lightning address — email-like regex
isLightningAddress: (v) => /^...@...$/i.test(v);

// LNURL-pay — prefix regex
isLnurlp: (v) => /^lnurlp:\/\/([\w-]+\.)+[\w-]+(:\d{1,5})?(\/.*)?$/i.test(v);

// Nostr npub — strip nostr: prefix, nip19 decode
parseNpub: (input) => {
  const v = input.replace(/^nostr:/i, '');
  if (!v.startsWith('npub1')) return null;
  return tryDecode(() => nip19.decode(v))?.type === 'npub' ? v : null;
};
```

### Payment request info

`getPaymentRequestInfo` extracts structured data from a Cashu `creq`:

```ts
getPaymentRequestInfo('creqApGF0...');
// →
{
  mints: ['https://mint.example.com'],     // receiver's accepted mints
  amount: 1000,                             // requested amount (undefined = open)
  unit: 'sat',
  transports: [
    { type: 'nostr', target: 'npub1...' },
    { type: 'post', target: 'https://...' },
  ],
}
```

The machine uses this to constrain mint selection and determine delivery transport.

## Custom Detectors

Override via the `detectors` prop on `CocoPaymentUXProvider`:

```tsx
<CocoPaymentUXProvider
  detectors={{
    ...defaultDetectors,
    // Custom ecash detection
    isValidEcashToken: (v) => myCustomTokenCheck(v),
    // Support additional invoice formats
    isLightningInvoice: (v) => defaultDetectors.isLightningInvoice(v) || isBolt12(v),
  }}
/>
```

## Why Detectors Are Separate

Detectors are injected by the wallet, not hardcoded. This means:

1. **Tree-shaking** — wallets that don't support Lightning don't bundle bolt11-decode
2. **Custom protocols** — add BOLT-12, NWC, or other formats without forking the library
3. **Testing** — mock detectors for unit tests without real crypto libraries

The [parse](/pipeline/parse) module orchestrates normalization and detection. Detectors are the leaf functions that answer "is this string a valid X?".
