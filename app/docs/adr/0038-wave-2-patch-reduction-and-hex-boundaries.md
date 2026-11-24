# Four package patches stay, and every hex decoder is guarded

Accepted on 2026-11-24.

The app carries seven package patches. Three change only presentation and have a way to
work without them:

- `expo-router`: drawer overlay styling in Router's navigation fork.
- `react-native-screens`: Android form-sheet dimming.
- `@gorhom/bottom-sheet`: sheet and backdrop default to `accessible={false}` so their
  descendants stay reachable. Sovran's sheet wrappers pass `accessible={false}` explicitly
  instead.

These three are removed. Four stay, because the app cannot ship without them:

- `@cashu/coco-core`: offline exact-match send ([ADR 0019](0019-an-exact-send-needs-no-mint.md),
  the one Coco patch [ADR 0017](0017-the-wallet-core-ships-unmodified.md) allows).
- `@cashu/cashu-ts`: the NUT-18 `mp` and NUT-26 tag `0x09` backport.
- `expo-modules-jsi`: builds with the Xcode 26.1 Swift toolchain.
- `heroui-native`: sheet `mountIndex`, nested scroll and toast clone fixes.

Each keeps its purpose, test and removal trigger in [app/patches](../../patches/README.md).

Hex decoders (noble's `hexToBytes`, which cashu-ts and nostr-tools call) throw on odd-length
input: "hex string expected, got unpadded hex of length 5". A saved profile key, a search
result, a stored proof or a radio payload holding `"error"` or `"12345"` reached one
unguarded and crashed the screen or effect that held it. Every such value is now checked
first, and a bad one gets a clean refusal:

- `isFixedHex(value, byteLength)` in `@/shared/lib/protocolIds` for fixed-width keys. The
  existing 32-byte predicates delegate to it. `wallet` exports the same predicate and
  `isEvenHex`, because it never imports the app.
- Exporting a structured token (copy, NFC, emoji, contact DM, screen display) goes through
  `encodeTokenChecked` in `wallet`. It returns a typed failure naming the first proof field
  that is not even-length hex (`id`, `C`, `p2pk_e`, DLEQ `e`/`s`/`r`) before cashu-ts sees
  it, so no clipboard, NFC or radio adapter runs and no proof or operation changes. The
  check asks only for what the decoder needs, so a token that encodes today still encodes.
- Edit profile shows an unavailable state for a saved pubkey that is not 32-byte hex,
  without touching the saved row. A memo mention with such a key is not inserted.
- Nearby payments refuse payload proofs with malformed hex at the schema, before the inbox
  is written. A local Noise secret key that is not 32-byte hex raises `NearbyIdentityError`,
  and discovery declines instead of throwing into the native bridge.
- Offline DLEQ verification treats a saved mint amount key that is not even-length hex as
  missing.

Keyset keys as fetched from a mint stay with Coco and cashu-ts, which ship unmodified; this
decision guards only the places Sovran's own code reads them.
