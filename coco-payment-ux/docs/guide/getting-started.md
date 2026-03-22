# Getting Started

Mount `CocoPaymentUXProvider` once at your app root. All hooks read from this context.

## Provider

```tsx
<CocoPaymentUXProvider
  handlers={(machine, refs) =>
    createHandlers({
      machine,
      onOptionDismiss: () => refs.getOptionDismiss()?.(),
      getManager,
    })
  }
  operations={{
    executeSend: async (mintUrl, amount) => {
      await manager.wallet.send(mintUrl, amount);
      const entry = await findLatestSendEntry(mintUrl);
      return { historyEntry: JSON.stringify(entry) };
    },
    executeMintQuote: async (mintUrl, amount, unit) => {
      const quote = await manager.quotes.createMintQuote(mintUrl, amount);
      const entry = await findMintEntryByQuoteId(quote.quote);
      return { historyEntry: JSON.stringify(entry) };
    },
    buildMintListItems: async (stepData) => {
      const [mints, balances] = await Promise.all([
        manager.mint.getAllTrustedMints(),
        manager.wallet.getBalances(),
      ]);
      return buildMintListItems(mints, balances, stepData);
    },
  }}
  notifications={{
    NO_AMOUNT: () => noAmountPopup(),
    NO_VALID_MINT: () => noValidMintPopup(),
    INSUFFICIENT_BALANCE: () => balanceTooLowPopup(),
    UNSUPPORTED_INPUT: () => unsupportedInputPopup(),
    ALL_OPTIONS_DISABLED: () => allOptionsDisabledPopup(),
    SEND_FAILED: ({ message }) => generalErrorPopup(message),
    onScanEmpty: (source) => {
      source === 'clipboard' ? noClipboardAddressPopup() : noQrCodeFoundPopup();
    },
    onScanError: (source, err) => generalErrorPopup(err.message),
  }}
  actions={screenActionHandlers}
  savePreferredMint={(mintUrl) => mintStore.setSelectedMint(pubkey, mintUrl)}
  saveNpcMint={async (mintUrl) => npcMintStore.updateServerMint(mintUrl, privateKey)}
  onNpcMintSync={async () => npcMintStore.syncFromServer(manager)}
  scanSources={{
    clipboard: async () => {
      const text = (await Clipboard.getStringAsync()).trim();
      if (!text) return { empty: true };
      return { data: isEncoded(text) ? decode(text) : text };
    },
    gallery: async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
      if (result.canceled) return { canceled: true };
      const codes = await scanFromURLAsync(result.assets[0].uri, ['qr']);
      if (codes.length === 0) return { empty: true };
      return { data: codes[0].data };
    },
  }}
  screenActionsBridge={{
    getExtraContext: () => ({ manager: getManager(), sendDirectMessage }),
    onEntryUpdate: (screenType, callback) => {
      const unsub = manager.on('history:updated', ({ entry }) => callback(entry));
      return () => unsub();
    },
    getSourceLabel: (entry) => scanHistoryStore.find(entry.id)?.source,
  }}
  getOffline={() => netInfo.isOffline}
  getBtcPrice={() => priceStore.getBtcPrice(displayCurrency)}
  getDisplayCurrency={() => ({ code: 'usd', symbol: '$' })}
  createURDecoder={() => new URDecoder()}
  deepLinks={{ url: linkingUrl, customSchemes: ['cashu'] }}>
  <App />
</CocoPaymentUXProvider>
```

## Wallet Context

Built per-profile, passed per-screen. The provider doesn't own wallet state.

```tsx
const walletContext: WalletContext = {
  trustedMintUrls: ['https://mint.example.com'],
  mintBalances: { 'https://mint.example.com': 4200 },
  proofAmounts: { 'https://mint.example.com': [1, 2, 4, 8, 16, 64, 128, 256, 512] },
  preferredMintUrl: 'https://mint.example.com',
};

// Every flow screen binds wallet context to the machine
const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });
```

Screens can override the preferred mint when a flow requires a specific one:

```tsx
const walletContext = useWalletContextWithOverride(selectedMintUrl);
const machine = usePaymentFlowMachine({ walletContext, unit });
```

## Handlers, Operations, Notifications

| Role              | What it does                            | What it doesn't do                     |
| ----------------- | --------------------------------------- | -------------------------------------- |
| **Handlers**      | Navigate given prepared step data       | Check balance, validate, derive rules  |
| **Operations**    | Run async wallet I/O, return facts      | Navigate, show UI                      |
| **Notifications** | Show optional feedback (toasts, popups) | Control flow — missing keys are no-ops |

The machine decides which handler to call. Handlers never check "should I show amount entry?" — the machine already resolved that.

```ts
// Handler — receives fully-resolved step data, just navigates
sendComplete: ({ historyEntry }) => {
  router.navigate({ pathname: '/sendToken', params: { sendHistoryEntry: historyEntry } });
},

// Operation — async wallet work, returns facts for the next transition
executeSend: async (mintUrl, amount) => {
  await manager.wallet.send(mintUrl, amount);
  return { historyEntry: JSON.stringify(await findLatestSendEntry(mintUrl)) };
},

// Notification — optional popup, ignored if not registered
INSUFFICIENT_BALANCE: () => balanceTooLowPopup(),
```
