#!/usr/bin/env node
// Copies the headless subset of the vendored bitchat-android sources
// (android/BitChatVendor git submodule) into the gitignored generated source
// dir android/vendor-src/, applying Sovran patches during the copy. Runs on
// postinstall, mirroring patch-bitchat-imports.js for the iOS submodule.
//
// Why copy instead of gradle sourceSets + excludes: we need ~15 file-level
// exclusions inside otherwise-included packages (ui/, nostr/, services/), and
// AGP/KGP exclude filters are not reliably honored by Kotlin compile tasks.
// The copy also keeps the submodule pristine and makes the vendored surface an
// explicit, reviewable list.
//
// --- Upgrading the bitchat-android submodule ---
//   1) cd modules/bitchat-module/android/BitChatVendor
//   2) git fetch origin && git checkout <sha>
//   3) cd back to repo root, run `bun install` (postinstall re-runs this)
//   4) `npx expo prebuild -p android` and build
//   5) If an allowlist entry or patch anchor stops matching, this script fails
//      loudly — fix the list/anchor against the new upstream shape.

const fs = require('fs');
const path = require('path');

const MODULE_ROOT = path.resolve(__dirname, '..', 'android');
const VENDOR = path.join(MODULE_ROOT, 'BitChatVendor');
const VENDOR_SRC = path.join(VENDOR, 'app', 'src', 'main', 'java', 'com', 'bitchat', 'android');
const VENDOR_ASSETS = path.join(VENDOR, 'app', 'src', 'main', 'assets');
const DEST_SRC = path.join(MODULE_ROOT, 'vendor-src', 'com', 'bitchat', 'android');
const DEST_ASSETS = path.join(MODULE_ROOT, 'vendor-assets');

if (!fs.existsSync(VENDOR_SRC)) {
  console.log(`[sync-bitchat-android] ${VENDOR_SRC} not present (submodule not checked out?), skipping.`);
  process.exit(0);
}

// Headless subset: BLE mesh + Noise + identity + low-level Nostr. Everything
// Compose/Activity/Tor/location-coupled stays out; the four excluded classes
// the subset still references (ui.NotificationManager, services.NicknameProvider,
// services.MessageRouter, net.OkHttpProvider) are stubbed in
// android/src/main/java/com/bitchat/android/ (same trick as iOS TorStub.swift).
const INCLUDE_DIRS = [
  'mesh',
  'noise',
  'protocol',
  'model',
  'sync',
  'util',
  'services/meshgraph',
];
const INCLUDE_FILES = [
  'crypto/EncryptionService.kt',
  'identity/SecureIdentityStateManager.kt',
  // Referenced (fully qualified) from mesh/MessageHandler + BluetoothMeshService.
  'favorites/FavoritesPersistenceService.kt',
  'services/VerificationService.kt',
  'services/AppStateStore.kt',
  'services/SeenMessageStore.kt',
  // Compose-free debug managers; mesh imports DebugSettingsManager + DebugScanResult.
  'ui/debug/DebugSettingsManager.kt',
  'ui/debug/DebugPreferenceManager.kt',
  'ui/NotificationTextUtils.kt',
  'features/file/FileUtils.kt',
  // Referenced fully-qualified from nostr/RelayDirectory.closestRelaysForGeohash.
  'geohash/Geohash.kt',
  // Low-level Nostr (relay client + crypto + identity). The UI-coupled handlers
  // (GeohashRepository, GeohashMessageHandler, NostrDirectMessageHandler,
  // NostrTransport, LocationNotes*, NostrTestManager, NostrClient) stay out —
  // BitChatNostrBridge.kt replaces them.
  'nostr/NostrEvent.kt',
  'nostr/NostrFilter.kt',
  'nostr/NostrRequest.kt',
  'nostr/NostrCrypto.kt',
  'nostr/NostrIdentity.kt',
  'nostr/NostrProofOfWork.kt',
  'nostr/PoWPreferenceManager.kt',
  'nostr/NostrProtocol.kt',
  'nostr/NostrEmbeddedBitChat.kt',
  'nostr/NostrRelayManager.kt',
  'nostr/NostrSubscriptionManager.kt',
  'nostr/NostrEventDeduplicator.kt',
  'nostr/RelayDirectory.kt',
  'nostr/Bech32.kt',
  'nostr/GeohashAliasRegistry.kt',
  'nostr/GeohashConversationRegistry.kt',
];
const INCLUDE_ASSETS = ['nostr_relays.csv'];

