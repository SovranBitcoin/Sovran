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
//
// Nut Drop note: peer Nostr identity is exchanged via bitchat's NATIVE
// favorite notification ([FAVORITED]:npub), not a custom announce TLV, so this
// patcher carries NO ecash-specific or signing-canonicalization patches — only
// the build fix-ups, the mainnet UUID, and two small interop/privacy tweaks.

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
// TODO(sovran): re-test against a current App Store bitchat build (v1.5.3+); if
// its announces now pass the derived-peerID check, drop this patch entirely.
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

// --- Suppress the direct-neighbors gossip TLV (0x04) in our announces ---
//
// Upstream gossips the peerIDs of connected peers inside every announce.
// Sovran's privacy contract is that an announce discloses ONLY the current
// profile's own identity — never the set of peers this device has seen
// (which can include the user's own other profiles on a second device).
// Receivers treat the absent TLV as "no neighbor claims" (optional field).
// Bonus: it keeps announces under the 100-byte compression threshold, so the
// signing form stays canonical cross-platform with no further patch.
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
    next = after.replace(NEIGHBOR_GOSSIP_ANCHOR, NEIGHBOR_GOSSIP_REPLACEMENT);
    if (next !== after) applied.neighborGossip = true;
    after = next;
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
  'NEIGHBOR_GOSSIP',
  applied.neighborGossip,
  path.join(ROOT, 'bitchat', 'Services', 'BLE', 'BLEService.swift'),
  /\[sovran\] neighbors gossip suppressed/
);
console.log(`[patch-bitchat-imports] patched ${patched} file(s)`);
