#!/usr/bin/env node
// Bitchat upstream splits its sources into separate Swift Package modules
// (BitLogger, BitFoundation). The BitChatModule pod compiles everything into
// a single Swift module, so those `import BitLogger` / `import BitFoundation`
// statements fail to resolve. Comment them out in place. Idempotent.

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

// Expose BLEService's CoreBluetooth managers + link-state collections so
// BitChatBLEBridge can read scan/advertise state and raw BLE link counts
// for diagnostics. `private` → `internal` keeps the fields module-private
// (only the compiled pod sees them), reachable from our bridge file.
// Idempotent.
const BLEFIELD_PATTERN =
  /^(\s*)private (var (?:centralManager|peripheralManager): CB[A-Za-z]+\?)/gm;
const BLEFIELD_REPLACEMENT = '$1internal $2';
const BLECOLL_PATTERN =
  /^(\s*)private (var (?:peripherals|subscribedCentrals|centralToPeerID|peerToPeripheralUUID|pendingWriteBuffers|peers): )/gm;
const BLECOLL_REPLACEMENT = '$1internal $2';
// Also expose the dispatch queues so the bridge can `sync` onto them when
// sampling the above collections — reading them from another thread without
// this would race and can crash.
const BLEQUEUE_PATTERN =
  /^(\s*)private (let (?:bleQueue|collectionsQueue) = DispatchQueue)/gm;
const BLEQUEUE_REPLACEMENT = '$1internal $2';
// `peripherals` and `peers` (above) use nested private structs
// `PeripheralState` and `PeerInfo`. Swift rejects `internal var` exposing a
// `private` type, so also lift those two struct declarations to internal.
const BLENESTED_PATTERN =
  /^(\s*)private (struct (?:PeripheralState|PeerInfo) )/gm;
const BLENESTED_REPLACEMENT = '$1internal $2';

// --- Native-side counters for inbound BLE notification flow ---
//
// Upstream BLEService's `peripheral(_:didUpdateValueFor:error:)` goes
// straight to SecureLogger (OSLog) — invisible from our JS-side logger.
// When the inbound-receive path is silently broken, we have no way to tell
// if notifications are arriving at all vs. being dropped later.
//
// Inject three counters that the bridge's `getDiagnostics()` exposes:
//   inboundNotifyCount      — every `didUpdateValueFor` invocation
//   inboundNotifyErrorCount — invocations where `error != nil`
//   inboundNotifyEmptyCount — invocations where `characteristic.value` is nil/empty
//
// Idempotent: the insert is guarded by a sentinel comment we check for.
// Patched only inside BLEService.swift.
const COUNTERS_SENTINEL = '// SOVRAN_DIAG_NOTIFY_COUNTERS';
const COUNTERS_DECL_ANCHOR = /^(\s*internal var pendingWriteBuffers: \[String: Data\] = \[:\])$/m;
const COUNTERS_DECL_INSERT = (anchor) =>
  `${anchor}\n    ${COUNTERS_SENTINEL}\n    internal var inboundNotifyCount: Int = 0\n    internal var inboundNotifyErrorCount: Int = 0\n    internal var inboundNotifyEmptyCount: Int = 0`;

