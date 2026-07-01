# Sending

Sending uses the same machine-driven model as receiving. The machine handles
destination choosing, bearer-ecash creation, and parsing/routing of any pasted
destination (which is the Lightning **melt** path for a BOLT-11 invoice or
Lightning address).

```tsx
// app/features/send/screens/SendScreen.tsx

// Parse + route any pasted destination. bolt11 / lnaddr → melt; token / npub → routed.
const handleSubmitDestination = useCallback(() => {
  void machine.execute(trimmed);
}, [machine, trimmed]);

// Create a bearer ecash token with no recipient.
const handleCreateEcash = useCallback(() => {
  void machine.startSendEcash({});
}, [machine]);

// Contact send: bearer token DM'd to an npub; an optional lud16 seeds the Lightning option.
void machine.startSendEcash({ recipientPubkey, recipientProfile, meltTarget: lud16 });
```

The clearest Lightning melt call is a tapped invoice in the feed:

```tsx
// app/features/feed/components/nostr/NoteContent.tsx
void machine.execute(meltTarget, { reset: true }); // bolt11 → melt quote
```

The terminal send-token screen uses `useScreenActions('sendToken', entry)` for
copy / share / NFC. Send-flow route wrappers
(`app/app/(send-flow)/meltQuote.tsx`, `lightningSend.tsx`) bind the machine for
mid-flow mint swaps.

Key machine methods: `startSend`, `startSendEcash`, `execute`, `scan`,
`requestMintSelector`, `enterAmount`, `reset`, `subscribe`, `getContext`,
`getStep`.
