#!/usr/bin/env node
// Bitchat upstream splits its sources into separate Swift Package modules
// (BitLogger, BitFoundation). The BitChatModule pod compiles everything into
// a single Swift module, so those `import BitLogger` / `import BitFoundation`
// statements fail to resolve. Comment them out in place. Idempotent.
//
// --- Upgrading the bitchat submodule ---
//   1) cd modules/bitchat-module/ios/BitChatVendor
//   2) git fetch origin && git checkout <tag-or-sha>
//   3) cd back to repo root, run `bun install` (postinstall re-runs this script)
//   4) `cd ios && pod install`, then build the iOS app
//   5) If a regex below stops matching after an upstream rewrite, fix the
//      anchor (or drop the patch if upstream now does the right thing) and
//      rerun this script. Each block is anchored to a specific upstream line
//      pattern, so a missed match means upstream changed shape.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'ios', 'BitChatVendor');
// BitLogger / BitFoundation: bundled into BitChatModule (no separate Swift module).
// Tor: provided by TorStub.swift (no-op). Arti xcframework is not vendored.
// P256K: real dependency now via `s.dependency 'swift-secp256k1'` in the podspec,
// so upstream `import P256K` lines must stay intact.
// Matches both `import BitFoundation` and Swift submodule form
// `import struct BitFoundation.BitchatPacket` (kind ∈ struct|class|enum|func|protocol|typealias|var|let).
const MODULES = '(?:BitLogger|BitFoundation|Tor)';
const KIND = '(?:struct|class|enum|func|protocol|typealias|var|let)';
const PATTERN = new RegExp(
  `^([ \\t]*(?:(?:private|internal|public|fileprivate)[ \\t]+)?import[ \\t]+(?:${KIND}[ \\t]+)?${MODULES}(?:\\.[A-Za-z_][A-Za-z0-9_]*)?)[ \\t]*$`,
  'gm'
);
const REPLACEMENT = '// $1  // bundled / stubbed in BitChatModule';

// Probe a real file, not the directory: BitChatVendor is a git submodule,
// and a `submodules: false` checkout (CI) leaves the path as an EMPTY dir —
// the dir check passes, walk() finds nothing, and the assertApplied() reads
// at the bottom then crash with ENOENT on the missing vendor files.
if (!fs.existsSync(path.join(ROOT, 'Package.swift'))) {
  console.log(`[patch-bitchat-imports] ${ROOT} not checked out, skipping.`);
  process.exit(0);
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.swift')) out.push(p);
  }
  return out;
}