const COUNTERS_BODY_ANCHOR =
  /(func peripheral\(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error\?\) \{\n)/;
const COUNTERS_BODY_INSERT = (head) =>
  `${head}        ${COUNTERS_SENTINEL}\n        self.inboundNotifyCount &+= 1\n        if error != nil { self.inboundNotifyErrorCount &+= 1 }\n        if characteristic.value?.isEmpty ?? true { self.inboundNotifyEmptyCount &+= 1 }\n`;

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

// --- handleAnnounce gate counters ---
//
// handleAnnounce has several early-return paths that silently drop inbound
// announces. Symptoms (announcedPeers:0) can come from any of them:
//  - AnnouncementPacket.decode failure (line 3834)
//  - sender ID mismatch (line 3842)
//  - stale timestamp (line 3857)
//  - signature verification failed (line 3870-3873)
//  - "require verified, else reject" master gate (line 3909)
//
// Inject counters at each so the bridge can report which gate fires.
const ANNOUNCE_SENTINEL = '// SOVRAN_DIAG_ANNOUNCE_COUNTERS';
const ANNOUNCE_DECL_ANCHOR = /^(\s*internal var inboundNotifyEmptyCount: Int = 0)$/m;
const ANNOUNCE_DECL_INSERT = (anchor) =>
  `${anchor}\n    ${ANNOUNCE_SENTINEL}\n    internal var announceReceivedCount: Int = 0\n    internal var announceDecodeFailCount: Int = 0\n    internal var announceSenderMismatchCount: Int = 0\n    internal var announceStaleCount: Int = 0\n    internal var announceSigFailCount: Int = 0\n    internal var announceUnverifiedCount: Int = 0\n    internal var announceAcceptedCount: Int = 0`;

const ANNOUNCE_TOP_ANCHOR =
  /(private func handleAnnounce\(_ packet: BitchatPacket, from peerID: PeerID\) \{\n)/;
const ANNOUNCE_TOP_INSERT = (head) =>
  `${head}        ${ANNOUNCE_SENTINEL}\n        self.announceReceivedCount &+= 1\n`;

const ANNOUNCE_DECODE_FAIL_ANCHOR =
  /(            SecureLogger\.error\("❌ Failed to decode announce packet from \\\(peerID\)", category: \.session\)\n)/;
const ANNOUNCE_DECODE_FAIL_INSERT = (line) =>
  `            ${ANNOUNCE_SENTINEL}\n            self.announceDecodeFailCount &+= 1\n${line}`;

const ANNOUNCE_MISMATCH_ANCHOR =
  /(            SecureLogger\.warning\("⚠️ Announce sender mismatch: derived [^\n]+\n)/;
const ANNOUNCE_MISMATCH_INSERT = (line) =>
  `            ${ANNOUNCE_SENTINEL}\n            self.announceSenderMismatchCount &+= 1\n${line}`;

const ANNOUNCE_STALE_ANCHOR =
  /(                SecureLogger\.debug\("⏰ Ignoring stale announce[^\n]+\n)/;
const ANNOUNCE_STALE_INSERT = (line) =>
  `                ${ANNOUNCE_SENTINEL}\n                self.announceStaleCount &+= 1\n${line}`;

const ANNOUNCE_SIGFAIL_ANCHOR =
  /(                SecureLogger\.warning\("⚠️ Signature verification for announce failed[^\n]+\n)/;
const ANNOUNCE_SIGFAIL_INSERT = (line) =>
  `                ${ANNOUNCE_SENTINEL}\n                self.announceSigFailCount &+= 1\n${line}`;

const ANNOUNCE_UNVERIFIED_ANCHOR =
  /(                SecureLogger\.warning\("❌ Ignoring unverified announce from[^\n]+\n)/;
const ANNOUNCE_UNVERIFIED_INSERT = (line) =>
  `                ${ANNOUNCE_SENTINEL}\n                self.announceUnverifiedCount &+= 1\n${line}`;

// The accepted path — the `// Update or create peer info` comment sits right
// after the `!verified` guard's `return`. Increment when we enter the update
// branch (means all gates passed).
const ANNOUNCE_ACCEPTED_ANCHOR = /(\n            \/\/ Update or create peer info\n)/;
const ANNOUNCE_ACCEPTED_INSERT = (block) =>
  `\n            ${ANNOUNCE_SENTINEL}\n            self.announceAcceptedCount &+= 1${block}`;

let patched = 0;
for (const file of walk(ROOT)) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before
    .replace(PATTERN, REPLACEMENT)
    .replace(SCOPED_PRIVATE_IMPORT, SCOPED_PRIVATE_REPLACEMENT)
    .split(TESTNET_UUID).join(MAINNET_UUID);
  if (file.endsWith('BLEService.swift')) {
    after = after
      .replace(BLEFIELD_PATTERN, BLEFIELD_REPLACEMENT)
      .replace(BLECOLL_PATTERN, BLECOLL_REPLACEMENT)
      .replace(BLEQUEUE_PATTERN, BLEQUEUE_REPLACEMENT)
      .replace(BLENESTED_PATTERN, BLENESTED_REPLACEMENT)
      .replace(MISMATCH_RETURN_ANCHOR, MISMATCH_RETURN_REPLACEMENT);

    // Idempotent: only inject the counters if the sentinel isn't already there.
    if (!after.includes(COUNTERS_SENTINEL)) {
      after = after.replace(COUNTERS_DECL_ANCHOR, (_, m1) => COUNTERS_DECL_INSERT(m1));
      after = after.replace(COUNTERS_BODY_ANCHOR, (_, m1) => COUNTERS_BODY_INSERT(m1));
    }
    if (!after.includes(ANNOUNCE_SENTINEL)) {
      after = after.replace(ANNOUNCE_DECL_ANCHOR, (_, m1) => ANNOUNCE_DECL_INSERT(m1));
      after = after.replace(ANNOUNCE_TOP_ANCHOR, (_, m1) => ANNOUNCE_TOP_INSERT(m1));
      after = after.replace(ANNOUNCE_DECODE_FAIL_ANCHOR, (_, m1) => ANNOUNCE_DECODE_FAIL_INSERT(m1));
      after = after.replace(ANNOUNCE_MISMATCH_ANCHOR, (_, m1) => ANNOUNCE_MISMATCH_INSERT(m1));
      after = after.replace(ANNOUNCE_STALE_ANCHOR, (_, m1) => ANNOUNCE_STALE_INSERT(m1));
      after = after.replace(ANNOUNCE_SIGFAIL_ANCHOR, (_, m1) => ANNOUNCE_SIGFAIL_INSERT(m1));
      after = after.replace(ANNOUNCE_UNVERIFIED_ANCHOR, (_, m1) => ANNOUNCE_UNVERIFIED_INSERT(m1));
      after = after.replace(ANNOUNCE_ACCEPTED_ANCHOR, (_, m1) => ANNOUNCE_ACCEPTED_INSERT(m1));
    }
  }
  if (after !== before) {
    fs.writeFileSync(file, after);
    patched++;
  }
}
console.log(`[patch-bitchat-imports] patched ${patched} file(s)`);
