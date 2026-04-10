# Annotate

`annotate.ts` — scores each `PaymentOption` against wallet context, assigning `recommended`, `available`, or `disabled` status. Used when multiple options exist (typically from a BIP-321 URI) and the user needs to choose.

## How It Works

Each option kind has a rules table. The first matching rule wins:

### Payment request rules

```ts
[
  {
    // Trusted mint with sufficient balance → best option
    applies: (option, ctx, info) => hasMatchingMintWithBalance(option, ctx, info),
    status: 'recommended',
    reason: { code: 'PAYABLE_ECASH', message: 'Payable with Cashu — no fees' },
  },
  {
    // No trusted mint in the request → can't use this
    applies: (option, ctx, info) => noTrustedMintInRequest(option, ctx, info),
    status: 'disabled',
    reason: { code: 'NO_VALID_MINT', message: 'No valid mint' },
  },
  {
    // Trusted mint but insufficient balance → can't use this
    applies: (option, ctx, info) => !hasMatchingMintWithBalance(option, ctx, info),
    status: 'disabled',
    reason: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' },
  },
];
```

### Lightning rules (invoice, address, lnurlp)

```ts
[
  {
    // Any balance available → can pay via Lightning
    applies: (option, ctx) => totalBalance(ctx) > 0,
    status: 'available',
    reason: null,
  },
  {
    // No balance → can't pay
    applies: () => true,
    status: 'disabled',
    reason: { code: 'NO_BALANCE', message: 'No balance' },
  },
];
```

### Ecash token

No rules — always `available`. (Receiving a token has no prerequisites.)

## Annotation Result

```ts
annotateOptions(options, walletContext, detectors);
// →
[
  {
    option: { kind: 'ecashToken', value: 'cashuBpGF0...', ... },
    status: 'recommended',
    reason: { code: 'PAYABLE_ECASH', message: 'Payable with Cashu — no fees' },
  },
  {
    option: { kind: 'lightningInvoice', value: 'lnbc1...', ... },
    status: 'available',
    reason: null,
  },
]
```

## Promotion

After annotation, options are sorted by status (`recommended` → `available` → `disabled`). If **no** option is naturally `recommended`, the first `available` option is promoted to `recommended` — the UI always has a highlighted default.

## Where It's Used

The machine calls `annotateOptions` when resolving a `chooseOption` intent. The handler receives the annotated list and presents it as a popup:

```ts
// Intent resolution
resolveIntent(parsed, detectors, walletContext);
// → { type: 'chooseOption', options: AnnotatedOption[] }

// Handler shows popup
chooseOption: (stepData) => {
  paymentOptionsPopup({ ...stepData, machine });
},

// User selects — disabled options are blocked
const handleSelect = (annotated: AnnotatedOption) => {
  if (annotated.status === 'disabled') return;
  machine.chooseOption(annotated.option);
  close();
};
```

Without wallet context (no `WalletContext` available), all options default to `available` — no recommendations, no disabling.
