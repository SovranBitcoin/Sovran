# coco-payment-ux

Payment flow state machine for Cashu wallets. Parses raw input (QR, paste, NFC), resolves intent, and drives a stateful flow via a flat state machine. The wallet provides handlers and context; the library owns orchestration.

---

## How it works

```
parse → intent → resolveNext → [step handler]
```

1. **parse** — Raw string → `ParsedPaymentInput` (ecash token, payment request, Lightning invoice/address/lnurlp, mint URL, npub, BIP-321).
2. **intent** — Parsed input + wallet context → `ResolvedIntent` (receive, send, melt, choose option, open mint/profile).
3. **resolveNext** — Intent + accumulated context + balances → next `FlowStep` with typed data.
4. **handler** — Wallet implements `StepHandlerMap`; the machine invokes the handler for each step.

The machine holds `{ step, context }` and exposes:

| Method | Purpose |
|--------|---------|
| `send(event)` | Advance the machine with any `FlowEvent`. |
| `changeMint(mintUrl, opts?)` | Select a mint. Without `destination` in context, continues the current flow. Pass `{ persist: true }` to save as preferred mint via `onPersistMint`. |
| `requestMintSelector()` | Open the mint selector for the current flow step. |
| `startSendEcash()` | Start a send ecash flow. Resets context, auto-selects mint, opens amount screen. |
| `startReceiveLightning()` | Start a receive lightning flow. Resets context, opens amount screen for mint quote. |
| `inspect()` | Current `ExecutionState`. Returns a **stable cached object** — safe for `useSyncExternalStore`. |
| `subscribe(listener)` | Fires whenever step or `isExecuting` changes. |
| `reset()` | Clear flow state back to idle. |
| `getContext()` | Current accumulated `FlowContext`. |
| `getStep()` | Current `FlowStep`. |

### States (FlowStep)

```
idle → chooseOption → enterAmount → selectMint → chooseProofs → [terminal]
```

Terminals: `receiveToken`, `confirmSend`, `fetchMeltQuote`, `createMintQuote`, `openMint`, `openProfile`, `error`

### `isExecuting`

Every `ExecutionState` includes `isExecuting: boolean`. It is `true` for the duration of handler dispatch — including any async work the handler does. Input steps (`enterAmount`, `selectMint`, `chooseOption`, `chooseProofs`) skip this flag so the UI can transition without a global lock.

```ts
const { isExecuting } = useExecutionState(machine);
<Button loading={isExecuting} onPress={() => void machine.send(...)} />
```

### `changeMint`

Updates the flow context's `mintUrl` and re-runs `resolveNext`, then dispatches the resulting handler. This means:

- On a **mint quote screen**: `changeMint` → handler calls `createMintQuote` with the new mint → navigates with fresh data.
- On a **melt quote screen**: `changeMint` → `fetchMeltQuote` handler → screen remounts with `key={flowMint}`.

---

## Integration

### 1. `WalletContext`

```ts
interface WalletContext {
  trustedMintUrls: string[];
  mintBalances: Record<string, number>;
  preferredMintUrl?: string;
  proofAmounts: Record<string, number[]>;
}
```

### 2. `StepHandlerMap`

One handler per step — no nesting:

```ts
const handlers: StepHandlerMap = {
  receiveToken: ({ token }) => router.push('/receive', { token }),
  confirmSend: ({ mintUrl, amount, paymentRequest }) => router.push('/send', { ... }),
  fetchMeltQuote: ({ mintUrl, meltTarget, unit, amount }) => router.push('/melt-quote', { ... }),
  createMintQuote: async ({ mintUrl, amount, unit }) => {
    const quote = await manager.quotes.createMintQuote(mintUrl, amount);
    router.push('/mint-quote', { quote });
  },
  enterAmount: ({ unit, constraints }) => router.push('/amount', { ... }),
  selectMint: ({ candidates, amount, unit, destination }) => router.push('/mint-select', { ... }),
  chooseOption: ({ parsed, options }) => showOptionPicker(options),
  chooseProofs: ({ suggestions }) => showProofSelector(suggestions),
  openMint: ({ url }) => router.push('/mint', { url }),
  openProfile: ({ npub }) => router.push('/profile', { npub }),
  error: ({ code, message }) => showError(message),
};
```

### 3. Create machine

```ts
const machine = createPaymentMachine({
  handlers,
  getContext: () => walletContext,
  getUnit: () => 'sat',
});

// On scan or paste:
await machine.send({ type: 'EXECUTE', input: rawInput });

// On user submitting amount:
await machine.send({ type: 'AMOUNT_ENTERED', amount: 1000, mintUrl });

// On user switching mint mid-flow:
await machine.changeMint(newMintUrl);
```

### 4. Events

| Event | Fields |
|-------|--------|
| `EXECUTE` | `input` |
| `OPTION_CHOSEN` | `option` |
| `AMOUNT_ENTERED` | `amount`, `mintUrl`, `destination?` |
| `MINT_SELECTED` | `mintUrl`, `amount?`, `destination?`, `persist?` — use via `machine.changeMint()` |
| `PROOFS_CHOSEN` | `amount` |
| `REQUEST_MINT_SELECTOR` | — use via `machine.requestMintSelector()` |
| `START_SEND_ECASH` | — use via `machine.startSendEcash()` |
| `START_RECEIVE_LIGHTNING` | — use via `machine.startReceiveLightning()` |
| `RESET` | — use via `machine.reset()` |

### 5. React integration

```tsx
const machine = usePaymentMachine({ handlers, walletContext, unit });
const { isExecuting } = useExecutionState(machine);
```

---

## Mint availability

```ts
const mintContext = selectMintContext(machine.getContext(), walletContext);
// .trustedMints — all mints with status ('available' | 'disabled') and reason
// .validMints   — mints that pass constraints and have sufficient balance
// .selectedMintUrl, .amount, .destination
```

---

## Module structure

| Path | Role |
|------|------|
| `parse.ts` | Raw input → `ParsedPaymentInput` |
| `intent.ts` | Parsed + context → `ResolvedIntent` |
| `annotate.ts` | Multi-option annotation (recommended/available/disabled) |
| `guards.ts` | Intent validation, capability checks |
| `mint-selection.ts` | `selectMint`, `selectMintForMelt`, `getValidMintCandidates` |
| `normalize.ts` | Input sanitization, prefix stripping, variants |
| `offline.ts` | Proof composition primitives (subset-sum, fiat rounding) |
| `nfc-fallback.ts` | Fallback option when one transport fails |
| `machine/types.ts` | `FlowStep`, `FlowContext`, `FlowEvent`, `StepHandlerMap`, `ExecutionState` |
| `machine/resolveNext.ts` | Single routing function: intent + context → next step |
| `machine/transitions.ts` | Event handlers: update context, call `resolveNext` |
| `machine/createMachine.ts` | Stateful runtime: send/subscribe/inspect/reset |
| `machine/selectMintContext.ts` | Flow context → mint availability |
| `react/usePaymentMachine.ts` | Hook that creates machine with live context refs |
| `react/useExecutionState.ts` | `useSyncExternalStore` wrapper over `machine.inspect` |
