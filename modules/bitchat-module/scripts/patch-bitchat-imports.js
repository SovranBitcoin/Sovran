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

if (!fs.existsSync(ROOT)) {
  console.log(`[patch-bitchat-imports] ${ROOT} not present, skipping.`);
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

// --- Append the SVRN extension TLV (0xF0) to outgoing announces ---
//
// Sovran clients mark themselves on the mesh with a custom announce TLV
// (magic "SVRN" + capability flags + the profile's Cashu P2PK pubkey) so the
// Nut Drop UI can list only Sovran peers and P2PK-lock tokens to them.
// Vanilla bitchat decoders skip unknown announce TLVs by design (upstream
// Packets.swift "tolerant decoder" + unit test), and the TLV is appended
// BEFORE signPacket so the Ed25519 announce signature covers it — vanilla
// verification still passes. TLV bytes come from SovranAnnounceState
// (SovranAnnounceExtension.swift, Sovran-owned, same compiled module).
// Idempotent: once `guard var payload` is in place, the anchor won't match.
const SVRN_ANNOUNCE_INJECT_ANCHOR =
  /        guard let payload = announcement\.encode\(\) else \{\n            SecureLogger\.error\("❌ Failed to encode announce packet", category: \.session\)\n            return\n        \}\n/;
const SVRN_ANNOUNCE_INJECT_REPLACEMENT =
  '        guard var payload = announcement.encode() else {\n' +
  '            SecureLogger.error("❌ Failed to encode announce packet", category: .session)\n' +
  '            return\n' +
  '        }\n' +
  '        // [sovran] append SVRN extension TLV (0xF0). Vanilla decoders skip\n' +
  '        // unknown announce TLVs; appended before signPacket so the announce\n' +
  '        // signature covers it.\n' +
  '        if let sovranTLV = SovranAnnounceState.shared.localTLV {\n' +
  '            payload.append(sovranTLV)\n' +
  '        }\n';

// --- Record the SVRN extension TLV from verified incoming announces ---
//
// Parses the raw announce payload out-of-band (same pattern upstream Android
// uses for its gossip TLV) and stores per-peer flags + P2PK pubkey for
// BitChatBLEBridge.getPeers(). Verified announces only — the recording sits
// after the unverified-announce early return inside the registry barrier, at
// the same spot upstream persists identity. A verified announce WITHOUT the
// TLV clears the entry (announce TLVs are authoritative per-announce).
const SVRN_ANNOUNCE_PARSE_ANCHOR =
  /        \/\/ Persist cryptographic identity and signing key for robust offline verification\n        env\.persistIdentity\(announcement\)\n/;
const SVRN_ANNOUNCE_PARSE_REPLACEMENT =
  '        // [sovran] record/clear the SVRN extension TLV (0xF0). Verified\n' +
  '        // announces only; absence of the TLV clears the entry.\n' +
  '        if verifiedAnnounce {\n' +
  '            SovranAnnounceState.shared.record(peerID: peerID.id, announcePayload: packet.payload)\n' +
  '        }\n' +
  '\n' +
  '        // Persist cryptographic identity and signing key for robust offline verification\n' +
  '        env.persistIdentity(announcement)\n';

let patched = 0;
const applied = {
  mismatchGuard: false,
  linkState: false,
  svrnAnnounceInject: false,
  svrnAnnounceParse: false,
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
    next = after.replace(SVRN_ANNOUNCE_INJECT_ANCHOR, SVRN_ANNOUNCE_INJECT_REPLACEMENT);
    if (next !== after) applied.svrnAnnounceInject = true;
    after = next;
  }
  if (file.endsWith('BLEAnnounceHandler.swift')) {
    // The anchor text survives inside the replacement (the persist block is
    // re-emitted), so gate on the marker to stay idempotent.
    if (!after.includes('[sovran] record/clear the SVRN extension TLV')) {
      const next = after.replace(SVRN_ANNOUNCE_PARSE_ANCHOR, SVRN_ANNOUNCE_PARSE_REPLACEMENT);
      if (next !== after) applied.svrnAnnounceParse = true;
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
  'SVRN_ANNOUNCE_INJECT',
  applied.svrnAnnounceInject,
  path.join(ROOT, 'bitchat', 'Services', 'BLE', 'BLEService.swift'),
  /\[sovran\] append SVRN extension TLV/
);
assertApplied(
  'SVRN_ANNOUNCE_PARSE',
  applied.svrnAnnounceParse,
  path.join(ROOT, 'bitchat', 'Services', 'BLE', 'BLEAnnounceHandler.swift'),
  /\[sovran\] record\/clear the SVRN extension TLV/
);
console.log(`[patch-bitchat-imports] patched ${patched} file(s)`);
