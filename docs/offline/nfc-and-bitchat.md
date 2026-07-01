# NFC and BitChat

Sovran supports two fully offline payment paths: **NFC tag handoffs** and the
**BitChat BLE mesh**. Both work with no network once spendable proofs are selected.

## NFC

NFC reads go through the same unified parser as paste / scan / deeplink, so a tap
drops you into the right flow (send, receive, mint add, contact open)
automatically.

- **Tap to read** — read a payment request, Cashu token, or other supported
  payload from an NFC Type 4 / IsoDep tag or terminal-like source.
- **Tap to write a token to a tag** — write an ecash token to a blank tag.
- **Tap to read a tag back** — receive a token by tapping a previously written tag.

Reliability:

- **Chunked writes** — oversized tokens span multiple records with a
  commit-only-on-success protocol, so an interrupted write never bricks a tag.
- **Auto proof reclaim** — if the tap drops mid-send, the proofs are reclaimed
  automatically.
- **User-initiated dismiss is a no-op** — closing the sheet doesn't burn proofs.

Every NFC flow is bidirectional and works online or offline.

## BitChat (BLE mesh)

A native iOS `bitchat-module` bridges a local BLE mesh transport. Android exports
degrade gracefully while the native bridge remains iOS-focused. The BLE peer
identity is scoped to the active Sovran profile.

- **Private DMs over BLE** — peer-to-peer encrypted DMs with no relay, no internet.
- **Group chats over BLE** — multi-peer chats on the mesh.
- **Geohash chat rooms** — public location-bound rooms keyed by geohash precision.
- **Split-bill over BLE** — settle splits across nearby peers with no server in the
  path.
- **Nut Drop (ecash over BLE)** — pay a nearby BitChat peer in Cashu ecash from a
  honeycomb peer picker. The token is broadcast as a single **public** mesh
  message, so any unmodified nearby receiver can reassemble the full token; the
  amount screen warns that anyone nearby can claim it.
- **BLE peer discovery in contacts** — nearby mesh peers appear in the contact list
  with mesh identity.
- **Delivery acks** — delivered / failed state on DMs.

The BitChat vendor is a git submodule under
`app/modules/bitchat-module/{ios,android}/BitChatVendor`; the root `postinstall`
syncs the vendored sources into the native module on install.
