# Colada

Colada is the payment-flow layer for Coco-based wallets. It owns payment
sequencing, payment-state copy, screen-action availability, subscription events,
chain helpers, and adapter-shaped side effects. Wallet apps own presentation,
routing, storage, native modules, and product-specific enrichment.

The package has two public entry points:

- `colada` for framework-agnostic machine, adapters, copy, history, chain,
  subscription, and capability helpers.
- `colada/react` for `ColadaProvider`, `usePaymentFlowMachine`,
  `useScreenActions`, `useExecutionState`, and `useColadaSubscriptions`.

## What Colada Owns

- Flow sequencing: pasted, scanned, and deep-linked inputs are parsed, annotated,
  guarded, and routed by the payment machine.
- Payment-state copy: user-visible payment labels, timeline copy, status copy,
  action labels, and toast strings resolve through the copy catalog.
- Side-effect channels: operations and notifications are named channels; apps
  provide implementations, but Colada decides when they are fired.
- Update model: a typed subscription bus publishes history, melt, mint, receive,
  mint-info, mint-selector, and screen-action events.
- Chain helpers: the default chain adapter talks to mempool.space and exposes
  fee, address summary, transaction status, broadcast, and confirmation helpers.
- Native seams: clipboard, share, camera, image picker, haptics, notifications,
  Nostr, BLE, NFC, chain, storage, secure storage, QR encode/decode, clock,
  random, and logger integrations are adapter interfaces.

## What Apps Own

- Routes, screens, navigation components, and layout.
- Persistent stores, profile state, selected mint state, and app settings.
- Platform implementations for every adapter.
- Wallet operations that touch Coco, native modules, APIs, or private state.
- Optional copy overrides and screen-entry enrichment.

Colada should not import Expo, Nitro, React Native native modules, Nostr relay
pools, storage clients, or chain libraries directly. Those dependencies stay in
the app behind JSON-shaped adapter contracts.

## Minimal React Setup

This is the smallest useful shape. Real apps usually add operations,
notifications, screen actions, adapters, deep links, and a
`screenActionsBridge`.

```tsx
import React from 'react';
import { ColadaProvider, usePaymentFlowMachine } from 'colada/react';
import type { StepHandlerMap, WalletContext } from 'colada';

function createHandlers(): StepHandlerMap {
  return {
    enterAmount: ({ unit, constraints }) => {
      router.push({ pathname: '/amount', params: { unit, destination: constraints.destination } });
    },
    selectMint: ({ amount, destination }) => {
      router.push({ pathname: '/mint-select', params: { amount, destination } });
    },
    sendComplete: ({ historyEntry }) => {
      router.push({ pathname: '/send-token', params: { historyEntry } });
    },
    mintQuoteCreated: ({ historyEntry }) => {
      router.push({ pathname: '/mint-quote', params: { historyEntry } });
    },
    error: ({ message }) => {
      toast.show(message);
    },
  };
}

export function AppRoot() {
  return (
    <ColadaProvider
      handlers={() => createHandlers()}
      operations={walletOperations}
      notifications={walletNotifications}
      actions={walletScreenActions}
      clipboardAdapter={clipboardAdapter}
      shareAdapter={shareAdapter}
      imagePickerAdapter={imagePickerAdapter}
      chainAdapter={chainAdapter}
      navigation={{ goBack: () => router.back(), scanQr: openScanner }}
    >
      <App />
    </ColadaProvider>
  );
}

export function SendEntryScreen({ walletContext }: { walletContext: WalletContext }) {
  const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });

  return <Button title="Paste or scan" onPress={() => machine.scan(undefined, { source: 'paste' })} />;
}
```

## Provider API

`ColadaProvider` is mounted once with flat props. There is no grouped
`engine`, `callbacks`, `runtime`, or `platform` prop in the shipped React API.

Important props:

