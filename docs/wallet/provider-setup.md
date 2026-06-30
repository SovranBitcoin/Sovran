# Provider setup

The app mounts a single `SovranColadaProvider` — a thin wrapper over
`ColadaProvider` from `wallet/react` — in the root provider stack. The wallet
instance is built with `createColada({ manager })` from `wallet`, where `manager`
is the Coco `Manager` that **owns the seed**. The wallet package never takes a
seed or mnemonic directly; it operates through the manager and a set of injected
platform adapters.

```tsx
// app/features/send/providers/Colada.tsx
import { createColada } from 'wallet';
import { ColadaProvider, type ColadaProviderProps } from 'wallet/react';
import { useManager } from '@cashu/coco-react';

export function SovranColadaProvider({ children }: { children: React.ReactNode }) {
  const manager = useManager(); // Coco holds the seed
  const instance = useMemo(
    () => createColada({ manager /* getOffline, getBtcPrice, fetchMintCatalog, logger, … */ }),
    [manager]
  );
  useEffect(() => () => instance.dispose(), [instance]);

  return (
    <ColadaProvider
      instance={instance}
      getManager={() => manager}
      handlers={handlers}
      operations={operationsOverride}
      clipboardAdapter={clipboardAdapter}
      shareAdapter={shareAdapter}
      nfcAdapter={nfcAdapter}
      chainAdapter={chainAdapter}
      navigation={navigation}
      deepLinks={deepLinks}
    >
      {children}
    </ColadaProvider>
  );
}
```

It is mounted after `CocoProvider` and the app's `WalletContextProvider` in
`app/app/_layout.tsx`. Screens then consume two hooks:

- `usePaymentFlowMachine({ walletContext, unit })` — the send/receive flow state
  machine (see [Sending](/wallet/sending) and [Receiving](/wallet/receiving)).
- `useScreenActions(kind, entry)` — post-terminal screen actions (redeem, copy,
  share, back).

`walletContext` (trusted mints + balances) comes from the app's own
`WalletContextProvider`, not from the wallet package — the package stays
UI- and storage-agnostic and receives everything platform-specific through
adapters and props.
