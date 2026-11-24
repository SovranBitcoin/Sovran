// ---------------------------------------------------------------------------
// Hex shape checks
//
// Hex decoders (noble's `hexToBytes`, which cashu-ts and nostr-tools use)
// throw on odd-length or non-hex input: "hex string expected, got unpadded
// hex of length 5". Check a value with these before it reaches one.
// The app's `@/shared/lib/protocolIds` keeps its own copy of `isFixedHex`
// because this package never imports the app.
// ---------------------------------------------------------------------------

const HEX_RE = /^[0-9a-fA-F]+$/;

/** True iff `value` is exactly `byteLength` bytes of hex, either case. */
export function isFixedHex(value: unknown, byteLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length === byteLength * 2 &&
    HEX_RE.test(value)
  );
}

/** True iff `value` is non-empty, even-length hex: what a hex decoder accepts. */
export function isEvenHex(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length % 2 === 0 &&
    HEX_RE.test(value)
  );
}