| Prop | Purpose |
| --- | --- |
| `handlers` | Factory called with the `PaymentMachine`; returns `StepHandlerMap` navigation handlers. |
| `instance` | Optional `createColada()` instance for framework-agnostic operation/context reuse. |
| `operations` | Wallet I/O the machine can run internally, such as send, receive, melt, mint quote, mint review, status checks, rollback, Nostr DM, and recipient profile lookup. |
| `notifications` | Optional named callbacks for UX and lifecycle events. Missing handlers are no-ops. |
| `actions` | Wallet overrides for predefined `useScreenActions` actions. Defaults cover navigation, operations, copy, and share where possible. |
| `screenActionsBridge` | App-owned bridge for extra action context, subscription binding, entry merge rules, decoration, locale, and source labels. |
| `getOffline`, `getBtcPrice`, `getDisplayCurrency`, `getLocale` | Runtime getters read through refs so long-lived handlers see fresh values. |
| `translations`, `paymentCopyOverrides` | Copy/i18n extensions for payment-state text. |
| `clipboardAdapter`, `shareAdapter`, `cameraAdapter`, `imagePickerAdapter`, `hapticsAdapter`, `notificationsAdapter`, `nostrAdapter`, `bleAdapter`, `nfcAdapter`, `chainAdapter`, `storageAdapter`, `secureStorageAdapter`, `qrEncoderAdapter`, `qrDecoderAdapter`, `clockAdapter`, `randomAdapter`, `loggerAdapter` | JSON-shaped native/platform seams. |
| `scanSources` | Optional explicit scan-source map. When omitted, clipboard and image-picker adapters derive default sources. |
| `deepLinks` | Reactive deep-link input and scheme filtering. Accepted Cashu links are scanned by the machine. |
| `navigation` | Default screen-action navigation callbacks such as `goBack`, `scanQr`, `mintInfo`, and `addMint`. |

Flat provider props win over values carried by `instance`.

## Flow Machine

`usePaymentFlowMachine({ walletContext, unit })` binds the current screen's
wallet context to the provider-owned machine and returns a stable
`PaymentMachine`.

Use the machine for multi-step flows:

- scan/paste/deep link
- choose payment option
- enter amount
- select mint
- choose proofs
- confirm send
- create mint quote
- open mint review
- navigate to receive
- dismiss/error handling

Handlers should only move the user to the screen described by the step payload.
They should not redo balance, mint, payment-method, offline, or parser logic
that the machine has already resolved.

Operations should perform wallet I/O and return facts to the machine. They
should not navigate.

Notifications should present or record side effects. Missing notification
handlers must be treated as intentional no-ops.

## Screen Actions

`useScreenActions(screenType, entryParam)` is for terminal/detail screens that
already have one entry. It returns:

- `entry`: parsed and optionally decorated entry
- `error`: entry parsing or missing-entry error
- `actions`: bound action objects with `available`, `loading`, `reason`,
  optional `variants`, and `execute(params?)`
- `mintUrl`: raw mint URL when present
- `source`: scan provenance label when the bridge provides one
- `suggestions`: amount suggestions for `amountEntry`

`amountEntry` may pass a third argument with `{ amountConfig }`. When omitted,
the provider derives the amount config from wallet context and runtime getters.

Current screen-action contract:

| Screen type | Actions |
| --- | --- |
| `sendToken` | `copy`, `share`, `nfc`, `checkStatus`, `cancel`, `back` |
| `receiveToken` | `redeem`, `back` |
| `mintQuote` | `copy`, `share`, `back` |
| `meltQuote` | `pay`, `cancel`, `back` |
| `paymentRequest` | `confirm`, `cancel`, `back` |
| `receive` | `copy`, `share`, `paste`, `fixedAmount`, `scanQr`, `changeNpcMint`, `back` |
| `mintInfo` | `trust`, `copy`, `share`, `back` |
| `amountEntry` | `setInput`, `toggle`, `next`, `paste`, `scanQr`, `cancel`, `back` |
| `mintSelector` | `select`, `getInfo`, `addMint`, `cancel`, `back` |

