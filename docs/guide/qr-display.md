# QR Code Display

Patterns for rendering QR codes across payment flows — tokens, invoices, addresses, and payment requests.

## Where QR codes appear

| Screen                                                   | Data encoded                          | Source                     |
| -------------------------------------------------------- | ------------------------------------- | -------------------------- |
| [Send Cashu](/flows/cashu-send#send-cashu-screen)        | Encoded ecash token                   | `entry.tokenString`        |
| [Mint Quote](/flows/lightning-receive#mint-quote-screen) | Lightning invoice (BOLT11)            | `entry.paymentRequest`     |
| [Quick Receive](/flows/quick-receive) — NPC tab          | NPC Lightning address                 | `entry.npcAddress`         |
| [Quick Receive](/flows/quick-receive) — P2PK tab         | P2PK public key                       | `entry.p2pkPubkey`         |
| [Melt Quote](/flows/lightning-send#melt-quote-screen)    | Lightning target (payer reference)    | `entry.paymentRequest`     |
| [Payment Request](/flows/cashu-send#payment-requests)    | Cashu payment request (NUT-18)        | `entry.paymentRequestInfo` |

## Static QR

Most data fits in a single QR code. The component structure is straightforward:

```tsx
import { View, Text, Pressable } from 'react-native';

function QRDisplay({ value, onCopy, copied }) {
  return (
    <Pressable onPress={() => onCopy(value)}>
      <View>{/* QR code image — library renders from value */}</View>
      <View>
        <Text>{copied ? 'Copied' : value.slice(0, 20) + '...'}</Text>
      </View>
    </Pressable>
  );
}
```

::: info Static QR layout

- Wrap the QR code and truncated string in a single `Pressable` — tapping anywhere copies the full value
- Show a white border around the QR code to ensure scannability on dark backgrounds
- Below the QR code, show a truncated preview of the encoded string with a copy icon
- When copied, replace the preview text with a "Copied" confirmation and swap the icon to a checkmark
- Use [`FormattedString`](/methods/formatting#formattedstring) truncation (mode `'middle'`) for the preview — this preserves the prefix and suffix so the user can visually verify the data
  :::

## Animated QR (NUT-16)

Ecash tokens can exceed QR capacity. NUT-16 splits the data into UR-encoded frames that cycle automatically, forming an animated QR code the scanner reassembles.

The machine's `createURDecoder` config provides the decoder factory. On the display side, the library handles frame cycling via the value it exposes.

```tsx
import { View, Text, Pressable } from 'react-native';

function AnimatedQRDisplay({ frames, currentFrame, totalFrames, value, onCopy, copied }) {
  return (
    <View>
      <Pressable onPress={() => onCopy(value)}>
        <View>{/* QR code image — value changes each frame */}</View>
        <View>
          <Text>{copied ? 'Copied' : value.slice(0, 20) + '...'}</Text>
        </View>
      </Pressable>
      <Text>
        {currentFrame} / {totalFrames}
      </Text>
    </View>
  );
}
```

::: info Animated QR

- Detect when the token string exceeds QR capacity and fall back to animated QR automatically
- Show a frame counter (`3 / 12`) so the scanner operator knows progress
- Cycle frames at a steady pace (200-300ms per frame works well for camera capture)
- Keep the tap-to-copy behavior — the full, unencoded token string is copied, not the current UR frame
- If the QR library throws an error on large data, show a "Token too large for QR" message and surface Copy and Share as primary actions instead
  :::

## Fallback: copy-only

When a QR code cannot render (token too large even for animated QR, or QR library error), degrade gracefully.

```tsx
import { View, Text, Pressable, ScrollView } from 'react-native';

function CopyOnlyDisplay({ value, onCopy, onShare, copied }) {
  return (
    <View>
      <Text>Token too large for QR code</Text>
      <ScrollView>
        <Text selectable>{value}</Text>
      </ScrollView>
      <Pressable onPress={() => onCopy(value)}>
        <Text>{copied ? 'Copied' : 'Copy'}</Text>
      </Pressable>
      <Pressable onPress={() => onShare(value)}>
        <Text>Share</Text>
      </Pressable>
    </View>
  );
}
```

::: info Copy-only fallback

- Show Copy as the primary action button, Share as secondary (outlined)
- Make the full token string selectable so the user can manually highlight and copy
- Display the string in a scrollable container — large tokens can be thousands of characters
- Show a clear message explaining why the QR code is not available
  :::

## Per-screen tips

### Ecash tokens

Ecash tokens are bearer assets — the QR code _is_ the money. Display accordingly:

::: info Token QR display

- Show the sat amount prominently above the QR code, large and bold
- Show the fiat equivalent below the sat amount when a display currency is configured
- The QR code is the centerpiece of the screen — give it maximum width
- Below the QR, show Copy (primary) and Share (outlined) buttons
- Prevent back-navigation on the token screen — a back gesture could make the user think the token was canceled when it was already created
- Consider a "Check if spent" action that verifies token state — when the token has been claimed, show a success state with the amount and hide the QR
  :::

### Lightning invoices

Invoices are time-sensitive and paid by a third party scanning the code:

::: info Invoice QR display

- Show a "Waiting for payment..." indicator with a spinner below the QR code
- Display the amount and mint name above the QR code
- When the invoice state transitions to `PAID`, replace the QR and spinner with a success state (checkmark, amount received)
- Keep Copy and Share available while the invoice is `UNPAID` — the payer may need the string in a different app
- If the invoice has an expiry, show a countdown timer — warn when under 60 seconds remaining
  :::

### Receive addresses (NPC / P2PK)

These are long-lived identifiers, not one-time payment data:

::: info Receive address QR display

- Show the address type label above the QR (e.g., "Lightning Address" or "Cashu Public Key")
- Display the full address below the QR, truncated with `beforeAt` mode for Lightning addresses (shows `...@npub.cash`) or `middle` mode for public keys
- Copy is the primary action — the user is sharing this address with a sender
- When both NPC and P2PK are available, use tabs or a segmented control to switch between them, each with its own QR code
  :::

### Payment requests (NUT-18)

Payment requests carry structured data (amount, description, preferred mint, transport):

::: info Payment request QR display

- Show the amount and description prominently above the QR code
- Display the preferred mint name below the amount
- Include a "single use" indicator when the request is one-time
- Copy and Share allow the receiver to distribute the request to payers
  :::