// Bitchat uses Swift 5.9+ scoped imports like `private import struct CryptoKit.SHA256`
// in BitFoundation. When all sources land in the same module, the same framework
// is also imported plainly elsewhere — Swift then errors with "ambiguous implicit
// access level". Normalize these scoped private imports to plain `import Module`.
const SCOPED_PRIVATE_IMPORT =
  /^([ \t]*)(?:private|fileprivate)[ \t]+import[ \t]+(?:(?:struct|class|enum|func|protocol|typealias|var|let)[ \t]+)?([A-Z][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)?[ \t]*$/gm;
const SCOPED_PRIVATE_REPLACEMENT = '$1import $2';

// Upstream BLEService.swift advertises a different serviceUUID in DEBUG
// (testnet, …4B5A) vs RELEASE (mainnet, …4B5C). Sovran's EAS dev client is
// a Debug build, so without this patch it can't see App Store bitchat users
// (who are on mainnet). Force mainnet UUID in all builds so Sovran interops
// with the public bitchat mesh regardless of build configuration. Idempotent:
// the testnet literal will only be present on first run.
const TESTNET_UUID = 'F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5A';
const MAINNET_UUID = 'F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C';

// --- Relax announce sender-mismatch check to warn-only ---
//
// Upstream hardened this check from "warn" to "hard reject" sometime between
// v1.5.1 (Jan 2026) and the current HEAD. The App Store bitchat is shipping
// v1.5.1-era code, which routinely sends announces whose packet.senderID
// doesn't match PeerID(publicKey: noisePublicKey). v1.5.1 tolerated that;
// our newer strict code rejects every one, so we never receive any peer
// announce from App Store bitchat devices.
//
// As of upstream 3caf2d7 the check lives in BLEAnnouncePreflightPolicy.evaluate
// (bitchat/Services/BLE/BLEAnnounceHandlingPolicy.swift). Restore v1.5.1
// semantics by removing the guard that rejects on mismatch. `derivedPeerID`
// stays live — the accept path below still consumes it. Idempotent: once the
// guard is gone, the anchor won't match.
// TODO(sovran): re-test against a current App Store bitchat build; if its
// announces now pass the derived-peerID check, drop this patch entirely.
const MISMATCH_GUARD_ANCHOR =
  /        guard derivedPeerID == peerID else \{\n            return \.reject\(\.senderMismatch\(derivedPeerID: derivedPeerID\)\)\n        \}\n/;
const MISMATCH_GUARD_REPLACEMENT =
  '        // [sovran] sender-mismatch reject relaxed to v1.5.1 warn-only semantics.\n' +
  '        // App Store bitchat v1.5.1 sends announces whose packet senderID differs\n' +
  '        // from PeerID(publicKey:); without this relax every one is rejected and\n' +
  '        // Sovran never discovers App Store peers.\n';

// --- De-privatize BLEService.linkState(for:) ---
//
// Upstream 3caf2d7 made `linkState(for:)` private (the new BLEAnnounceHandler
// reaches it through an environment closure). Our BitChatBLEBridge.getPeers()
// uses it for the real-time `hasDirectLink` flag (src/types.ts contract), so
// restore internal visibility. Idempotent: once de-privatized, no match.
const LINKSTATE_ANCHOR = /    private func linkState\(for peerID: PeerID\)/;
const LINKSTATE_REPLACEMENT =
  '    // [sovran] de-privatized — BitChatBLEBridge.getPeers() reads real-time link\n' +
  '    // state for the hasDirectLink peer flag.\n' +
  '    func linkState(for peerID: PeerID)';

// --- Append the ecash capability beacon TLV (0xF0) to outgoing announces ---
//
// A 6-byte flags-only beacon (magic "NUTB" + version + capability flags):
// "this peer answers NUT-18 payment-request solicits over Noise". No key
// material on the air — the lock key + trusted mints travel per-send inside
// the payment request. Open extension — any bitchat client may implement it
// (spec draft in modules/bitchat-module/docs/nut18-bitchat-transport.md).
// Vanilla bitchat decoders skip unknown announce TLVs by design (upstream
// Packets.swift "tolerant decoder" + unit test), and the TLV is appended
// BEFORE signPacket so the Ed25519 announce signature covers it — vanilla
// verification still passes. TLV bytes come from EcashAnnounceState
// (EcashAnnounceExtension.swift, Sovran-owned, same compiled module).
// Idempotent: once `guard var payload` is in place, the anchor won't match.
const ECASH_ANNOUNCE_INJECT_ANCHOR =
  /        guard let payload = announcement\.encode\(\) else \{\n            SecureLogger\.error\("❌ Failed to encode announce packet", category: \.session\)\n            return\n        \}\n/;
const ECASH_ANNOUNCE_INJECT_REPLACEMENT =
  '        guard var payload = announcement.encode() else {\n' +
  '            SecureLogger.error("❌ Failed to encode announce packet", category: .session)\n' +
  '            return\n' +
  '        }\n' +
  '        // [sovran] append ecash capability TLV (0xF0). Vanilla decoders skip\n' +
  '        // unknown announce TLVs; appended before signPacket so the announce\n' +
  '        // signature covers it.\n' +
  '        if let ecashTLV = EcashAnnounceState.shared.localTLV {\n' +
  '            payload.append(ecashTLV)\n' +
  '        }\n';

// --- Record the ecash capability TLV from verified incoming announces ---
//
// Parses the raw announce payload out-of-band (same pattern upstream Android
// uses for its gossip TLV) and stores per-peer flags + P2PK pubkey for
// BitChatBLEBridge.getPeers(). Verified announces only — the recording sits
// after the unverified-announce early return inside the registry barrier, at
// the same spot upstream persists identity. A verified announce WITHOUT the
// TLV clears the entry (announce TLVs are authoritative per-announce).
const ECASH_ANNOUNCE_PARSE_ANCHOR =
  /        \/\/ Persist cryptographic identity and signing key for robust offline verification\n        env\.persistIdentity\(announcement\)\n/;
const ECASH_ANNOUNCE_PARSE_REPLACEMENT =
  '        // [sovran] record/clear the ecash capability TLV (0xF0). Verified\n' +
  '        // announces only; absence of the TLV clears the entry.\n' +
  '        if verifiedAnnounce {\n' +
  '            EcashAnnounceState.shared.record(peerID: peerID.id, announcePayload: packet.payload)\n' +
  '        }\n' +
  '\n' +
  '        // Persist cryptographic identity and signing key for robust offline verification\n' +
  '        env.persistIdentity(announcement)\n';

// --- Compression-independent signing form ---
//
// Upstream signs/verifies packets over BinaryProtocol.encode(unsignedPacket),
// which COMPRESSES payloads above 100 bytes — and raw-deflate output is not
// canonical across implementations (Apple libcompression vs java.util.zip
// emit different bytes for identical input). Base announces (~76 B) stay
// under the threshold, but Sovran's ecash TLV (+42 B) pushes them over, so a
// cross-platform verifier re-compresses with ITS deflater, the bytes never
// match the signature, and Android (which hard-requires verified announces)
// drops every iOS Sovran announce. Fix: the SIGNING form is encoded without
// compression on both Sovran platforms (wire format untouched — transmitted
// packets still compress). Mirror patch lives in sync-bitchat-android.js.
const ENCODE_COMPRESS_PARAM_ANCHOR =
  /    static func encode\(_ packet: BitchatPacket, padding: Bool = true\) -> Data\? \{\n        let version = packet\.version\n        guard version == 1 \|\| version == 2 else \{ return nil \}\n\n        \/\/ Try to compress payload when beneficial, keeping original size for later decoding\n        var payload = packet\.payload\n        var isCompressed = false\n        var originalPayloadSize: Int\?\n        if CompressionUtil\.shouldCompress\(payload\) \{/;
const ENCODE_COMPRESS_PARAM_REPLACEMENT =
  '    // [sovran] compressPayload: lets the signing form opt out of compression —\n' +
  '    // deflate output is not canonical across platforms, so signatures over a\n' +
  '    // compressed encoding fail to verify between iOS and Android.\n' +
  '    static func encode(_ packet: BitchatPacket, padding: Bool = true, compressPayload: Bool = true) -> Data? {\n' +
  '        let version = packet.version\n' +
  '        guard version == 1 || version == 2 else { return nil }\n' +
  '\n' +
  '        // Try to compress payload when beneficial, keeping original size for later decoding\n' +
  '        var payload = packet.payload\n' +
  '        var isCompressed = false\n' +
  '        var originalPayloadSize: Int?\n' +
  '        if compressPayload, CompressionUtil.shouldCompress(payload) {';
const SIGNING_NO_COMPRESS_ANCHOR =
  /            isRSR: false \/\/ RSR flag is mutable and not part of the signature\n        \)\n        return BinaryProtocol\.encode\(unsignedPacket\)/;
const SIGNING_NO_COMPRESS_REPLACEMENT =
  '            isRSR: false // RSR flag is mutable and not part of the signature\n' +
  '        )\n' +
  '        // [sovran] sign over the UNCOMPRESSED encoding: verifiers re-encode with\n' +
  '        // their own compressor and cross-platform deflate bytes differ.\n' +
  '        return BinaryProtocol.encode(unsignedPacket, compressPayload: false)';

// --- Suppress the direct-neighbors gossip TLV (0x04) in our announces ---
//
// Upstream gossips the peerIDs of connected peers inside every announce.
// Sovran's privacy contract is that an announce discloses ONLY the current
// profile's own identity — never the set of peers this device has seen
// (which can include the user's own other profiles on a second device).
// Receivers treat the absent TLV as "no neighbor claims" (optional field).
const NEIGHBOR_GOSSIP_ANCHOR =
  /        let connectedPeerIDs: \[Data\] = collectionsQueue\.sync \{\n            peerRegistry\.connectedRoutingData\n        \}\n[ \t]*\n        let announcement = AnnouncementPacket\(\n            nickname: myNickname,\n            noisePublicKey: noisePub,\n            signingPublicKey: signingPub,\n            directNeighbors: connectedPeerIDs\n        \)/;
const NEIGHBOR_GOSSIP_REPLACEMENT =
  '        // [sovran] neighbors gossip suppressed: announces disclose only the\n' +
  '        // current profile’s own identity, never the peerIDs this device has\n' +
  '        // seen. Receivers treat the absent 0x04 TLV as "no neighbor claims".\n' +
  '        let announcement = AnnouncementPacket(\n' +
  '            nickname: myNickname,\n' +
  '            noisePublicKey: noisePub,\n' +
  '            signingPublicKey: signingPub,\n' +
  '            directNeighbors: nil\n' +
  '        )';

let patched = 0;
const applied = {
  mismatchGuard: false,
  linkState: false,
  ecashAnnounceInject: false,
  ecashAnnounceParse: false,
  encodeCompressParam: false,
  signingNoCompress: false,
  neighborGossip: false,
};
for (const file of walk(ROOT)) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before
    .replace(PATTERN, REPLACEMENT)
    .replace(SCOPED_PRIVATE_IMPORT, SCOPED_PRIVATE_REPLACEMENT)
    .split(TESTNET_UUID).join(MAINNET_UUID);
  if (file.endsWith('BLEAnnounceHandlingPolicy.swift')) {
    const next = after.replace(MISMATCH_GUARD_ANCHOR, MISMATCH_GUARD_REPLACEMENT);
    if (next !== after) applied.mismatchGuard = true;
    after = next;
  }
  if (file.endsWith('BLEService.swift')) {
    let next = after.replace(LINKSTATE_ANCHOR, LINKSTATE_REPLACEMENT);
    if (next !== after) applied.linkState = true;
    after = next;
    next = after.replace(ECASH_ANNOUNCE_INJECT_ANCHOR, ECASH_ANNOUNCE_INJECT_REPLACEMENT);
    if (next !== after) applied.ecashAnnounceInject = true;
    after = next;
    next = after.replace(NEIGHBOR_GOSSIP_ANCHOR, NEIGHBOR_GOSSIP_REPLACEMENT);
    if (next !== after) applied.neighborGossip = true;
    after = next;
  }
  if (file.endsWith('BinaryProtocol.swift')) {
    const next = after.replace(ENCODE_COMPRESS_PARAM_ANCHOR, ENCODE_COMPRESS_PARAM_REPLACEMENT);
    if (next !== after) applied.encodeCompressParam = true;
    after = next;
  }
  if (file.endsWith('BitchatPacket.swift')) {
    const next = after.replace(SIGNING_NO_COMPRESS_ANCHOR, SIGNING_NO_COMPRESS_REPLACEMENT);
    if (next !== after) applied.signingNoCompress = true;
    after = next;
  }
  if (file.endsWith('BLEAnnounceHandler.swift')) {
    // The anchor text survives inside the replacement (the persist block is
    // re-emitted), so gate on the marker to stay idempotent.
    if (!after.includes('[sovran] record/clear the ecash capability TLV')) {
      const next = after.replace(ECASH_ANNOUNCE_PARSE_ANCHOR, ECASH_ANNOUNCE_PARSE_REPLACEMENT);
      if (next !== after) applied.ecashAnnounceParse = true;
      after = next;
    }
  }
  if (after !== before) {
    fs.writeFileSync(file, after);
    patched++;
  }
}

// Anchored patches must either apply now or already be applied from a previous
// run. Anything else means upstream changed shape — fail loudly so the vendor
// bump doesn't silently ship without the patch.
function assertApplied(name, appliedNow, file, alreadyPattern) {
  if (appliedNow) return;
  const content = fs.readFileSync(file, 'utf8');
  if (alreadyPattern.test(content)) return;
  console.error(
    `[patch-bitchat-imports] FATAL: ${name} anchor matched nothing in ${path.relative(ROOT, file)} ` +
      `and the patched form is absent. Upstream changed shape — fix the anchor.`
  );
  process.exit(1);
}
assertApplied(
  'MISMATCH_GUARD',
  applied.mismatchGuard,
  path.join(ROOT, 'bitchat', 'Services', 'BLE', 'BLEAnnounceHandlingPolicy.swift'),
  /\[sovran\] sender-mismatch reject relaxed/
);
assertApplied(
  'LINKSTATE',
  applied.linkState,
  path.join(ROOT, 'bitchat', 'Services', 'BLE', 'BLEService.swift'),
  /\[sovran\] de-privatized/
);
assertApplied(
  'ECASH_ANNOUNCE_INJECT',
  applied.ecashAnnounceInject,
  path.join(ROOT, 'bitchat', 'Services', 'BLE', 'BLEService.swift'),
  /\[sovran\] append ecash capability TLV/
);
assertApplied(
  'ECASH_ANNOUNCE_PARSE',
  applied.ecashAnnounceParse,
  path.join(ROOT, 'bitchat', 'Services', 'BLE', 'BLEAnnounceHandler.swift'),
  /\[sovran\] record\/clear the ecash capability TLV/
);
const BIT_FOUNDATION = path.join(
  ROOT,
  'localPackages',
  'BitFoundation',
  'Sources',
  'BitFoundation'
);
assertApplied(
  'ENCODE_COMPRESS_PARAM',
  applied.encodeCompressParam,
  path.join(BIT_FOUNDATION, 'BinaryProtocol.swift'),
  /\[sovran\] compressPayload: lets the signing form opt out/
);
assertApplied(
  'SIGNING_NO_COMPRESS',
  applied.signingNoCompress,
  path.join(BIT_FOUNDATION, 'BitchatPacket.swift'),
  /\[sovran\] sign over the UNCOMPRESSED encoding/
);
assertApplied(
  'NEIGHBOR_GOSSIP',
  applied.neighborGossip,
  path.join(ROOT, 'bitchat', 'Services', 'BLE', 'BLEService.swift'),
  /\[sovran\] neighbors gossip suppressed/
);
console.log(`[patch-bitchat-imports] patched ${patched} file(s)`);
