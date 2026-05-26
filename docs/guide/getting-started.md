# Getting Started

## Two-Layer Architecture

Colada has two layers:

1. **`createColada(config)`** — framework-agnostic TypeScript core. Creates an instance with built-in operations and live wallet context tracking from a coco-cashu-core Manager.
2. **`ColadaProvider`** — thin React wrapper. Accepts the instance plus app-specific concerns (handlers, notifications, navigation).

## Minimal Setup

```tsx
import { useManager } from 'coco-cashu-react';
import { createColada } from 'colada';
import { ColadaProvider } from 'colada/react';

function PaymentProvider({ children }) {
  const manager = useManager();

  const instance = useMemo(
    () =>
      createColada({
        manager,
        platform: {
          clipboard: { write: (text) => Clipboard.setStringAsync(text).then(() => {}) },
          share: (content) => Share.share({ message: content.message }).then(() => {}),
          nfc: nfcAdapter,
          scanSources: { clipboard: readClipboard, gallery: scanGallery },
          createURDecoder: () => new URDecoder(),
        },
        sendNostrDM: async (nprofile, message) => { /* ... */ },
        getOffline: () => offlineRef.current,
        getBtcPrice: () => priceStore.getBtcPrice(currency),
        getDisplayCurrency: () => ({ code: 'usd', symbol: '$' }),
        enrichMintListItem: (url) => getAuditData(url),
        enrichMintReviewInfo: (url) => getAuditData(url),
      }),
    [manager]
  );

  return (
    <ColadaProvider
      handlers={(machine, refs) => createHandlers({ machine })}
      engine={{
        instance,
      }}
      callbacks={{
        notifications: createNotifications(),
        actions: screenActionHandlers,
        screenActionsBridge: bridge,
      }}
      runtime={{
        getOffline: () => offlineRef.current,
        getBtcPrice: () => priceStore.getBtcPrice(currency),
        getDisplayCurrency: () => ({ code: 'usd', symbol: '$' }),
      }}
      platform={{
        scanSources,
        createURDecoder: () => new URDecoder(),
        nfcAdapter,
        deepLinks: { url: linkingUrl, customSchemes: ['myapp'] },
        navigation: { scanQr, mintInfo, addMint, goBack },
      }}
    >
      {children}
    </ColadaProvider>
  );
}
```

## What the Instance Provides

`createColada` builds:

- **Wallet context tracking** — subscribes to Manager events (`proofs:*`, `mint:*`) and maintains a live `WalletContext` with balances, trusted mints, and proof amounts
- **Built-in operations** — `executeSend`, `executeMintQuote`, `executeMelt` (with LNURL resolution), `executeReceive`, `buildMintListItems`, `buildMintReviewInfo`, `checkSendStatus`, `rollbackSend`, `rollbackMelt`, `isMintTrusted`, `trustMint`, `executeNfcSend`, `linkTransaction`, `sendNostrDM`
- **Enrichment** — optional `enrichMintListItem` and `enrichMintReviewInfo` callbacks inject app-specific data (KYM scores, audit data) into mint list items and review info

## Handlers, Operations, Notifications

| Role              | What it does                            | What it doesn't do                     |
| ----------------- | --------------------------------------- | -------------------------------------- |
| **Handlers**      | Navigate given prepared step data       | Check balance, validate, derive rules  |
| **Operations**    | Run async wallet I/O, return facts      | Navigate, show UI                      |
| **Notifications** | Show feedback + persist state changes   | Control flow — missing keys are no-ops |

The machine decides which handler to call. Handlers never check "should I show amount entry?" — the machine already resolved that.

```ts
// Handler — receives fully-resolved step data, just navigates
sendComplete: ({ historyEntry }) => {
  router.navigate({ pathname: '/sendToken', params: { sendHistoryEntry: historyEntry } });
},

// Notification — UI feedback (optional popup, ignored if not registered)
INSUFFICIENT_BALANCE: () => balanceTooLowPopup(),

// Notification — state change (persist to store, also optional)
onPreferredMintChanged: ({ mintUrl }) => mintStore.setSelectedMint(pubkey, mintUrl),
onTransactionCreated: ({ transactionId }) => captureLocation(transactionId),
```

## Notifications for State Changes

Notifications serve dual purpose — UI feedback and state persistence. The machine emits these at the right time; the wallet decides what to do:

| Notification | Purpose |
|---|---|
| `onPreferredMintChanged({ mintUrl })` | Persist preferred mint selection |
| `onNpcMintChanged({ mintUrl })` | Sync NPC/Lightning-address mint to server |
| `onTransactionCreated({ transactionId, type, mintUrl, ... })` | Link scan history, capture location |
| `onP2PKReceiveCompleted({ hadP2PKProofs })` | Regenerate P2PK key if needed |
| `onMeltQuoteCreated({ mintUrl, operationId, ... })` | Track melt lifecycle |
