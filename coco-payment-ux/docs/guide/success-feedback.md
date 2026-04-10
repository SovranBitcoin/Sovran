# Success Feedback

Patterns for communicating payment outcomes — success states, animations, and terminal screen behavior.

## Terminal screens

After a payment operation completes (send, receive, melt, mint), the user lands on a terminal screen. These screens have unique navigation behavior because the underlying operation has already executed.

### Prevent back-navigation

Once a token is created or a Lightning payment is sent, going "back" is meaningless — the operation cannot be undone. Terminal screens should trap the back gesture.

```tsx
import { View, Text, Pressable } from 'react-native';

function SendTokenScreen({ entry, actions, onNavigateHome }) {
  // Back gesture is handled by the navigation system —
  // the handler should prevent it and offer an explicit exit instead.

  return (
    <View>
      {/* Token display */}
      <Pressable onPress={onNavigateHome}>
        <Text>Back to home</Text>
      </Pressable>
    </View>
  );
}
```

::: info Back-navigation on terminal screens

- Prevent the system back gesture / swipe — the user should not accidentally leave a screen showing an unclaimed token
- Provide an explicit "Back to home" or "Done" button as the only exit
- eNuts uses `preventBack` on token and success screens — the wallet registers a `beforeRemove` listener that blocks all back events
- The explicit exit navigates to the dashboard/home, not one step back in the stack
  :::

## Success states

When a payment completes (token claimed, invoice paid, melt confirmed), transition the screen to a success state.

### In-place transition

For screens that reactively update (e.g., Mint Quote), the success state replaces the existing content without navigation:

```tsx
import { View, Text, ActivityIndicator } from 'react-native';

function MintQuoteScreen({ entry, actions }) {
  const isPaid = entry?.state === 'PAID' || entry?.state === 'ISSUED';

  if (isPaid) {
    return (
      <View>
        <Text>Payment received</Text>
        <Text>{entry.amount} sats</Text>
        {/* Success visual */}
      </View>
    );
  }

  return (
    <View>
      {/* QR code and waiting state */}
      <ActivityIndicator />
      <Text>Waiting for payment...</Text>
    </View>
  );
}
```

::: info In-place success transitions

- Replace the QR code and spinner with a success visual (checkmark icon, amount confirmed)
- Hide action buttons (copy, share) that are no longer relevant
- Keep the amount and mint info visible so the user can confirm what was received
- The transition should feel immediate — the state change drives the render, no manual navigation needed
  :::

### Dedicated success screen

For flows that end with a navigation event (e.g., `handler.sendComplete()`), a separate success screen is appropriate:

::: info Dedicated success screens

- Show the amount prominently (large, bold, centered)
- Display a success animation — a checkmark animation or similar provides satisfying visual confirmation
- Show payment details: amount paid, fee (if any), total including fee, change returned
- For melt (Lightning send) success, break down: amount sent, network fee, total deducted, change (if overpaid proofs)
- Provide haptic feedback on load — a single medium vibration signals completion
- The only action is "Back to home" — keep the screen simple and focused
- Prevent back-navigation to the payment flow — the transaction is complete
  :::

## Fee breakdown on success

When a payment involves fees (Lightning melt, multi-mint swap), show the breakdown:

```tsx
import { View, Text, Pressable } from 'react-native';

function PaymentSuccessScreen({ amount, fee, change, onDone }) {
  return (
    <View>
      <Text>Payment sent</Text>

      <View>
        <View>
          <Text>Amount</Text>
          <Text>{amount} sats</Text>
        </View>
        <View>
          <Text>Fee</Text>
          <Text>{fee} sats</Text>
        </View>
        <View>
          <Text>Total</Text>
          <Text>{amount + fee} sats</Text>
        </View>
        {change > 0 && (
          <View>
            <Text>Change</Text>
            <Text>{change} sats</Text>
          </View>
        )}
      </View>

      <Pressable onPress={onDone}>
        <Text>Back to home</Text>
      </Pressable>
    </View>
  );
}
```

::: info Fee breakdown display

- Show each row as a label-value pair, aligned in two columns
- Amount is what the recipient gets, fee is what the network charged, total is what left the wallet
- Change appears when the wallet had to overpay due to proof denominations (NUT-08) — show it so the user understands why the deduction was slightly more than expected
- For swaps (multi-mint), label the rows as "Swapped", "Fee", "Total" instead of "Amount", "Fee", "Total"
  :::

## Pending token tracking

When the user sends an ecash token, the token may not be claimed immediately. Reference wallets show pending tokens in the transaction history:

::: info Pending token tracking

- Show created-but-unclaimed tokens in the payment history with a "Pending" status indicator
- Use a distinct visual state (clock icon, amber color) to differentiate pending from completed transactions
- Allow the user to tap a pending token to re-display the QR code / token string — this supports re-sharing if the recipient lost it
- Provide a "Check if spent" action on pending tokens — queries the mint to verify the token's state
- When a token is confirmed as spent, update the history entry to "Completed" with a success indicator
- If a token has been pending for a long time, consider surfacing a "Reclaim" action that swaps the token back into the wallet
  :::

## Confirmation before execution

For irreversible operations (Lightning payments, token creation), confirm before executing:

::: info Payment confirmation patterns

- Show a payment overview screen before executing: amount, recipient/destination, fee estimate, mint, balance after transaction
- eNuts uses a swipe-to-confirm button for payments — this prevents accidental taps and adds intentionality to the action
- For two-phase flows (melt quote → pay), the first phase (Get Quote) reveals the fee, and the second phase (Pay) commits — this progressive disclosure lets the user back out after seeing the real cost
- Cancel should be visually distinct from the confirm action (outlined/secondary styling, not the same prominence)
  :::
