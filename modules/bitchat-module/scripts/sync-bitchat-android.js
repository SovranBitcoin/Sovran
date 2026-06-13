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
  // --- Extend PrivateMessagePacket content length (0xFF sentinel) ---
  //
  // Mirror of the iOS Packets.swift patch (patch-bitchat-imports.js). Lets a
  // private DM carry content >255 bytes (a whole ecash token + a creq-bearing
  // favorite): content length 0x00–0xFE = literal 1 byte (stock-identical);
  // 0xFF = sentinel + 2-byte big-endian length (≤64 KB). messageID stays 1-byte.
  // Stock misparses our >254-byte content — acceptable (Sovran↔Sovran payments).
  {
    file: 'model/NoiseEncrypted.kt',
    name: 'EXTENDED_PM_ENCODE_GUARD',
    anchor: /        if \(messageIDData\.size > 255 \|\| contentData\.size > 255\) \{\n            return null\n        \}/,
    replacement:
      '        // [sovran] extended content length: messageID 1-byte, content ≤64 KB.\n' +
      '        if (messageIDData.size > 255 || contentData.size > 0xFFFF) {\n' +
      '            return null\n' +
      '        }',
  },
  {
    file: 'model/NoiseEncrypted.kt',
    name: 'EXTENDED_PM_ENCODE_LEN',
    anchor: /        result\.add\(TLVType\.CONTENT\.value\.toByte\(\)\)\n        result\.add\(contentData\.size\.toByte\(\)\)/,
    replacement:
      '        result.add(TLVType.CONTENT.value.toByte())\n' +
      '        // [sovran] 0x00–0xFE literal; 0xFF sentinel + 2-byte big-endian length.\n' +
      '        if (contentData.size <= 0xFE) {\n' +
      '            result.add(contentData.size.toByte())\n' +
      '        } else {\n' +
      '            result.add(0xFF.toByte())\n' +
      '            result.add(((contentData.size shr 8) and 0xFF).toByte())\n' +
      '            result.add((contentData.size and 0xFF).toByte())\n' +
      '        }',
  },
  {
    file: 'model/NoiseEncrypted.kt',
    name: 'EXTENDED_PM_DECODE_LEN',
    anchor: /                val length = data\[offset\]\.toUByte\(\)\.toInt\(\)\n                offset \+= 1/,
    replacement:
      '                // [sovran] extended length read: 0xFF sentinel → 2-byte BE.\n' +
      '                var length = data[offset].toUByte().toInt()\n' +
      '                offset += 1\n' +
      '                if (length == 0xFF) {\n' +
      '                    if (offset + 2 > data.size) return null\n' +
      '                    length = (data[offset].toUByte().toInt() shl 8) or data[offset + 1].toUByte().toInt()\n' +
      '                    offset += 2\n' +
      '                }',
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
