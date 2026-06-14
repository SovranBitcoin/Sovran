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

// (Removed: the neighbor-gossip suppression patch. Sovran now announces its
// direct-neighbors TLV exactly like upstream bitchat — matching Android, which
// never suppressed it, and restoring visibility to stock clients. Keeping vendor
// divergence to the agreed minimum: extended length, the favorite/creq, the
// tie-breaker, and the upstream-iOS re-handshake recovery.)

// --- Extend PrivateMessagePacket content length (0xFF sentinel) ---
//
// Upstream caps private-message content at 255 bytes (1-byte TLV length;
// encode() returns nil above it). Sovran delivers an ecash token — and a
// creq-bearing favorite — as a single private Noise DM that exceeds 255 bytes.
// The transport already fragments large encrypted packets, so the only blocker
// is the content-length field. Extend it: length 0x00–0xFE = literal 1 byte
// (byte-identical to stock); 0xFF = sentinel + 2-byte big-endian length
// (≤64 KB). messageID stays 1-byte. Stock misparses our >254-byte content,
// which is acceptable (Sovran↔Sovran payments). Mirror in sync-bitchat-android.js.
const EXTENDED_PM_ENCODE_ANCHOR =
  /        guard let contentData = content\.data\(using: \.utf8\), contentData\.count <= 255 else \{ return nil \}\n        data\.append\(TLVType\.content\.rawValue\)\n        data\.append\(UInt8\(contentData\.count\)\)/;
const EXTENDED_PM_ENCODE_REPLACEMENT =
  '        // [sovran] extended content length: 0x00–0xFE literal; 0xFF sentinel\n' +
  '        // + 2-byte big-endian length (≤64 KB). messageID stays 1-byte.\n' +
  '        guard let contentData = content.data(using: .utf8), contentData.count <= 0xFFFF else { return nil }\n' +
  '        data.append(TLVType.content.rawValue)\n' +
  '        if contentData.count <= 0xFE {\n' +
  '            data.append(UInt8(contentData.count))\n' +
  '        } else {\n' +
  '            data.append(0xFF)\n' +
  '            data.append(UInt8((contentData.count >> 8) & 0xFF))\n' +
  '            data.append(UInt8(contentData.count & 0xFF))\n' +
  '        }';
const EXTENDED_PM_DECODE_ANCHOR =
  /            let length = Int\(data\[offset\]\)\n            offset \+= 1\n\n            guard offset \+ length <= data\.count else \{ return nil \}\n            let value = data\[offset\.\.<offset \+ length\]\n            offset \+= length\n\n            switch type \{\n            case \.messageID:/;
const EXTENDED_PM_DECODE_REPLACEMENT =
  '            // [sovran] extended length read: 0xFF sentinel → 2-byte big-endian.\n' +
  '            var length = Int(data[offset])\n' +
  '            offset += 1\n' +
  '            if length == 0xFF {\n' +
  '                guard offset + 2 <= data.count else { return nil }\n' +
  '                length = (Int(data[offset]) << 8) | Int(data[offset + 1])\n' +
  '                offset += 2\n' +
  '            }\n' +
  '\n' +
  '            guard offset + length <= data.count else { return nil }\n' +
  '            let value = data[offset..<offset + length]\n' +
  '            offset += length\n' +
  '\n' +
  '            switch type {\n' +
  '            case .messageID:';

let patched = 0;
const applied = {
  mismatchGuard: false,
  linkState: false,
  extendedPmEncode: false,
  extendedPmDecode: false,
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
    const next = after.replace(LINKSTATE_ANCHOR, LINKSTATE_REPLACEMENT);
    if (next !== after) applied.linkState = true;
    after = next;
  }
  if (file.endsWith('Packets.swift')) {
    let next = after.replace(EXTENDED_PM_ENCODE_ANCHOR, EXTENDED_PM_ENCODE_REPLACEMENT);
    if (next !== after) applied.extendedPmEncode = true;
    after = next;
    next = after.replace(EXTENDED_PM_DECODE_ANCHOR, EXTENDED_PM_DECODE_REPLACEMENT);
    if (next !== after) applied.extendedPmDecode = true;
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
function assertApplied(name, appliedNow, file, alreadyPattern, optional = false) {
  if (appliedNow) return;
  // A patch whose target file does not exist at the pinned vendor version is
  // skipped (the upstream code it adjusts isn't there to adjust). Used for
  // version-specific files like BLEAnnounceHandlingPolicy.swift (post-v1.5.1).
  if (!fs.existsSync(file)) {
    if (optional) {
      console.warn(`[patch-bitchat-imports] SKIP: ${name} — target file absent at this vendor version`);
      return;
    }
    console.error(`[patch-bitchat-imports] FATAL: ${name} target file missing: ${path.relative(ROOT, file)}`);
    process.exit(1);
  }
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
  /\[sovran\] sender-mismatch reject relaxed/,
  // Optional: this file (and the strict sender-mismatch check it relaxes) was
  // added after v1.5.1. On the v1.5.1 pin there is nothing to relax.
  true
);
assertApplied(
  'LINKSTATE',
  applied.linkState,
  path.join(ROOT, 'bitchat', 'Services', 'BLE', 'BLEService.swift'),
  /\[sovran\] de-privatized/
);
assertApplied(
  'EXTENDED_PM_ENCODE',
  applied.extendedPmEncode,
  path.join(ROOT, 'bitchat', 'Protocols', 'Packets.swift'),
  /\[sovran\] extended content length: 0x00/
);
assertApplied(
  'EXTENDED_PM_DECODE',
  applied.extendedPmDecode,
  path.join(ROOT, 'bitchat', 'Protocols', 'Packets.swift'),
  /\[sovran\] extended length read: 0xFF sentinel/
);
console.log(`[patch-bitchat-imports] patched ${patched} file(s)`);

// Bake the vendored submodule commit into a generated Swift constant so the
// running build's bitchat version is logged at startBLE (bitchat.peers.ble_start_ok)
// — catching a stale build that predates a fragmentation/protocol fix. Best-effort;
// leaves the committed "unknown" placeholder if git is unavailable.
(function writeVendorVersion() {
  let commit = 'unknown';
  try {
    commit =
      require('child_process')
        .execSync('git rev-parse --short HEAD', { cwd: ROOT })
        .toString()
        .trim() || 'unknown';
  } catch {
    /* git unavailable — keep placeholder */
  }
  const out = path.join(path.resolve(__dirname, '..', 'ios'), 'BitchatVendorVersion.swift');
  fs.writeFileSync(
    out,
    '// GENERATED at prebuild by scripts/patch-bitchat-imports.js — do not edit by hand.\n' +
      '// Short SHA of the vendored ios/BitChatVendor submodule this build compiled from,\n' +
      '// logged at startBLE so the running build’s bitchat version is verifiable.\n' +
      'enum BitchatVendor {\n' +
      `    static let commit = "${commit}"\n` +
      '}\n'
  );
  console.log(`[patch-bitchat-imports] vendor version: ${commit}`);
})();
