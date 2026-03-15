# coco-payment-ux

Payment flow orchestration for Cashu wallets. Parses raw input (QR, paste, NFC), resolves intent, and drives a flat state machine. The wallet provides handlers and wallet context; the library owns routing and orchestration.

---

## How it works

```
parse → intent → resolveNext → step → [handler]
```

1. **parse** — Raw string → `ParsedPaymentInput` (ecash token, Lightning invoice/address/lnurlp, payment request, mint URL, npub, BIP-321).
2. **intent** — Parsed input + wallet context → `ResolvedIntent` (receive, send, melt, choose option, open mint/profile).
3. **resolveNext** — Intent + accumulated context + balances → next `FlowStep` with typed step data.
4. **handler** — Wallet implements `StepHandlerMap`; the machine invokes the matching handler for each step.

**Two routing paths:** Scan/paste flows use `resolveNext` (parse → intent → resolveNext). Button flows (`START_SEND_ECASH`, `START_RECEIVE_LIGHTNING`) have no prior intent, so `AMOUNT_ENTERED` and similar events use `resolveFromContext` instead. Both paths check proof composition for `chooseProofs`; the wallet must supply `proofAmounts` in `WalletContext` for offline send rounding to work.

---

## Flow steps

Input steps (user must interact before advancing):


| Step           | Triggered when                               |
| -------------- | -------------------------------------------- |
| `chooseOption` | Multiple payment options detected            |
| `enterAmount`  | Amount required but not yet known            |
| `selectMint`   | Mint selection required                      |
| `chooseProofs` | Exact proof match not possible (swap needed) |


Terminal steps (machine invokes handler and stops):


| Step                    | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `receiveToken`          | Ecash token received — pass to wallet                        |
| `confirmSend`           | Ecash send — call `manager.wallet.send()`                    |
| `navigateToMeltPreview` | Lightning pay — navigate to melt screen with synthetic entry |
| `createMintQuote`       | Lightning receive — call `manager.quotes.createMintQuote()`  |
| `openMint`              | Mint URL scanned                                             |
| `openProfile`           | Nostr npub scanned                                           |
| `dismiss`               | No-op navigation (e.g. mint persisted from home screen)      |
| `error`                 | Unresolvable state — show error                              |


---

## Machine API

```ts
const machine = createPaymentMachine({
  handlers,           // StepHandlerMap — one function per step
  getContext: () => walletContext,
  getUnit: () => 'sat',
  onPersistMint: (mintUrl) => { /* save preferred mint */ },
});
```


| Method                       | Description                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `send(event)`                | Advance the machine with a `FlowEvent`                                                   |
| `changeMint(mintUrl, opts?)` | Select a mint for the current flow. Pass `{ persist: true }` to save via `onPersistMint` |
| `requestMintSelector(opts?)` | Open mint selector. Pass `{ reset: true }` to clear stale context first                  |
| `startSendEcash()`           | Start an ecash send flow                                                                 |
| `startReceiveLightning()`    | Start a lightning receive flow                                                           |
| `reset()`                    | Clear flow state back to idle                                                            |
| `inspect()`                  | Current `ExecutionState` (stable cached object — safe for `useSyncExternalStore`)        |
| `subscribe(listener)`        | Subscribe to step/isExecuting changes                                                    |
| `getContext()`               | Current accumulated `FlowContext`                                                        |
| `getStep()`                  | Current `FlowStep`                                                                       |


### Events


| Event                     | Key fields                                       |
| ------------------------- | ------------------------------------------------ |
| `EXECUTE`                 | `input` — raw scan/paste string                  |
| `OPTION_CHOSEN`           | `option`                                         |
| `AMOUNT_ENTERED`          | `amount`, `mintUrl`, `destination?`              |
| `MINT_SELECTED`           | `mintUrl`, `amount?`, `destination?`, `persist?` |
| `PROOFS_CHOSEN`           | `amount`                                         |
| `REQUEST_MINT_SELECTOR`   | —                                                |
| `START_SEND_ECASH`        | —                                                |
| `START_RECEIVE_LIGHTNING` | —                                                |
| `RESET`                   | —                                                |


### `isExecuting`

`ExecutionState.isExecuting` is `true` while a terminal handler is running (including async work). Input steps (`enterAmount`, `selectMint`, `chooseOption`, `chooseProofs`) do not set this flag.

