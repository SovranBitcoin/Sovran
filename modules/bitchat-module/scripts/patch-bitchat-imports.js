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
// Restore v1.5.1 semantics by removing just the `return` after the warn line.
// Idempotent: if the return has already been removed, the anchor won't match.
const MISMATCH_RETURN_ANCHOR =
  /(            SecureLogger\.warning\("⚠️ Announce sender mismatch: [^\n]+\n)            return\n/;
const MISMATCH_RETURN_REPLACEMENT =
  '$1            // [sovran] return removed — App Store bitchat v1.5.1 treats this as warn-only.\n            // Without this relax, every inbound announce from v1.5.1 peers is rejected.\n';

let patched = 0;
for (const file of walk(ROOT)) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before
    .replace(PATTERN, REPLACEMENT)
    .replace(SCOPED_PRIVATE_IMPORT, SCOPED_PRIVATE_REPLACEMENT)
    .split(TESTNET_UUID).join(MAINNET_UUID);
  if (file.endsWith('BLEService.swift')) {
    after = after.replace(MISMATCH_RETURN_ANCHOR, MISMATCH_RETURN_REPLACEMENT);
  }
  if (after !== before) {
    fs.writeFileSync(file, after);
    patched++;
  }
}
console.log(`[patch-bitchat-imports] patched ${patched} file(s)`);