`back` is always part of the action surface so dead-end screens have a
non-destructive exit. `cancel` remains available only on screens where it has a
distinct operation or flow meaning.

Emoji token copy is a `sendToken.copy` variant with `variantId: 'emoji'`.
There is no sibling emoji-copy runtime action.

## Copy And Localization

Use `createPaymentCopyResolver`, `resolvePaymentCopy`, `getPaymentCopy`,
`registerPaymentCopyLocale`, and `paymentCopyOverrides` for payment-state text.

Apps may override individual copy keys, but default payment copy belongs in
Colada. New payment states should declare copy keys beside the state/action
logic instead of adding app-screen strings.

## Subscription Bus

`createSubscriptionBus()` exposes:

- `subscribe(filter, listener)`
- `subscribeAll(listener)`
- `publish(event)`

React consumers can use `useColadaSubscriptions()`.

Events are JSON-shaped and typed by `ColadaSubscriptionEvent`, including
`history.updated`, `melt.updated`, `mint.updated`, receive mint/key changes,
mint-info enrichment/fetch events, mint-selector additions, and
`screenActions.changed`.

Screens should subscribe through the bus or through `screenActionsBridge`.
They should not each invent custom polling hooks for payment detail updates.

## Chain Helpers

The default chain implementation is `defaultChainAdapter`, backed by
`createMempoolSpaceChainAdapter()`.

Framework-agnostic helpers include:

- `fetchMempoolAddressStats`
- `summarizeMempoolAddress`
- `getOnchainConfirmationProgress`
- `getOnchainConfirmationInfo`
- `MempoolAddressStatsSchema`

The `ChainAdapter` contract covers fees, address transactions, address summary,
transaction status, broadcast, and optional address subscriptions. Apps can
replace mempool.space with Esplora, Electrum, or a local node by implementing
the same adapter shape.

## Mint Method Capabilities

Mint payment-method support is explicit. Colada derives support from NUT-04
and NUT-05 method-unit metadata via:

- `deriveMintMethodSupportFromInfo`
- `deriveMintMethodCapabilityMapFromTrustedMints`
- `getMintMethodCapability`
- `evaluateMintMethodAmountAvailability`

Missing method-unit metadata is treated as unsupported for that mint, method,
and unit. There is no implicit `bolt11`/`sat` compatibility fallback for a
mint that did not advertise the method.

If a payment method is not implemented by Colada, its variant stays disabled
with a concrete reason instead of pretending the path can execute.

## File Map

- `src/adapters/`: JSON-shaped native/platform contracts.
- `src/react/ColadaProvider.tsx`: provider, context, flat prop API, deep-link
  processing, scan-source derivation, and React hooks.
- `src/machine/`: framework-agnostic payment machine, flow modules, transition
  helpers, and operation/notification types.
- `src/screen-actions/`: action contracts, availability rules, default
  handlers, and entry decoration/merge helpers.
- `src/copy/`: payment copy catalog, locale registration, and resolver.
- `src/subscriptions/`: typed event bus.
- `src/chain/`: mempool.space adapter and onchain confirmation helpers.
- `src/history/`: payment-state predicates, timelines, labels, and warnings.
- `src/mint-capabilities.ts`: method-unit capability derivation and guards.
- `src/amount-actions/`: amount-entry state, fiat/sat conversion, suggestions,
  and offline proof composition support.

## Working Rules

- Prefer root imports from `colada` for framework-agnostic helpers and
  `colada/react` for React hooks.
- Keep app screens declarative: render the step or entry Colada hands back.
- Put native/platform dependencies behind adapters.
- Put app-specific entry enrichment in `screenActionsBridge`.
- Add payment-state strings to the copy catalog, not to app screens.
- Add subscription updates to the typed bus, not per-screen watchers.
- Do not keep dual API shapes or retired sibling actions for previous app code;
  update the one consumer and delete the retired path.
