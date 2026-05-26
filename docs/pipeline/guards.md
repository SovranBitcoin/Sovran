# Guards

`guards.ts` — validates a resolved intent against wallet context. Returns pass/fail results with reasons. The machine uses this to catch problems before entering a flow (e.g. no balance, untrusted mint).

## Intent Validation

```ts
const results = validateIntent(intent, walletContext);
```

Returns `GuardResult[]` — each guard is a named check with a boolean and optional reason:

```ts
interface GuardResult {
  guard: string;
  passed: boolean;
  reason?: LocalizedReason;
}
```

### Guards by intent type

**`sendPaymentRequest`** — three guards:

```ts
validateIntent(
  {
    type: 'sendPaymentRequest',
    option,
    info: { mints: ['https://mint.example.com'], amount: 1000, unit: 'sat' },
  },
  walletContext
);
// →
[
  {
    guard: 'mintSupport',
    passed: true, // at least one of info.mints is in trustedMintUrls
    reason: undefined,
  },
  {
    guard: 'balance',
    passed: false, // no trusted+allowed mint has balance >= 1000
    reason: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance for 1000 sat' },
  },
  {
    guard: 'httpTransport',
    passed: true, // transport includes 'post' or 'http'
    reason: undefined,
  },
];
```

**`meltLightningInvoice`** — balance + amount present:

```ts
validateIntent(
  { type: 'meltLightningInvoice', option: { kind: 'lightningInvoice', amount: 5000 } },
  walletContext
);
// →
[
  { guard: 'balance', passed: true }, // total balance > 0
  {
    guard: 'balanceSufficient',
    passed: false, // total < 5000
    reason: {
      code: 'INSUFFICIENT_BALANCE',
      message: 'Total balance (4200) is less than invoice amount (5000)',
    },
  },
  { guard: 'amountPresent', passed: true }, // invoice has amount
];
```

**`meltLightningAddress` / `meltLnurlp`** — balance + amount required:

```ts
[
  { guard: 'balance', passed: true },
  {
    guard: 'amountRequired',
    passed: false, // always false — user must enter amount
    reason: { code: 'NO_AMOUNT', message: 'Amount must be entered by user before paying' },
  },
];
```

**`receiveToken`, `openMint`, `openProfile`** — no guards (no prerequisites).

**`chooseOption`** — at least one option must not be disabled:

```ts
[
  {
    guard: 'hasViableOption',
    passed: false,
    reason: { code: 'ALL_OPTIONS_DISABLED', message: 'All payment options are disabled' },
  },
];
```

**`ignore`** — always fails:

```ts
[
  {
    guard: 'supported',
    passed: false,
    reason: { code: 'UNSUPPORTED_INPUT', message: 'Unsupported input' },
  },
];
```

## Capability Checks

Separate from intent validation, `checkWalletCapabilities` verifies that the wallet has implemented all flows needed for a given intent:

```ts
const walletCapabilities = new Set<WalletCapability>([
  'amountEntry',
  'mintSelection',
  'optionSelection',
  'proofSelection',
  'tokenReceive',
  'httpTransport',
  'meltQuoteFetch',
]);

checkWalletCapabilities(walletCapabilities, intent);
// → { covered: true, missing: [] }
```

Required capabilities per intent:

| Intent                 | Required capabilities                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `receiveToken`         | `tokenReceive`                                                     |
| `sendPaymentRequest`   | `amountEntry`, `mintSelection`, `proofSelection`, `httpTransport`  |
| `meltLightningInvoice` | `mintSelection`, `proofSelection`, `meltQuoteFetch`                |
| `meltLightningAddress` | `amountEntry`, `mintSelection`, `proofSelection`, `meltQuoteFetch` |
| `meltLnurlp`           | `amountEntry`, `mintSelection`, `proofSelection`, `meltQuoteFetch` |
| `openMint`             | `mintInfo`                                                         |
| `openProfile`          | `profileView`                                                      |
| `chooseOption`         | `optionSelection`                                                  |

### Check all at once

```ts
checkAllCapabilities(walletCapabilities);
// → [{ intentType: 'openProfile', missing: ['profileView'] }]
```

Use this at build/test time to verify your wallet implements all required flows.
