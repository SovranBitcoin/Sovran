# Receiving

Receiving is driven through the payment machine, not an imperative
`mintQuote()`/`redeem()` call. Entry points push the user into the flow; the
machine renders rail-specific routes (mint quote, Lightning receive), and the
terminal redeem of an ecash token is exposed through `useScreenActions`.

## Start a receive

```tsx
// app/features/wallet/screens/WalletScreen.tsx
const machine = usePaymentFlowMachine({ walletContext, unit: ACCOUNT.unit });

const handleReceive = useCallback(() => {
  void machine.startReceive({ reset: true }); // opens mint-quote / Lightning receive
}, [machine]);
```

## Redeem a token

The terminal redeem is a bound screen action — `actions.redeem.execute()` does the
redemption; `actions.redeem.available` / `.loading` gate the button.

```tsx
// app/features/receive/screens/ReceiveTokenScreen.tsx
import { isReceiveTokenPending, isReceiveTokenRedeemed } from 'wallet';
import { useScreenActions } from 'wallet/react';

const { entry, error, actions } = useScreenActions('receiveToken', receiveHistoryEntry);
// actions.redeem.execute() redeems; isReceiveTokenRedeemed(entry) / isReceiveTokenPending(entry) read state
```

Route wrappers (`app/app/(receive-flow)/mintQuote.tsx`,
`lightningReceive.tsx`) bind `unit` to `usePaymentFlowMachine` and thread
`machine.requestMintSelector()` into the mint pill. See
[Lightning](/payments/lightning) for the BOLT-11 mint-quote path.