```ts
const { isExecuting } = useExecutionState(machine);
```

---

## Step handlers

```ts
const handlers: StepHandlerMap = {
  receiveToken: ({ token }) => {
    const entry = buildReceiveHistoryEntry(token);
    router.navigate({
      pathname: '/(receive-flow)/receiveToken',
      params: { receiveHistoryEntry: JSON.stringify(entry) },
    });
  },

  confirmSend: async ({ mintUrl, amount }) => {
    await manager.wallet.send(mintUrl, amount);
    const entry = /* fetch from manager.history */;
    router.navigate({
      pathname: '/(send-flow)/sendToken',
      params: { sendHistoryEntry: JSON.stringify(entry) },
    });
  },

  navigateToMeltPreview: ({ mintUrl, meltTarget, unit, amount }) => {
    const entry: MeltHistoryEntry = {
      id: `melt-preview-${Date.now()}`,
      type: 'melt',
      createdAt: Date.now(),
      mintUrl,
      unit: unit ?? 'sat',
      quoteId: '',
      state: 'UNPAID',
      amount,
      metadata: { phase: 'preview', meltTarget },
    };
    router.replace({
      pathname: '/(send-flow)/meltQuote',
      params: { meltHistoryEntry: JSON.stringify(entry) },
    });
  },

  createMintQuote: async ({ mintUrl, amount, unit }) => {
    await manager.quotes.createMintQuote(mintUrl, amount);
    const entry = /* fetch from manager.history */;
    router.replace({
      pathname: '/(receive-flow)/mintQuote',
      params: { mintHistoryEntry: JSON.stringify(entry), unit: unit ?? 'sat' },
    });
  },

  enterAmount: ({ unit, preselectedMintUrl, constraints }) => {
    const params = { unit };
    if (constraints.destination) params.destination = constraints.destination;
    if (preselectedMintUrl) params.selectedMintUrl = preselectedMintUrl;
    const pathname =
      constraints.destination === 'mintQuote' ? '/(receive-flow)/amount' : '/(send-flow)/amount';
    router.navigate({ pathname, params });
  },

  selectMint: ({ candidates, supportedMintUrls, amount, unit, destination }) => {
    // Fetch mints, compute availability, items = buildMintListItems(allTrustedMints, availability)
    router.navigate({
      pathname: destination === 'mintQuote' ? '/(receive-flow)/mintSelect' : '/(send-flow)/mintSelect',
      params: { unit, mintItems: JSON.stringify(items), ...(destination && { destination }) },
    });
  },

  chooseOption: ({ parsed, options }) => showOptionPicker(options),

  chooseProofs: ({ suggestions, unit }) => showProofSelector(suggestions),

  openMint: ({ url }) => router.navigate({ pathname: '/(mint-flow)/info', params: { mintUrl: url } }),
  openProfile: ({ npub }) => router.navigate({ pathname: '/(user-flow)/profile', params: { npub } }),

  error: ({ code, message }) => showError(code, message),
  dismiss: () => router.back(),
};
```

---

## React integration

```tsx
// Wrap with PaymentFlowProvider (creates and holds the machine singleton):
<PaymentFlowProvider>
  <App />
</PaymentFlowProvider>

// Access the machine:
const machine = usePaymentFlowMachine({ walletContext, unit });
const { isExecuting } = useExecutionState(machine);

// On scan or paste:
await machine.send({ type: 'EXECUTE', input: rawString });

// On amount submitted:
await machine.send({ type: 'AMOUNT_ENTERED', amount: 1000, mintUrl });

// On mint changed:
await machine.changeMint(newMintUrl);
```

---

## Screen actions

Post-terminal screens (e.g. melt quote, send token) use a separate `ScreenActionManager` for actions that run after navigation. Availability is derived purely from the current history entry.

```ts
const manager = createScreenActionManager({
  screenType: 'meltQuote',
  handlers: {
    pay: async ({ entry, manager }) => { /* prepareMeltBolt11 + executeMelt */ },
    cancel: async ({ entry, manager }) => { /* rollbackMelt */ },
  },
  getContext: () => ({ entry, manager, ...extraContext }),
});

// Subscribe to state:
manager.subscribe(() => {
  const { pay, cancel } = manager.inspect();
  // pay.available, pay.loading, cancel.available ...
});

// Update entry (e.g. from coco history:updated event):
manager.setEntry(updatedEntry);

// Execute an action:
await manager.execute('pay');
```