// Anchored patches applied during the copy. Each must apply (or the patched
// form must already exist — they never do on a fresh copy, but keep the check
// cheap and uniform). A missed anchor means upstream changed shape: fail loudly.
const PATCHES = [
  {
    file: 'mesh/BluetoothMeshService.kt',
    name: 'ENCRYPTION_SERVICE_INTERNAL',
    anchor: /    private val encryptionService = EncryptionService\(context\)/,
    replacement:
      '    // [sovran] internal — BitChatBLEBridge.resetPrivateChat() clears Noise\n' +
      '    // sessions via encryptionService; the vendor exposes no public reset.\n' +
      '    internal val encryptionService = EncryptionService(context)',
  },
  // --- Ecash capability beacon TLV (0xF0) ---
  //
  // A 6-byte flags-only beacon (magic "NUTB" + version + capability flags):
  // "this peer answers NUT-18 payment-request solicits over Noise". No key
  // material on the air — the lock key + trusted mints travel per-send
  // inside the payment request. Open extension — any bitchat client may
  // implement it (spec draft in
  // modules/bitchat-module/docs/nut18-bitchat-transport.md).
  // Vanilla decoders skip unknown announce TLVs ("tolerant decoder" in
  // IdentityAnnouncement.kt), and the TLV is appended BEFORE signing —
  // exactly how upstream already appends its gossip TLV (0x04) here — so the
  // Ed25519 announce signature covers it. TLV bytes + the inbound registry
  // live in the Sovran-owned com.bitchat.android.ecash.EcashAnnounceExtension.
  {
    file: 'mesh/BluetoothMeshService.kt',
    name: 'ECASH_ANNOUNCE_INJECT_BROADCAST',
    anchor:
      /            val announcePacket = BitchatPacket\(\n                type = MessageType\.ANNOUNCE\.value,/,
    replacement:
      '            // [sovran] append ecash capability TLV (0xF0); appended before signing\n' +
      '            // so the announce signature covers it. Plain `if` (not ?.let) keeps\n' +
      '            // the tlvPayload smart cast valid at the packet construction below.\n' +
      '            val ecashTLV = com.bitchat.android.ecash.EcashAnnounceExtension.localTLV\n' +
      '            if (ecashTLV != null) {\n' +
      '                tlvPayload = tlvPayload + ecashTLV\n' +
      '            }\n' +
      '\n' +
      '            val announcePacket = BitchatPacket(\n' +
      '                type = MessageType.ANNOUNCE.value,',
  },
  {
    file: 'mesh/BluetoothMeshService.kt',
    name: 'ECASH_ANNOUNCE_INJECT_PEER',
    anchor:
      /        val packet = BitchatPacket\(\n            type = MessageType\.ANNOUNCE\.value,/,
    replacement:
      '        // [sovran] append ecash capability TLV (0xF0); appended before signing\n' +
      '        // so the announce signature covers it. Plain `if` (not ?.let) keeps\n' +
      '        // the tlvPayload smart cast valid at the packet construction below.\n' +
      '        val ecashTLV = com.bitchat.android.ecash.EcashAnnounceExtension.localTLV\n' +
      '        if (ecashTLV != null) {\n' +
      '            tlvPayload = tlvPayload + ecashTLV\n' +
      '        }\n' +
      '\n' +
      '        val packet = BitchatPacket(\n' +
      '            type = MessageType.ANNOUNCE.value,',
  },
  // --- Compression-independent signing form (mirror of the iOS patch in
  // patch-bitchat-imports.js — see its comment for the full rationale) ---
  //
  // Signing/verification must run over the UNCOMPRESSED encoding: raw-deflate
  // output differs between java.util.zip and Apple libcompression, so a
  // signature over a compressed payload (announces cross the 100-byte
  // threshold once the ecash TLV is appended) never verifies cross-platform.
  // Wire format untouched — transmitted packets still compress.
  {
    file: 'protocol/BinaryProtocol.kt',
    name: 'SIGNING_COMPRESS_PARAM',
    anchor: /    fun encode\(packet: BitchatPacket\): ByteArray\? \{/,
    replacement:
      '    // [sovran] compressPayload: lets the signing form opt out of compression —\n' +
      '    // deflate output is not canonical across platforms, so signatures over a\n' +
      '    // compressed encoding fail to verify between Android and iOS.\n' +
      '    fun encode(packet: BitchatPacket, compressPayload: Boolean = true): ByteArray? {',
  },
  {
    file: 'protocol/BinaryProtocol.kt',
    name: 'SIGNING_COMPRESS_GATE',
    anchor: /            if \(CompressionUtil\.shouldCompress\(payload\)\) \{/,
    replacement: '            if (compressPayload && CompressionUtil.shouldCompress(payload)) {',
  },
  {
    file: 'protocol/BinaryProtocol.kt',
    name: 'SIGNING_NO_COMPRESS',
    anchor: /        return BinaryProtocol\.encode\(unsignedPacket\)\n    \}/,
    replacement:
      '        // [sovran] sign over the UNCOMPRESSED encoding: verifiers re-encode with\n' +
      '        // their own compressor and cross-platform deflate bytes differ.\n' +
      '        return BinaryProtocol.encode(unsignedPacket, compressPayload = false)\n' +
      '    }',
  },
  // Records (or clears) the ecash extension from the raw announce payload —
  // the same out-of-band re-parse upstream uses for its gossip TLV. The
  // insertion point is reached only after the `if (!verified) return false`
  // gate, so unverified announces never touch the registry.
  {
    file: 'mesh/MessageHandler.kt',
    name: 'ECASH_ANNOUNCE_PARSE',
    anchor:
      /        \/\/ Update peer info with verification status through new method\n        val isFirstAnnounce = delegate\?\.updatePeerInfo\(/,
    replacement:
      '        // [sovran] record/clear the ecash capability TLV (0xF0). Verified\n' +
      '        // announces only; absence of the TLV clears the entry.\n' +
      '        com.bitchat.android.ecash.EcashAnnounceExtension.record(peerID, packet.payload)\n' +
      '\n' +
      '        // Update peer info with verification status through new method\n' +
      '        val isFirstAnnounce = delegate?.updatePeerInfo(',
  },
];

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(rel, patches) {
  const src = path.join(VENDOR_SRC, rel);
  if (!fs.existsSync(src)) {
    console.error(`[sync-bitchat-android] FATAL: allowlisted path missing upstream: ${rel}`);
    process.exit(1);
  }
  let content = fs.readFileSync(src, 'utf8');
  for (const patch of patches.filter((p) => p.file === rel)) {
    const next = content.replace(patch.anchor, patch.replacement);
    if (next === content) {
      console.error(
        `[sync-bitchat-android] FATAL: patch ${patch.name} anchor matched nothing in ${rel}. ` +
          'Upstream changed shape — fix the anchor.'
      );
      process.exit(1);
    }
    content = next;
  }
  const dest = path.join(DEST_SRC, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  return 1;
}

function copyDir(relDir, patches) {
  const srcDir = path.join(VENDOR_SRC, relDir);
  if (!fs.existsSync(srcDir)) {
    console.error(`[sync-bitchat-android] FATAL: allowlisted dir missing upstream: ${relDir}`);
    process.exit(1);
  }
  let count = 0;
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const rel = path.join(relDir, ent.name);
    if (ent.isDirectory()) count += copyDir(rel, patches);
    else if (ent.name.endsWith('.kt') || ent.name.endsWith('.java')) count += copyFile(rel, patches);
  }
  return count;
}

rmrf(path.join(MODULE_ROOT, 'vendor-src'));
rmrf(DEST_ASSETS);

let copied = 0;
for (const dir of INCLUDE_DIRS) copied += copyDir(dir, PATCHES);
for (const file of INCLUDE_FILES) copied += copyFile(file, PATCHES);

fs.mkdirSync(DEST_ASSETS, { recursive: true });
for (const asset of INCLUDE_ASSETS) {
  const src = path.join(VENDOR_ASSETS, asset);
  if (!fs.existsSync(src)) {
    console.error(`[sync-bitchat-android] FATAL: asset missing upstream: ${asset}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(DEST_ASSETS, asset));
}

// The app depends on this module via `file:` — bun COPIES the package into
// node_modules before postinstall runs, and Expo's Android autolinking builds
// that copy (iOS resolves ../modules/bitchat-module directly). Mirror the
// generated sources into the copy so a fresh install (EAS) is deterministic.
const NODE_MODULES_COPY = path.resolve(
  __dirname, '..', '..', '..', 'node_modules', 'bitchat-module', 'android'
);
if (fs.existsSync(NODE_MODULES_COPY) && fs.realpathSync(NODE_MODULES_COPY) !== MODULE_ROOT) {
  for (const sub of ['vendor-src', 'vendor-assets']) {
    rmrf(path.join(NODE_MODULES_COPY, sub));
    fs.cpSync(path.join(MODULE_ROOT, sub), path.join(NODE_MODULES_COPY, sub), { recursive: true });
  }
}

console.log(`[sync-bitchat-android] copied ${copied} source file(s) + ${INCLUDE_ASSETS.length} asset(s)`);
