Where does a secret travel through route params, a deep link rewrite, navigation history or a URL?

Secrets here: nostrconnect and bunker pairing links and their embedded secrets, mnemonics, nsec
and private keys, Cashu tokens and proofs, auth tokens. Find +native-intent and other deep-link
handlers, router.push, replace and setParams calls, and useLocalSearchParams readers that carry
such a value. Route params persist in navigation state and history. The correct shape holds the
value in memory and routes with a one-use ticket (app/features/nostrSigner/lib/pendingPairingUri.ts,
app/app/(signer-flow)/connect.tsx). A public identifier such as an npub, a mint URL or an invoice
in a param is not a concern.