### Action availability


| Screen         | Actions                                                        | Available when                                         |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| `sendToken`    | `copy`, `share`, `nfc`, `copyAsEmoji`, `checkStatus`, `cancel` | Token present and not finalized                        |
| `receiveToken` | `redeem`                                                       | Token present, not yet redeemed                        |
| `mintQuote`    | `copy`, `share`                                                | Quote not yet issued/paid                              |
| `meltQuote`    | `pay`, `cancel`                                                | `pay`: state UNPAID. `cancel`: state UNPAID or PENDING |


---

## Runtime behavior (from logs)

Observations from actual execution:

- **Persist-only mint select** — When `REQUEST_MINT_SELECTOR` is fired from the home screen (`hadDestination: false`, `fromStep: idle`), the flow resolves to `selectMint` with `destination: null`. On `MINT_SELECTED`, the machine takes the persist-only path: `onPersistMint` → `dismiss` → `router.back()`; no send/receive flow. When `hadDestination: true` (e.g. from send/receive flow), context is preserved and `mintUrl` stays in flowContext.
- **chooseProofs step data** — `stepData` includes `proofAmounts` (e.g. `[1,2,4,16,32]`), `suggestions.roundDown.amount`, `suggestions.roundUp.amount`, `mintUrl`, `amount`, `unit`. Triggered when amount cannot be composed exactly from available denominations. Handler shows popup; user selects → `PROOFS_CHOSEN` with chosen `amount` → machine updates `flowContext.amount` → `confirmSend`.
- **selectMint candidates** — Only mints with `balance > 0` appear in `candidates`. When the preferred mint is in the valid set, it is auto-selected; otherwise `selectionNeeded` is true.
- **FlowContext accumulation** — `destination` is set by `START_SEND_ECASH` (sendEcash), `START_RECEIVE_LIGHTNING` (mintQuote), or EXECUTE intent. For send flows, `mintUrl` is cleared when transitioning to `selectMint` so the user can pick.
- **proofAmounts requirement** — `WalletContext.proofAmounts` is required for `chooseProofs`. Without it, the machine skips to `confirmSend` when composition cannot be exact. The wallet must fetch proof denominations per mint.

---

## Wallet context

```ts
interface WalletContext {
  trustedMintUrls: string[];
  mintBalances: Record<string, number>;
  preferredMintUrl?: string;
  /** Per-mint proof amounts — used for offline/proof-composition checks. */
  proofAmounts: Record<string, number[]>;
}
```

---

## Mint availability

```ts
const ctx = selectMintContext(machine.getContext(), walletContext);
// ctx.trustedMints — all mints with status ('available' | 'disabled') and reason
// ctx.validMints   — mints passing flow constraints with sufficient balance
// ctx.selectedMintUrl, ctx.amount, ctx.destination
```

---

## Module structure


| Path                           | Role                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `parse.ts`                     | Raw string → `ParsedPaymentInput`                                            |
| `intent.ts`                    | Parsed input + context → `ResolvedIntent`                                    |
| `annotate.ts`                  | Multi-option annotation (recommended / available / disabled)                 |
| `guards.ts`                    | Intent validation, capability checks                                         |
| `mint-selection.ts`            | `selectMint`, `selectMintForMelt`, `getValidMintCandidates`                  |
| `normalize.ts`                 | Input sanitization, prefix stripping, input variants                         |
| `offline.ts`                   | Proof composition: `composeSatoshis`, `composeFiat`                          |
| `nfc-fallback.ts`              | Fallback options when a transport fails                                      |
| `machine/types.ts`             | `FlowStep`, `FlowContext`, `FlowEvent`, `StepHandlerMap`, `ExecutionState`   |
| `machine/resolveNext.ts`       | Routing function: intent + context → next step                               |
| `machine/transitions.ts`       | Event handlers: update context, call `resolveNext`                           |
| `machine/createMachine.ts`     | Stateful runtime: send / subscribe / inspect / reset                         |
| `machine/selectMintContext.ts` | Flow context → mint availability                                             |
| `screen-actions/`              | Post-terminal action system: `createScreenActionManager`, availability rules |
| `react/usePaymentMachine.ts`   | Hook: creates machine with live context refs                                 |
| `react/useExecutionState.ts`   | `useSyncExternalStore` wrapper for `machine.inspect()`                       |


