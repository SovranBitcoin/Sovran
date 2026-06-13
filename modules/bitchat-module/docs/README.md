# Nut Drop — bitchat protocol & the native changes it needs

A wire protocol for handing a Cashu token to a specific nearby peer over the
bitchat BLE mesh, fully offline. It rides bitchat's existing favorite notification
and private Noise DM; the **only** new wire surface is a backward-compatible
widening of the private-message content-length field. No new packet type, no new
Noise payload type, no reserved bytes.

The protocol is three native changes:

1. **Extended private-message content length** — a patch to vendored bitchat
   (`PrivateMessagePacket`), so one DM can carry a whole token.
2. **Favorite carries identity + a payment request** — `[FAVORITED]:<npub>:<creq>`,
   emitted/parsed in the platform bridge.
3. **Single-initiator handshake tie-breaker** — bridge behavior, so eager mutual
   favoriting doesn't collide.

Tokens flow Sovran↔Sovran (stock bitchat can't decode an extended message).

**Prerequisite:** you must already be a working bitchat peer — you announce, run
Noise sessions, and fragment/reassemble packets. This protocol adds to that; it
does not replace it.

**The one safety rule (read before §1):** an extended (>254-byte) message is
**only** understood by a patched client. Never send one to a peer you haven't
confirmed is patched. The confirmation signal is a **valid creq favorite** (§2):
a peer that advertised a creq is running this protocol, so it can decode the
extended token DM. A stock peer that receives an extended message simply fails to
decode and drops it — harmless for the eager favorite (it's just ignored), but a
**token** sent to a stock peer would be lost. So: token DMs go only to
creq-advertised peers.

---

## 1. Extended private-message content length

bitchat serializes a private message as TLV fields; the `content` field uses a
**one-byte length**, capping content at 255 bytes — too small for an ecash token
or a creq-bearing favorite. The cap is a serialization limit, not a transport one
(the BLE layer already fragments oversized encrypted packets), so we widen it.

**Encoding (unchanged for small content):**

| `content` length | On the wire |
|---|---|
| `0x00`–`0xFE` (0–254) | one length byte, then the bytes — **byte-identical to stock** |
| `≥ 0xFF` (255–65535) | the sentinel byte `0xFF`, then a 2-byte big-endian length, then the bytes |

`messageID` keeps its one-byte length. A message ≤254 B is exactly stock on the
wire; only a patched client decodes a larger one.

**Why a sentinel and not a version bump.** bitchat's own pattern for outgrowing a
length field is to bump the protocol version and branch on it (its outer packet
does exactly this: `v1` uses a 2-byte `UInt16` payload length, `v2` a 4-byte
`UInt32`). We deliberately don't: a version bump is a protocol-wide breaking
change needing iOS+Android lockstep (the blocker on #784), whereas the `0xFF`
sentinel keeps every ≤254-byte message byte-identical to stock, so stock peers
keep interoperating on all normal traffic. The 2-byte big-endian width itself
*is* bitchat house style (its lengths are all network byte order); the sentinel is
our backward-compat choice. It's a private extension — if upstream ever
standardizes a wider length, repoint only this oversized path; normal messages are
unaffected.

### Swift — `Protocols/Packets.swift` (`PrivateMessagePacket`)

Encode (guard widened to 64 KB; branch on `0xFE`):

```swift
guard let contentData = content.data(using: .utf8), contentData.count <= 0xFFFF else { return nil }
data.append(TLVType.content.rawValue)
if contentData.count <= 0xFE {
    data.append(UInt8(contentData.count))
} else {
    data.append(0xFF)
    data.append(UInt8((contentData.count >> 8) & 0xFF))
    data.append(UInt8(contentData.count & 0xFF))
}
```

Decode (read the sentinel before reading the value):

```swift
var length = Int(data[offset])
offset += 1
if length == 0xFF {
    guard offset + 2 <= data.count else { return nil }
    length = (Int(data[offset]) << 8) | Int(data[offset + 1])
    offset += 2
}
guard offset + length <= data.count else { return nil }
let value = data[offset..<offset + length]
offset += length
```

### Kotlin — `model/NoiseEncrypted.kt` (`PrivateMessagePacket`)

Encode guard + length:

```kotlin
if (messageIDData.size > 255 || contentData.size > 0xFFFF) {
    return null
}
// …
result.add(TLVType.CONTENT.value.toByte())
if (contentData.size <= 0xFE) {
    result.add(contentData.size.toByte())
} else {
    result.add(0xFF.toByte())
    result.add(((contentData.size shr 8) and 0xFF).toByte())
    result.add((contentData.size and 0xFF).toByte())
}
```

Decode:

```kotlin
var length = data[offset].toUByte().toInt()
offset += 1
if (length == 0xFF) {
    if (offset + 2 > data.size) return null
    length = (data[offset].toUByte().toInt() shl 8) or data[offset + 1].toUByte().toInt()
    offset += 2
}
```

Both patches are applied by the vendor sync scripts
(`scripts/patch-bitchat-imports.js`, `scripts/sync-bitchat-android.js`), which
fail loudly if the upstream anchor shape changes.

---

## 2. The favorite message: identity + payment request

bitchat shares a Nostr identity in exactly one place: the **favorite
notification** — a Noise-encrypted private message `[FAVORITED]:<npub>` that the
receiver records as `peer → npub` (`[UNFAVORITED]:<npub>` revokes). We append a
NUT-18 payment request, separated by `:`

```
[FAVORITED]:<npub>:<creq>
```

- **`npub`** — the sender's Nostr key (bech32). One value, used as identity, kind-0
  profile key, and (`02`-prefixed) the P2PK lock target.
- **`creq`** — a NUT-18 payment request (`creqA…`, URL-safe base64, contains no
  `:`), encoding what the sender will accept. It is a *standing* request, so a
  payer can reuse it for any amount:

  | NUT-18 field | Value |
  |---|---|
  | transports | none (delivery is the BLE DM, not Nostr/HTTP) |
  | amount | unset (any amount) |
  | unit | `sat` |
  | single-use | `false` |
  | mints | the sender's accepted mint URLs (cap the count — the favorite must stay ≤64 KB) |
  | `nut10` lock | `{ kind: "P2PK", data: "02"+<32-byte x-only npub hex>, tags: [] }` |

  The `nut10` lock is what ties the request to the identity: a payer accepts the
  creq only if its lock key equals `02`+npub, then mints from a mint in the list
  and P2PK-locks (NUT-11, single-sig) to that key.

At ~290 B the creq favorite exceeds 255 B, so it depends on §1.

**Bridge — emit:** build the native favorite string and append `:` + creq when one
is set (omit the suffix when there's no creq), then send it as a normal private
message.

**Bridge — parse:** split inbound favorite content on `:` → `[1]` = npub
(bech32-decode to the x-only hex key), `[2…]` = creq. Treat the peer as
**lockable** only if the creq decodes and its `nut10` key equals `02`+npub;
otherwise it's bearer-only.

**Discovery is eager:** favorite every peer on sight so a counterpart reciprocates
and both learn each other's key + mints. (bitchat puts no Nostr key in its
announce, so favoriting is the only way to learn one.)

---

## 3. Single-initiator handshake tie-breaker

Eager *mutual* favoriting makes both peers begin a Noise **XX** handshake at the
same instant. XX requires exactly one initiator and one responder, so two
simultaneous initiators collide and no session establishes. Resolve it in the
bridge: of the two 16-hex peerIDs, the one that is **lexicographically lower
initiates**; the higher one defers and sends its favorite once the single session
is live. Both sides compute the same winner from the same two IDs, so exactly one
initiates. (Behavior only — no change to vendored Noise.)

---

## 4. Token delivery & classification

The DM `content` is the **standard encoded Cashu token string** (NUT-00,
`cashuB…`/`cashuA…`) and nothing else — no wrapper, no header. It is the `content`
of **one** private Noise DM to the peer (§1 makes it fit). The DM is encrypted to
the recipient, so a locked or bearer token stays private — there is no public
broadcast.

**Choosing the source mint (sender).** Mint from a mint in the **intersection** of
your mints and the recipient's creq mints, then P2PK-lock to its key. If the
intersection is empty, don't send — a token from a mint the recipient doesn't
accept is unredeemable. (If you can't lock — e.g. offline, no mint swap — send a
bearer token from a shared mint instead.)

**Classification (receiver).** Inspect the token's proofs against your own key:

- **locked to me** — every proof is single-sig P2PK to my key → redeem.
- **bearer** — no proof carries a P2PK lock → redeem; the DM is addressed to me,
  so it's mine.
- **anything else** — any proof locked to a different key, multisig, or a mix →
  ignore.

Redeem is best-effort and unacknowledged, so make it **idempotent**: dedupe by
token so a resend isn't redeemed twice. **Never auto-trust a mint** a token pushes
at you — if its mint is untrusted, park the token rather than silently adding the
mint.

That's the entire wire contract: a creq favorite to exchange identity + mints, and
an extended-length DM to carry the token.

---

## Upstream context & future work

bitchat's maintainer **Jack** ([@jackjackbits](https://github.com/jackjackbits))
keeps the protocol intentionally small and routes cashu-adjacent work to Calle
(the Cashu author, a repo collaborator) off-GitHub — so we touch the wire as
little as possible. The only cashu code **merged** upstream is read-only **chip
rendering** ([#891](https://github.com/permissionlesstech/bitchat/pull/891) /
[#961](https://github.com/permissionlesstech/bitchat/pull/961)): detect a `cashu…`
/ `lnbc…` string and show a tappable chip. There is no merged wallet, lock,
redeem, or payment protocol, so nothing here conflicts with shipped behavior.

Threads to watch — each could let us drop or change a native patch:

- **[#784](https://github.com/permissionlesstech/bitchat/issues/784)** — *Allow
  private message content to exceed 255 bytes* (open). A protocol-wide length lift
  would make §1 unnecessary. Jack says it needs iOS+Android lockstep; we don't
  depend on it landing.
- **bitchat-android [#506](https://github.com/permissionlesstech/bitchat-android/pull/506)**
  — *Feat/dm 2byte tlv* — a 2-byte-TLV cashu DM, the same idea as §1 reached
  independently; the closest existing precedent.
- **[#1053](https://github.com/permissionlesstech/bitchat/pull/1053)** — *add
  Lightning and Cashu payment packets to the Noise layer* (open PR). A heavier
  native path (new `NoisePayloadType`s + packet model); an alternative to the
  extended-length DM if it merges, though its `0x20` collides with Android's
  `FILE_TRANSFER`.
- **[#1327](https://github.com/permissionlesstech/bitchat/pull/1327)** — *Fix
  Cashu long-message guard bypass* (open, maintainer's) — signals Jack's
  preference for structured payloads over raw-text cashu blobs.
- **[#1073](https://github.com/permissionlesstech/bitchat/issues/1073)** (SDK
  packages) and **[#124](https://github.com/permissionlesstech/bitchat/issues/124)**
  (whitepaper interop) — demand for an official extension/interop story; none
  exists yet, which is why this stays on native mechanisms.
- Prior cashu-over-mesh attempts for reference:
  **[#416](https://github.com/permissionlesstech/bitchat/issues/416)** /
  **[#417](https://github.com/permissionlesstech/bitchat/issues/417)** (cashu for
  hops / per-message read),
  bitchat-android **[#132](https://github.com/permissionlesstech/bitchat-android/pull/132)**
  (*Parse cashu*, closed), and
  **[#679](https://github.com/permissionlesstech/bitchat/issues/679)** (deep-link
  cashu redeem).
